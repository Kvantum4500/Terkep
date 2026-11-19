import json
from pathlib import Path

import pytest

from terkep_pipeline.sources import trails

FIXTURE = Path(__file__).parent.parent / "fixtures" / "trails.osm"


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"jel": "k"}, ("k", "sav")),
        ({"jel": "p+"}, ("p", "kereszt")),
        ({"jel": "s3"}, ("s", "haromszog")),
        ({"jel": "z4"}, ("z", "negyzet")),
        ({"jel": "kq"}, ("k", "kor")),
        ({"jel": "kb"}, ("k", "barlang")),
        ({"jel": "kl"}, ("k", "rom")),
        ({"jel": "kx"}, ("k", "egyeb")),
        ({"osmc:symbol": "blue:white:blue_bar"}, ("k", "sav")),
        ({"osmc:symbol": "yellow:white:yellow_cross"}, ("s", "kereszt")),
        ({"osmc:symbol": "red:white:red_triangle"}, ("p", "haromszog")),
        ({"osmc:symbol": ":white:green_dot"}, ("z", "kor")),
        ({"osmc:symbol": "black:white:black_bar"}, ("x", "sav")),
        ({}, ("x", "egyeb")),
        # a jel elsőbbséget élvez
        ({"jel": "s+", "osmc:symbol": "blue:white:blue_bar"}, ("s", "kereszt")),
    ],
)
def test_parse_mark(tags, expected):
    assert trails.parse_mark(tags) == expected


def test_encode_polyline_matches_google_example():
    # Google példája (lat, lon): (38.5,-120.2), (40.7,-120.95), (43.252,-126.453)
    pts = [(-120.2, 38.5), (-120.95, 40.7), (-126.453, 43.252)]
    assert trails.encode_polyline(pts) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"


def test_extract_from_fixture(tmp_path):
    index = trails.extract(FIXTURE, out_dir=tmp_path)
    by_id = {t["id"]: t for t in index["trails"]}
    assert set(by_id) == {"r100", "r101", "r200"}  # a kerékpárút kimarad
    blue = by_id["r100"]
    assert (blue["c"], blue["s"]) == ("k", "sav")
    assert blue["p"] == "r200"
    # két útból (az egyik fordított) egy összefűzött vonal; a hiányzó út kimarad
    geo = json.loads((tmp_path / "k.json").read_text())
    assert len(geo["r100"]) == 1
    assert blue["km"] == pytest.approx(3.6, abs=0.05)  # 1,11 + 1,34 + 1,11 km
    sup = by_id["r200"]
    assert sup["ch"] == ["r100"] and sup["km"] == blue["km"]
    assert sup["b"] == blue["b"]
    yellow = by_id["r101"]
    assert (yellow["c"], yellow["s"]) == ("s", "kereszt")
    assert (tmp_path / "s.json").exists() and (tmp_path / "index.json").exists()
    assert index["colors"]["k"] == "kék" and index["shapes"]["kereszt"] == "kereszt"


def test_write_enforces_budget(tmp_path, monkeypatch):
    monkeypatch.setattr(trails, "BUDGET_GZ", 10)
    with pytest.raises(ValueError, match="túl nagy"):
        trails.write({"v": 1, "trails": [{"id": "r1"}] * 50}, {}, tmp_path)
