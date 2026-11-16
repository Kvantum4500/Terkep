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


class _Robots:
    def can_fetch(self, ua, url):
        return False


class _FakeHttp:
    def __init__(self):
        self.calls = []

    def request(self, method, url, **kw):
        self.calls.append(url)

        class R:
            status_code = 200
            text = "{}"
            headers = {}

        return R()


def _client_with_robots_disallowing_everything(tmp_path):
    c = PoliteClient(cache_dir=tmp_path, default_interval_s=0)
    c.session = _FakeHttp()
    c._robots = {"https://query.wikidata.org": _Robots(), "https://www.pelda.hu": _Robots()}
    return c


def test_api_hosts_skip_robots_but_sites_do_not(tmp_path):
    from terkep_pipeline.http import RobotsDisallowed

    c = _client_with_robots_disallowing_everything(tmp_path)
    c.mark_api_host("query.wikidata.org")
    # a hivatalos API-hívás nem nézi a robots.txt-t
    assert c.post("https://query.wikidata.org/sparql", data={"query": "x"}).text == "{}"
    assert c.session.calls == ["https://query.wikidata.org/sparql"]
    # egy túraoldalnál viszont igen: hálózati hívás nélkül megáll
    with pytest.raises(RobotsDisallowed):
        c.get("https://www.pelda.hu/oldal")
    assert len(c.session.calls) == 1


def test_unmarked_host_still_respects_robots(tmp_path):
    from terkep_pipeline.http import RobotsDisallowed

    c = _client_with_robots_disallowing_everything(tmp_path)
    with pytest.raises(RobotsDisallowed):
        c.post("https://query.wikidata.org/sparql", data={"query": "x"})


def test_cli_marks_wikimedia_api_hosts():
    import argparse

    from terkep_pipeline.cli import _client

    c = _client(argparse.Namespace(offline=True))
    assert {"query.wikidata.org", "hu.wikipedia.org", "commons.wikimedia.org"} <= c._api_hosts
