"""A teljes build: forrásrekordok -> összevonás -> vármegye -> pontozás -> export."""

from __future__ import annotations

import csv
import json
import logging
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from . import BUILD_DIR, DATA_DIR, config, records
from .conflate import Conflator, build_poi, conflate, ensure_unique_ids, merge_close_duplicates
from .geo import PolygonIndex, in_hu_bbox
from .models import Poi, SourceRecord
from .score import assign_tiers

log = logging.getLogger(__name__)

SOURCE_ORDER = [
    "osm",
    "wikidata",
    "sample",
    "huwiki",
    "kektura",
    "termeszetvedelem",
    "muemlekem",
    "archeodatabase",
    "turistautak",
    "termeszetjaro",
    "kirandulastippek",
    "programturizmus",
]


@dataclass
class BuildResult:
    pois: list[Poi]
    conflator: Conflator
    dropped: list[dict] = field(default_factory=list)
    county_mismatch: list[dict] = field(default_factory=list)


def county_index() -> PolygonIndex:
    full = BUILD_DIR / "megyek_full.geojson"
    path = full if full.exists() else DATA_DIR / "megyek.geojson"
    return PolygonIndex.from_geojson(path, "code")


def settlement_index() -> PolygonIndex | None:
    path = BUILD_DIR / "telepulesek.geojson"
    return PolygonIndex.from_geojson(path, "name") if path.exists() else None


def apply_overrides(pois: list[Poi], conf: Conflator) -> list[Poi]:
    ov = config.overrides()
    excluded = set(ov.get("exclude") or [])
    per_id = ov.get("overrides") or {}
    out = []
    for p in pois:
        if p.id in excluded or (p.osm and p.osm in excluded):
            continue
        o = per_id.get(p.id)
        if o:
            for k in ("name", "cat", "sub", "settlement"):
                if k in o:
                    setattr(p, k, o[k])
            if "tier" in o:
                p.meta["tier_hint"] = o["tier"]
        out.append(p)
    return out


def run(
    source_records: dict[str, list[SourceRecord]],
    sample: bool = False,
    out_dir: Path | None = None,
    boundaries_source: str | None = None,
    reports_dir: Path | None = None,
) -> BuildResult:
    cfgs = config.sources()["sources"]
    all_records = [r for recs in source_records.values() for r in recs]
    conf = conflate(all_records, SOURCE_ORDER, cfgs)
    for refs in config.overrides().get("merge") or []:
        conf.force_merge(refs)

    counties = county_index()
    settlements = settlement_index()
    bsrc = boundaries_source or _boundaries_source()
    snap_key = "border_snap_m" if bsrc.startswith("OpenStreetMap") else "fallback_border_snap_m"
    snap = float(config.counties()[snap_key])
    pois: list[Poi] = []
    dropped: list[dict] = []
    mismatch: list[dict] = []
    for cl in conf.clusters:
        poi = build_poi(cl)
        if poi is None:
            continue
        if not in_hu_bbox(poi.lat, poi.lon):
            dropped.append({"id": poi.id, "nev": poi.name, "ok": "országon kívül (bbox)"})
            continue
        code = counties.lookup(poi.lat, poi.lon, snap_m=snap)
        expected = next(
            (r.extra.get("expected_county") for r in cl.records if r.extra.get("expected_county")), None
        )
        if code is None and sample and expected:
            # a kézi mintaadat közelítő koordinátája a határon túlra eshet (pl. Írott-kő)
            code = expected
        if code is None:
            dropped.append({"id": poi.id, "nev": poi.name, "ok": "egyik vármegyébe sem esik"})
            continue
        poi.county = code
        if not poi.settlement and settlements is not None:
            poi.settlement = settlements.lookup(poi.lat, poi.lon)
        if expected and expected != code:
            mismatch.append({"id": poi.id, "nev": poi.name, "elvart": expected, "kapott": code})
            if sample:
                # a tartalék-határ durva; a kézi mintaadatban a megadott vármegye a hiteles
                poi.county = expected
        pois.append(poi)

    pois, merged = merge_close_duplicates(pois)
    conf.report.deduped += merged
    pois = apply_overrides(pois, conf)
    conf.report.id_fixes = ensure_unique_ids(pois)
    assign_tiers(pois)
    if not sample:
        attach_streetview(pois)

    if out_dir is not None:
        from .export import write_outputs

        write_outputs(pois, out_dir, sample=sample, boundaries_source=bsrc)
    if reports_dir is not None:
        write_reports(reports_dir, pois, conf, dropped, mismatch)
    return BuildResult(pois, conf, dropped, mismatch)


def attach_streetview(pois: list[Poi], data: dict[str, dict[str, float]] | None = None) -> int:
    """A `terkep fetch streetview` eredménye (ha van) a látnivalókhoz."""
    from .models import FLAG_STREETVIEW
    from .sources import streetview

    data = streetview.load() if data is None else data
    n = 0
    for p in pois:
        sv = data.get(p.id)
        if sv:
            p.sv = sv
            p.flags |= FLAG_STREETVIEW
            n += 1
    if data:
        log.info("Utcakép %d látnivalónál", n)
    return n


def _boundaries_source() -> str:
    path = DATA_DIR / "megyek.geojson"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8")).get("properties", {}).get("source", "ismeretlen")
    return "ismeretlen"


def _csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        if rows:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)


def _wikidata_skipped_classes() -> list[str]:
    from .sources.wikidata import SKIPPED_PATH

    try:
        return json.loads(SKIPPED_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def write_reports(
    out: Path, pois: list[Poi], conf: Conflator, dropped: list[dict], mismatch: list[dict]
) -> None:
    out.mkdir(parents=True, exist_ok=True)
    conf.report.write(out)
    _csv(out / "dropped.csv", dropped)
    _csv(out / "county_mismatch.csv", mismatch)
    cats = config.categories()["categories"]
    counties = config.counties()["counties"]
    lines = [
        "# Build-riport",
        "",
        f"Összesen: **{len(pois)}** látnivaló, összevont duplikátum: {conf.report.deduped}",
        "",
    ]
    tiers = Counter(p.tier for p in pois)
    lines.append(f"Szintek: kiemelt {tiers[1]}, érdekes {tiers[2]}, helyi {tiers[3]}")
    lines += ["", "## Kategóriák", "", "| Kategória | Db | Kiemelt |", "|---|---:|---:|"]
    by_cat = Counter(p.cat for p in pois)
    t1_cat = Counter(p.cat for p in pois if p.tier == 1)
    for k, v in cats.items():
        lines.append(f"| {v['label']} | {by_cat[k]} | {t1_cat[k]} |")
    lines += ["", "## Vármegyénkénti top 15", ""]
    for code, cinfo in counties.items():
        top = sorted((p for p in pois if p.county == code), key=lambda p: -p.score)[:15]
        lines.append(f"### {cinfo['name']} ({sum(1 for p in pois if p.county == code)} db)")
        lines += [f"- {p.name} — {cats[p.cat]['label']}, szint {p.tier}, pont {p.score:.1f}" for p in top]
        lines.append("")
    lines += [
        "## Problémák",
        "",
        f"- Bizonytalan párosítás: {len(conf.report.ambiguous)} (ambiguous_matches.csv)",
        f"- Párosítatlan megerősítő rekord: {len(conf.report.unmatched)} (unmatched.csv)",
        f"- Távoli rekord azonos QID-del (QID levéve): {len(conf.report.qid_conflicts)} (qid_conflicts.csv)",
        f"- Azonosító-ütközés javítva: {conf.report.id_fixes}",
        f"- Elvetett pont: {len(dropped)} (dropped.csv)",
        f"- Eltérő vármegye a vártnál: {len(mismatch)} (county_mismatch.csv)",
    ]
    skipped = _wikidata_skipped_classes()
    if skipped:
        lines.append(
            f"- Wikidata-osztály kimaradt a felderítésből (időtúllépés): {len(skipped)} – "
            + ", ".join(skipped[:20])
        )
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def load_all_records() -> dict[str, list[SourceRecord]]:
    cfgs = config.sources()["sources"]
    out = {}
    for src in records.available():
        if src == "sample" or not cfgs.get(src, {}).get("enabled", False):
            continue
        out[src] = records.load(src)
    return out
