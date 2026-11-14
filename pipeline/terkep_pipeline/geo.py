"""Térbeli segédfüggvények: vetület, távolság, rácsindex, vármegye-hozzárendelés."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

import shapely
from shapely.geometry import Point, shape
from shapely.ops import nearest_points
from shapely.strtree import STRtree

# Magyarország közepére (é. sz. 47,2°) illesztett helyi síkvetület méterben.
# A hiba az ország területén <0,5% – az összevonási küszöbökhöz bőven elég.
_LAT0 = 47.2
_MX = math.cos(math.radians(_LAT0)) * 111_320.0
_MY = 110_574.0

# Magyarország befoglaló téglalapja (kis ráhagyással)
HU_BBOX = (16.05, 45.70, 22.95, 48.62)  # min_lon, min_lat, max_lon, max_lat


def project(lat: float, lon: float) -> tuple[float, float]:
    return lon * _MX, lat * _MY


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    x1, y1 = project(lat1, lon1)
    x2, y2 = project(lat2, lon2)
    return math.hypot(x1 - x2, y1 - y2)


def in_hu_bbox(lat: float, lon: float) -> bool:
    return HU_BBOX[1] <= lat <= HU_BBOX[3] and HU_BBOX[0] <= lon <= HU_BBOX[2]


class GridIndex:
    """Egyszerű rácsindex szomszédkereséshez (cellaméret méterben)."""

    def __init__(self, cell_m: float = 2000.0):
        self.cell = cell_m
        self._cells: dict[tuple[int, int], list[Any]] = defaultdict(list)

    def _key(self, lat: float, lon: float) -> tuple[int, int]:
        x, y = project(lat, lon)
        return int(x // self.cell), int(y // self.cell)

    def add(self, lat: float, lon: float, item: Any) -> None:
        self._cells[self._key(lat, lon)].append((lat, lon, item))

    def near(self, lat: float, lon: float, radius_m: float) -> Iterator[tuple[Any, float]]:
        cx, cy = self._key(lat, lon)
        reach = int(math.ceil(radius_m / self.cell))
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                for plat, plon, item in self._cells.get((cx + dx, cy + dy), ()):
                    d = distance_m(lat, lon, plat, plon)
                    if d <= radius_m:
                        yield item, d


class PolygonIndex:
    """Pont-a-poligonban keresés (vármegyék, települések)."""

    def __init__(self, features: Iterable[tuple[str, Any]]):
        self.keys: list[str] = []
        geoms = []
        for key, geom in features:
            self.keys.append(key)
            geoms.append(geom)
        self.geoms = geoms
        self.tree = STRtree(geoms)

    @classmethod
    def from_geojson(cls, path: Path, key_prop: str) -> PolygonIndex:
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls((f["properties"][key_prop], shape(f["geometry"])) for f in data["features"])

    def lookup(self, lat: float, lon: float, snap_m: float = 0.0) -> str | None:
        pt = Point(lon, lat)
        hits = self.tree.query(pt, predicate="intersects")
        if len(hits):
            # átfedésnél (pl. Budapest egy lyuk nélküli Pest-poligonban) a kisebb terület nyer
            best = min(hits, key=lambda i: self.geoms[i].area)
            return self.keys[best]
        if snap_m <= 0:
            return None
        idx = self.tree.nearest(pt)
        if idx is None:
            return None
        p1, p2 = nearest_points(self.geoms[idx], pt)
        d = distance_m(p1.y, p1.x, p2.y, p2.x)
        return self.keys[idx] if d <= snap_m else None


def representative_point(geom: Any) -> tuple[float, float]:
    """Terület: belső pont; vonal: a vonal felezőpontja; pont: önmaga. (lat, lon)"""
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        p = geom.point_on_surface()
    elif geom.geom_type in ("LineString", "MultiLineString"):
        p = geom.interpolate(0.5, normalized=True)
    else:
        p = geom.centroid
    return p.y, p.x


def area_km2(geom: Any) -> float:
    """Közelítő terület km²-ben (helyi vetületben)."""
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        return 0.0
    projected = shapely.transform(geom, lambda c: c * [_MX, _MY])
    return projected.area / 1e6
