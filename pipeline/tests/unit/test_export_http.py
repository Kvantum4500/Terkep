import pytest

from terkep_pipeline.export import compute_aliases, validate
from terkep_pipeline.http import OfflineMiss, PoliteClient, Response


def row(**kw):
    base = {
        "id": "n1",
        "name": "X",
        "cat": "var",
        "lat": 47.0,
        "lon": 19.0,
        "county": "PE",
        "tier": 1,
        "score": 1.0,
        "flags": 0,
        "sources": [{"s": "osm", "ref": "n1"}],
    }
    base.update(kw)
    return base


def test_schema_accepts_valid_and_rejects_invalid():
    validate([row()])
    with pytest.raises(ValueError):
        validate([row(county="XX")])
    with pytest.raises(ValueError):
        validate([row(lat=40.0)])
    with pytest.raises(ValueError):
        validate([row(extra_field=1)])


def test_aliases_follow_source_refs():
    old = [row(id="n1")]
    new = [row(id="Q5", sources=[{"s": "osm", "ref": "n1"}, {"s": "wikidata", "ref": "Q5"}])]
    assert compute_aliases(old, new, {}) == {"n1": "Q5"}
    # lánc feloldása: a -> n1 -> Q5
    assert compute_aliases(old, new, {"a": "n1"}) == {"a": "Q5", "n1": "Q5"}


def test_http_cache_and_offline(tmp_path):
    online = PoliteClient(cache_dir=tmp_path)
    path = online._cache_path("GET", "https://example.org/x", None)
    online._write_cache(path, Response("https://example.org/x", 200, "szia", {}))
    offline = PoliteClient(cache_dir=tmp_path, offline=True)
    assert offline.get("https://example.org/x").text == "szia"
    with pytest.raises(OfflineMiss):
        offline.get("https://example.org/nincs")
