"""Jelzett turistautak az OSM-ből (route=hiking relációk) a jelzésszűrőhöz és a
teljesítésméréshez.

Két menet a Geofabrik-kivonaton:
  1. a turistaút-relációk (név, jel, osmc:symbol, network) és tag-útjaik, valamint a
     szülő-gyerek kapcsolat (pl. az Országos Kéktúra szakaszai);
  2. a szükséges utak geometriája (csomóponthelyekkel).

Kimenet (data/trails/):
  index.json  – az utak listája: id, név, jelzés (szín + alak), hossz, befoglaló téglalap,
                szülő/gyerekek
  <szín>.json – színenként a vonalak (5 jegyű polyline-kódolás), így a térkép csak a
                kiválasztott színt tölti le

A jelzés a magyar `jel` címkéből jön (k = kék sáv, k+ = kék kereszt, k3 = háromszög,
k4 = négyzet, kq = kör, kb = barlang, kl = rom …), ennek hiányában az osmc:symbol
előteréből (pl. blue:white:blue_bar).
"""

from __future__ import annotations

import gzip
import json
import logging
import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .. import DATA_DIR

log = logging.getLogger(__name__)

OUT_DIR = DATA_DIR / "trails"
SIMPLIFY_DEG = 0.00007  # kb. 5–8 m; a térképhez és a teljesítésméréshez bőven elég
BUDGET_GZ = 3 * 1024 * 1024

COLOR_BY_OSMC = {"blue": "k", "red": "p", "yellow": "s", "green": "z"}
COLOR_LABEL = {"k": "kék", "p": "piros", "s": "sárga", "z": "zöld", "x": "egyéb"}

SHAPE_BY_JEL = {
    "": "sav",
    "+": "kereszt",
    "3": "haromszog",
    "4": "negyzet",
    "q": "kor",
    "b": "barlang",
    "l": "rom",
}
SHAPE_BY_OSMC = {
    "bar": "sav",
    "stripe": "sav",
    "cross": "kereszt",
    "triangle": "haromszog",
    "rectangle": "negyzet",
    "square": "negyzet",
    "dot": "kor",
    "circle": "kor",
}
SHAPE_LABEL = {
    "sav": "sáv",
    "kereszt": "kereszt",
    "haromszog": "háromszög",
    "negyzet": "négyzet",
    "kor": "kör",
    "barlang": "barlang",
    "rom": "rom",
    "egyeb": "egyéb",
}


def parse_mark(tags: dict[str, str]) -> tuple[str, str]:
    """(szín, alak) – szín: k/p/s/z/x, alak: sav/kereszt/haromszog/negyzet/kor/barlang/rom/egyeb."""
    jel = (tags.get("jel") or "").strip().lower()
    if jel and jel[0] in "kpsz":
        return jel[0], SHAPE_BY_JEL.get(jel[1:], "egyeb")
    osmc = tags.get("osmc:symbol") or ""
    parts = osmc.split(":")
    color = COLOR_BY_OSMC.get(parts[0].strip().lower(), "x") if parts and parts[0] else "x"
    shape = "egyeb"
    if len(parts) >= 3:
        fg = parts[2].strip().lower()
        if "_" in fg:
            fg_color, fg_shape = fg.split("_", 1)
            if color == "x":
                color = COLOR_BY_OSMC.get(fg_color, "x")
            shape = SHAPE_BY_OSMC.get(fg_shape, "egyeb")
    if color == "x" and tags.get("colour"):
        color = COLOR_BY_OSMC.get(tags["colour"].lower(), "x")
    return color, shape


@dataclass
class TrailRel:
    id: int
    tags: dict[str, str]
    ways: list[int] = field(default_factory=list)
    children: list[int] = field(default_factory=list)


def _is_trail(tags: dict[str, str]) -> bool:
    return tags.get("route") in ("hiking", "foot") and tags.get("type") in ("route", "superroute")


# --- polyline (5 jegy) -----------------------------------------------------------


def encode_polyline(coords: Iterable[tuple[float, float]], precision: int = 5) -> str:
    """[lon, lat] párok -> Google-féle kódolt vonallánc (lat, lon sorrendben kódolva)."""
    f = 10**precision
    out: list[str] = []
    plat = plon = 0
    for lon, lat in coords:
        ilat, ilon = round(lat * f), round(lon * f)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return "".join(out)


def length_km(coords: list[tuple[float, float]]) -> float:
    total = 0.0
    for (lon1, lat1), (lon2, lat2) in zip(coords, coords[1:], strict=False):
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp, dl = p2 - p1, math.radians(lon2 - lon1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        total += 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(a)))
    return total


# --- kinyerés -------------------------------------------------------------------------


def read_relations(pbf: Path) -> dict[int, TrailRel]:
    import osmium

    rels: dict[int, TrailRel] = {}
    fp = osmium.FileProcessor(str(pbf), osmium.osm.RELATION).with_filter(
        osmium.filter.TagFilter(("route", "hiking"), ("route", "foot"))
    )
    for r in fp:
        tags = {t.k: t.v for t in r.tags}
        if not _is_trail(tags):
            continue
        rel = TrailRel(r.id, tags)
        for m in r.members:
            if m.type == "w":
                rel.ways.append(m.ref)
            elif m.type == "r":
                rel.children.append(m.ref)
        rels[r.id] = rel
    return rels


def read_way_coords(pbf: Path, way_ids: set[int]) -> dict[int, list[tuple[float, float]]]:
    import osmium

    out: dict[int, list[tuple[float, float]]] = {}
    fp = (
        osmium.FileProcessor(str(pbf), osmium.osm.NODE | osmium.osm.WAY)
        .with_locations()
        .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
        .with_filter(osmium.filter.IdFilter(way_ids))
    )
    for w in fp:
        coords = [(n.lon, n.lat) for n in w.nodes if n.location.valid()]
        if len(coords) >= 2:
            out[w.id] = coords
    return out


def assemble(rel: TrailRel, ways: dict[int, list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """A tag-utakból összefűzött, egyszerűsített vonalak (a hiányzó, pl. határon túli utak kimaradnak)."""
    from shapely.geometry import LineString, MultiLineString
    from shapely.ops import linemerge

    parts = [LineString(ways[w]) for w in rel.ways if w in ways]
    if not parts:
        return []
    merged = linemerge(MultiLineString(parts))
    lines = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    out = []
    for ln in lines:
        simp = ln.simplify(SIMPLIFY_DEG, preserve_topology=False)
        coords = [(round(x, 5), round(y, 5)) for x, y in simp.coords]
        if len(coords) >= 2:
            out.append(coords)
    return out


def build(
    rels: dict[int, TrailRel], ways: dict[int, list[tuple[float, float]]]
) -> tuple[dict, dict[str, dict]]:
    parent: dict[int, int] = {}
    for r in rels.values():
        for c in r.children:
            if c in rels:
                parent.setdefault(c, r.id)
    entries: list[dict[str, Any]] = []
    geo: dict[str, dict[str, list[str]]] = {}
    lengths: dict[int, float] = {}
    bboxes: dict[int, list[float]] = {}
    for r in rels.values():
        lines = assemble(r, ways)
        if not lines and not r.children:
            continue
        color, shape = parse_mark(r.tags)
        km = sum(length_km(ln) for ln in lines)
        if lines:
            xs = [x for ln in lines for x, _ in ln]
            ys = [y for ln in lines for _, y in ln]
            bboxes[r.id] = [min(xs), min(ys), max(xs), max(ys)]
            geo.setdefault(color, {})[f"r{r.id}"] = [encode_polyline(ln) for ln in lines]
        lengths[r.id] = km
        e: dict[str, Any] = {
            "id": f"r{r.id}",
            "n": r.tags.get("name") or r.tags.get("ref") or f"Turistaút {r.id}",
        }
        if r.tags.get("ref"):
            e["ref"] = r.tags["ref"]
        e.update({"c": color, "s": shape, "net": r.tags.get("network", "")})
        if r.id in parent:
            e["p"] = f"r{parent[r.id]}"
        kids = [c for c in r.children if c in rels]
        if kids:
            e["ch"] = [f"r{c}" for c in kids]
        entries.append(e)
    by_id = {int(e["id"][1:]): e for e in entries}
    # hossz és befoglaló téglalap: a szülőnél (pl. Kéktúra) a gyerekek összege
    for rid, e in by_id.items():
        km = lengths.get(rid, 0.0)
        box = bboxes.get(rid)
        for c in rels[rid].children:
            if c in by_id and c not in rels[rid].ways:
                km += lengths.get(c, 0.0)
                cb = bboxes.get(c)
                if cb:
                    box = (
                        cb
                        if box is None
                        else [min(box[0], cb[0]), min(box[1], cb[1]), max(box[2], cb[2]), max(box[3], cb[3])]
                    )
        e["km"] = round(km, 1)
        if box:
            e["b"] = [round(v, 4) for v in box]
    entries = [e for e in entries if e.get("b")]
    entries.sort(key=lambda e: (e["c"], e["n"]))
    index = {"v": 1, "colors": COLOR_LABEL, "shapes": SHAPE_LABEL, "trails": entries}
    return index, geo


def write(index: dict, geo: dict[str, dict], out_dir: Path | None = None) -> int:
    out_dir = out_dir or OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    total = 0
    for old in out_dir.glob("*.json"):
        old.unlink()
    files = {"index.json": index, **{f"{c}.json": g for c, g in geo.items()}}
    for name, obj in files.items():
        data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        (out_dir / name).write_text(data + "\n", encoding="utf-8")
        total += len(gzip.compress(data.encode()))
    log.info("Turistautak: %d út, %d szín, %.0f KB gzip", len(index["trails"]), len(geo), total / 1024)
    if total > BUDGET_GZ:
        raise ValueError(f"A turistaút-adat túl nagy: {total} B gzip > {BUDGET_GZ}")
    return total


def extract(pbf: Path, out_dir: Path | None = None) -> dict:
    rels = read_relations(pbf)
    way_ids = {w for r in rels.values() for w in r.ways}
    log.info("Turistaút-relációk: %d, tag-utak: %d", len(rels), len(way_ids))
    ways = read_way_coords(pbf, way_ids)
    index, geo = build(rels, ways)
    write(index, geo, out_dir)
    return index
