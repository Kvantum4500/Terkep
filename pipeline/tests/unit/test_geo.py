import pytest
from shapely.geometry import LineString, box

from terkep_pipeline import DATA_DIR
from terkep_pipeline.geo import GridIndex, PolygonIndex, area_km2, distance_m, representative_point


def test_distance_reasonable():
    # 0,01 fok szélesség ~ 1106 m
    assert distance_m(47.0, 19.0, 47.01, 19.0) == pytest.approx(1105.7, rel=0.01)


def test_grid_index():
    g = GridIndex(cell_m=500)
    g.add(47.0, 19.0, "a")
    g.add(47.0, 19.1, "b")
    near = [item for item, _ in g.near(47.001, 19.0, 300)]
    assert near == ["a"]


def test_polygon_index_with_snap():
    idx = PolygonIndex([("A", box(19.0, 47.0, 19.1, 47.1)), ("B", box(19.1, 47.0, 19.2, 47.1))])
    assert idx.lookup(47.05, 19.05) == "A"
    assert idx.lookup(47.05, 19.15) == "B"
    # 0,005 fokkal (~380 m) a határon kívül
    assert idx.lookup(47.05, 18.995) is None
    assert idx.lookup(47.05, 18.995, snap_m=1000) == "A"


def test_overlap_smaller_area_wins():
    idx = PolygonIndex([("PE", box(18.5, 47.0, 19.5, 48.0)), ("BU", box(18.9, 47.4, 19.2, 47.6))])
    assert idx.lookup(47.5, 19.04) == "BU"


def test_representative_point_and_area():
    lat, lon = representative_point(LineString([(19.0, 47.0), (19.2, 47.0)]))
    assert lon == pytest.approx(19.1)
    # 0,01° hosszúság ~ 756 m, 0,01° szélesség ~ 1106 m
    assert area_km2(box(19.0, 47.0, 19.01, 47.01)) == pytest.approx(0.836, rel=0.02)


@pytest.mark.parametrize(
    "lat,lon,code",
    [
        (47.4979, 19.0402, "BU"),  # Budapest
        (46.7700, 17.2420, "ZA"),  # Keszthely
        (47.9025, 20.3772, "HE"),  # Eger
        (48.1035, 20.7784, "BZ"),  # Miskolc
        (46.2530, 20.1414, "CS"),  # Szeged
        (47.6875, 17.6504, "GS"),  # Győr
    ],
)
def test_committed_county_boundaries(lat, lon, code):
    idx = PolygonIndex.from_geojson(DATA_DIR / "megyek.geojson", "code")
    assert idx.lookup(lat, lon) == code
