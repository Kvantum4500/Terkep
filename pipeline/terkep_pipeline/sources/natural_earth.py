"""Tartalék vármegyehatárok közkincs forrásokból (ha az OSM-határ nem érhető el).

- geoBoundaries gbOpen HUN ADM1 (CC0): a 19 vármegye, Budapest nélkül
  (Pest poligonja Budapestet is lefedi).
- Natural Earth 10m admin-1 (közkincs): ebből csak Budapest poligonját vesszük,
  és kivágjuk Pestből. (A Natural Earth vármegyehatárai elavultak – pl.
  Keszthely ott Veszprémhez tartozik –, ezért a többit nem használjuk.)

Csak megjelenítéshez és mintaadathoz; az éles buildben az OSM-határok az elsők.
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import shape

from .. import config

NE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
    "ne_10m_admin_1_states_provinces.geojson"
)
GB_URL = (
    "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/HUN/ADM1/"
    "geoBoundaries-HUN-ADM1.geojson"
)
SOURCE_LABEL = "geoBoundaries HUN ADM1 (CC0) + Natural Earth (közkincs, Budapest)"


def budapest_from_ne(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    for f in data["features"]:
        p = f["properties"]
        if p.get("adm0_a3") == "HUN" and p.get("iso_3166_2") == "HU-BU":
            return shape(f["geometry"])
    raise ValueError("Budapest nem található a Natural Earth fájlban")


def polygons(gb_path: Path, ne_path: Path) -> dict[str, object]:
    codes = set(config.county_codes())
    data = json.loads(gb_path.read_text(encoding="utf-8"))
    out: dict[str, object] = {}
    for f in data["features"]:
        code = (f["properties"].get("shapeISO") or "").removeprefix("HU-")
        if code not in codes:
            raise ValueError(f"Ismeretlen geoBoundaries egység: {f['properties']}")
        out[code] = shape(f["geometry"]).buffer(0)
    bu = budapest_from_ne(ne_path).buffer(0)
    out["BU"] = bu
    out["PE"] = out["PE"].difference(bu).buffer(0)
    # apró szilánkok eltávolítása a különbségképzés után
    if out["PE"].geom_type == "MultiPolygon":
        out["PE"] = max(out["PE"].geoms, key=lambda g: g.area)
    return out
