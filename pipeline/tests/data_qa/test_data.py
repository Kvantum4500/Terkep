"""Minőségi tesztek a legyártott adaton (pytest -m data).

Alapból a data/ könyvtárat nézi, ha van benne pois.ndjson, különben a
data/sample/-t. Felülírható: TERKEP_DATA=/út/a/könyvtárhoz.
"""

import json
import os
from collections import Counter
from pathlib import Path

import pytest

from terkep_pipeline import DATA_DIR, config
from terkep_pipeline.cli import check_golden
from terkep_pipeline.export import load_ndjson, validate
from terkep_pipeline.geo import GridIndex, in_hu_bbox
from terkep_pipeline.normalize import fold

pytestmark = pytest.mark.data


def data_dir() -> Path:
    env = os.environ.get("TERKEP_DATA")
    if env:
        return Path(env)
    return DATA_DIR if (DATA_DIR / "pois.ndjson").exists() else DATA_DIR / "sample"


@pytest.fixture(scope="module")
def rows():
    r = load_ndjson(data_dir() / "pois.ndjson")
    assert r, f"üres adat: {data_dir()}"
    return r


@pytest.fixture(scope="module")
def meta():
    return json.loads((data_dir() / "meta.json").read_text(encoding="utf-8"))


def test_schema(rows):
    validate(rows)


def test_unique_ids_and_sorted(rows):
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids))
    assert ids == sorted(ids)


def test_every_county_present(rows):
    assert set(Counter(r["county"] for r in rows)) == set(config.county_codes())


def test_inside_hungary(rows):
    assert all(in_hu_bbox(r["lat"], r["lon"]) for r in rows)


def test_no_close_duplicates(rows):
    grid = GridIndex(cell_m=100)
    dups = []
    for r in rows:
        for other, _d in grid.near(r["lat"], r["lon"], 30):
            if other["cat"] == r["cat"] and fold(other["name"]) == fold(r["name"]):
                dups.append((other["id"], r["id"]))
        grid.add(r["lat"], r["lon"], r)
    assert not dups, dups[:10]


def test_meta_counts(rows, meta):
    assert meta["counts"]["total"] == len(rows)
    assert set(meta["categories"]) == set(config.category_keys())


def test_boundaries():
    fc = json.loads((DATA_DIR / "megyek.geojson").read_text(encoding="utf-8"))
    assert sorted(f["properties"]["code"] for f in fc["features"]) == sorted(config.county_codes())


def test_golden_list(meta):
    if meta.get("sample"):
        pytest.skip("mintaadaton az aranylista nem kötelező")
    assert check_golden(data_dir()) == []
