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


class _FlakyDownload:
    """Az első két kérésnél kapcsolódási hiba, utána sikeres letöltés."""

    def __init__(self, failures):
        self.failures = failures
        self.calls = 0

    def get(self, url, **kw):
        import requests

        self.calls += 1
        if self.calls <= self.failures:
            raise requests.ConnectionError("[Errno 101] Network is unreachable")

        class R:
            status_code = 200

            def raise_for_status(self):
                pass

            def iter_content(self, n):
                yield b"PBF"

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        return R()


def test_download_retries_transient_network_errors(tmp_path):
    c = PoliteClient(cache_dir=tmp_path)
    c.session = _FlakyDownload(failures=2)
    dest = c.download("https://download.example/x.pbf", tmp_path / "x.pbf", backoff_s=0)
    assert dest.read_bytes() == b"PBF" and c.session.calls == 3


def test_download_gives_up_after_attempts(tmp_path):
    c = PoliteClient(cache_dir=tmp_path)
    c.session = _FlakyDownload(failures=10)
    with pytest.raises(RuntimeError, match="3 próbálkozás"):
        c.download("https://download.example/x.pbf", tmp_path / "x.pbf", attempts=3, backoff_s=0)
    assert c.session.calls == 3


class _MirrorClient:
    def __init__(self, ok_urls):
        self.ok_urls = ok_urls
        self.tried = []

    def download(self, url, dest, attempts=3):
        self.tried.append(url)
        if url not in self.ok_urls:
            raise RuntimeError("Network is unreachable")
        dest.write_bytes(b"PBF")
        return dest


def test_fetch_pbf_falls_back_to_mirror(tmp_path):
    from terkep_pipeline.cli import fetch_pbf

    c = _MirrorClient(ok_urls={"https://tukor/b.pbf"})
    dest = tmp_path / "hu.pbf"
    assert fetch_pbf(c, ["https://fo/a.pbf", "https://tukor/b.pbf"], dest) == dest
    assert c.tried == ["https://fo/a.pbf", "https://tukor/b.pbf"]


def test_fetch_pbf_uses_previous_copy_when_all_mirrors_fail(tmp_path):
    from terkep_pipeline.cli import fetch_pbf

    dest = tmp_path / "hu.pbf"
    dest.write_bytes(b"REGI")
    assert fetch_pbf(_MirrorClient(ok_urls=set()), ["https://fo/a.pbf"], dest).read_bytes() == b"REGI"
    dest.unlink()
    with pytest.raises(RuntimeError, match="nincs korábbi példány"):
        fetch_pbf(_MirrorClient(ok_urls=set()), ["https://fo/a.pbf"], dest)


class _AlwaysTimeout:
    def __init__(self):
        self.calls = 0

    def request(self, method, url, **kw):
        self.calls += 1

        class R:
            status_code = 504
            text = "upstream request timeout"
            headers = {}

        return R()


def test_fetch_respects_attempts(tmp_path, monkeypatch):
    import terkep_pipeline.http as http_mod

    slept = []
    monkeypatch.setattr(http_mod.time, "sleep", slept.append)
    c = PoliteClient(cache_dir=tmp_path, default_interval_s=0)
    c.session = _AlwaysTimeout()
    c.mark_api_host("query.wikidata.org")
    with pytest.raises(RuntimeError, match="HTTP 504"):
        c.post("https://query.wikidata.org/sparql", data={"query": "x"}, attempts=2)
    # két kérés, és az utolsó után már nem vár feleslegesen
    assert c.session.calls == 2 and len(slept) == 1
    c.session = _AlwaysTimeout()
    with pytest.raises(RuntimeError):
        c.post("https://query.wikidata.org/sparql", data={"query": "y"})
    assert c.session.calls == 5
