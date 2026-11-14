"""Vármegyehatárok: ellenőrzés, egyszerűsítés, GeoJSON-írás.

Forrás: OSM (osm_pbf.py) vagy tartalékként Natural Earth (natural_earth.py).
Két kimenet:
  - pipeline/build/megyek_full.geojson : teljes felbontás a pont-a-poligonban
    hozzárendeléshez
  - data/megyek.geojson               : egyszerűsített, a térképen megjelenítéshez
"""

from __future__ import annotations

import json
from pathlib import Path

import shapely
from shapely.geometry import mapping
from shapely.ops import unary_union

from . import config

SIMPLIFY_DEG = 0.001  # ~ 75-110 m


def check(polys: dict[str, object]) -> list[str]:
    """Visszaadja a talált problémákat (üres lista = rendben)."""
    problems = []
    expected = set(config.county_codes())
    got = set(polys)
    if got != expected:
        problems.append(f"Hiányzó: {sorted(expected - got)}, fölösleges: {sorted(got - expected)}")
    items = list(polys.items())
    for i, (ka, a) in enumerate(items):
        if not a.is_valid:
            problems.append(f"{ka}: érvénytelen geometria")
        for kb, b in items[i + 1 :]:
            inter = a.intersection(b).area
            if inter > 1e-4 * min(a.area, b.area):
                problems.append(f"{ka} és {kb} átfed ({inter:.6f} fok²)")
    return problems


def write(polys: dict[str, object], full_path: Path, display_path: Path, source: str) -> None:
    counties = config.counties()["counties"]
    keys = sorted(polys)
    full_path.parent.mkdir(parents=True, exist_ok=True)
    display_path.parent.mkdir(parents=True, exist_ok=True)

    def fc(geoms):
        return {
            "type": "FeatureCollection",
            "properties": {"source": source},
            "features": [
                {
                    "type": "Feature",
                    "properties": {"code": k, "name": counties[k]["name"], "short": counties[k]["short"]},
                    "geometry": mapping(g),
                }
                for k, g in zip(keys, geoms, strict=True)
            ],
        }

    full = [polys[k] for k in keys]
    full_path.write_text(json.dumps(fc(full)), encoding="utf-8")
    # coverage_simplify: a közös határok közös egyszerűsítése (nincs rés/átfedés)
    simplified = list(shapely.coverage_simplify(full, SIMPLIFY_DEG))
    rounded = [shapely.set_precision(g, 1e-5) for g in simplified]
    display_path.write_text(json.dumps(fc(rounded), separators=(",", ":")), encoding="utf-8")


def dissolve(parts: dict[str, list[object]]) -> dict[str, object]:
    return {k: unary_union(v).buffer(0) for k, v in parts.items()}
