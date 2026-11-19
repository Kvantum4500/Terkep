"""OpenStreetMap: látnivalók, vármegyehatárok és településhatárok kinyerése a
Geofabrik Magyarország-kivonatból (PBF) pyosmium segítségével.

Egyetlen menetben dolgozzuk fel a fájlt:
  - pont (node)              -> rekord a pont helyén
  - nyitott vonal (way)      -> rekord a vonal felezőpontján (szikla, völgy, híd)
  - terület (zárt way/rel.)  -> rekord egy belső ponton (point_on_surface)
  - boundary=administrative  -> vármegye (ISO3166-2 kód alapján) és település
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import osmium
from shapely import wkb
from shapely.geometry import mapping

from .. import BUILD_DIR, DATA_DIR, boundaries, config
from ..categorize import categorize_osm, osm_prefilter_keys
from ..geo import area_km2, representative_point
from ..models import SourceRecord

log = logging.getLogger(__name__)

_QID = re.compile(r"^Q[0-9]+$")
_WKB = osmium.geom.WKBFactory()


def _float(val: str | None) -> float | None:
    if not val:
        return None
    m = re.match(r"^\s*(-?[0-9]+(?:[.,][0-9]+)?)", val)
    return float(m.group(1).replace(",", ".")) if m else None


def _commons_file(tags: dict[str, str]) -> str | None:
    val = tags.get("wikimedia_commons") or ""
    if val.startswith("File:"):
        return val[5:]
    img = tags.get("image") or ""
    m = re.search(r"commons\.wikimedia\.org/wiki/File:(.+)$", img)
    if m:
        return m.group(1).replace("_", " ")
    return None


def record_from_tags(
    ref: str, tags: dict[str, str], lat: float, lon: float, area: float | None
) -> SourceRecord | None:
    hit = categorize_osm(tags, area)
    if hit is None:
        return None
    cat, sub = hit
    wikidata = tags.get("wikidata")
    if wikidata and not _QID.match(wikidata):
        wikidata = None
    huwiki = None
    wp = tags.get("wikipedia") or ""
    if wp.startswith("hu:"):
        huwiki = wp[3:].replace("_", " ")
    alt = []
    for key in ("alt_name", "old_name", "name:hu"):
        for part in (tags.get(key) or "").split(";"):
            part = part.strip()
            if part and part != tags["name"]:
                alt.append(part)
    extra: dict = {}
    if any(k in tags for k in ("heritage", "ref:hu:muemlek", "heritage:operator")):
        extra["heritage"] = True
    if cat == "barlang" and (
        tags.get("tourism") in ("attraction", "museum") or tags.get("fee") == "yes" or "opening_hours" in tags
    ):
        extra["showcave"] = True
    desc = tags.get("description:hu") or tags.get("description")
    if desc and len(desc) > 300:
        desc = None
    return SourceRecord(
        source="osm",
        ref=ref,
        name=tags["name"],
        lat=lat,
        lon=lon,
        cat=cat,
        sub=sub,
        settlement=tags.get("addr:city"),
        wikidata=wikidata,
        huwiki=huwiki,
        alt_names=alt[:3],
        desc=desc,
        ele=_float(tags.get("ele")),
        image=_commons_file(tags),
        extra=extra,
    )


def extract(pbf: Path) -> tuple[list[SourceRecord], dict[str, object], list[tuple[str, object]]]:
    """Visszaadja: (rekordok, vármegye-poligonok kód szerint, település-poligonok)."""
    county_codes = set(config.county_codes())
    keys = sorted(osm_prefilter_keys() | {"boundary"})
    fp = (
        osmium.FileProcessor(str(pbf))
        .with_locations()
        .with_areas()
        .with_filter(osmium.filter.KeyFilter(*keys))
    )
    out: list[SourceRecord] = []
    county_parts: dict[str, list[object]] = {}
    settlements: list[tuple[str, object]] = []
    n = 0
    for obj in fp:
        n += 1
        if n % 500_000 == 0:
            log.info("OSM: %d objektum, %d rekord", n, len(out))
        tags = {t.k: t.v for t in obj.tags}
        try:
            if obj.is_node():
                if not obj.location.valid():
                    continue
                rec = record_from_tags(f"n{obj.id}", tags, obj.location.lat, obj.location.lon, None)
                if rec:
                    out.append(rec)
            elif obj.is_way():
                if obj.is_closed() or "name" not in tags:
                    continue  # zárt vonalakat területként dolgozzuk fel
                geom = wkb.loads(_WKB.create_linestring(obj), hex=True)
                lat, lon = representative_point(geom)
                rec = record_from_tags(f"w{obj.id}", tags, lat, lon, None)
                if rec:
                    out.append(rec)
            elif obj.is_area():
                if tags.get("boundary") == "administrative":
                    iso = tags.get("ISO3166-2", "")
                    if iso.startswith("HU-") and iso[3:] in county_codes:
                        geom = wkb.loads(_WKB.create_multipolygon(obj), hex=True)
                        county_parts.setdefault(iso[3:], []).append(geom)
                        continue
                    if tags.get("admin_level") == "8" and tags.get("name"):
                        geom = wkb.loads(_WKB.create_multipolygon(obj), hex=True)
                        settlements.append((tags["name"], geom))
                        continue
                if "name" not in tags:
                    continue
                geom = wkb.loads(_WKB.create_multipolygon(obj), hex=True)
                lat, lon = representative_point(geom)
                prefix = "w" if obj.from_way() else "r"
                rec = record_from_tags(f"{prefix}{obj.orig_id()}", tags, lat, lon, area_km2(geom))
                if rec:
                    out.append(rec)
        except (osmium.InvalidLocationError, RuntimeError) as exc:
            log.debug("Hibás geometria %s: %s", obj, exc)
    log.info(
        "OSM kész: %d rekord, %d vármegye-darab, %d település", len(out), len(county_parts), len(settlements)
    )
    return out, boundaries.dissolve(county_parts), settlements


def write_boundaries(counties: dict[str, object], settlements: list[tuple[str, object]]) -> bool:
    """Ha az OSM-határok átmennek az ellenőrzésen, kiírja őket; különben False."""
    if "BU" in counties and "PE" in counties:
        # ha Pest poligonjában nincs kivágva Budapest, itt vágjuk ki (átfedés ellen)
        counties = {**counties, "PE": counties["PE"].difference(counties["BU"]).buffer(0)}
    problems = boundaries.check(counties)
    if problems:
        log.warning("OSM vármegyehatár-hiba, marad a tartalék: %s", "; ".join(problems))
    else:
        boundaries.write(
            counties,
            BUILD_DIR / "megyek_full.geojson",
            DATA_DIR / "megyek.geojson",
            "OpenStreetMap közreműködők (ODbL)",
        )
    fc = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"name": n}, "geometry": mapping(g)} for n, g in settlements
        ],
    }
    (BUILD_DIR / "telepulesek.geojson").write_text(json.dumps(fc), encoding="utf-8")
    return not problems
