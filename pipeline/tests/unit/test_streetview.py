import pytest

from terkep_pipeline.build import attach_streetview
from terkep_pipeline.models import FLAG_PANO, FLAG_STREETVIEW, Poi
from terkep_pipeline.pano_audit import classify
from terkep_pipeline.sources import streetview


def test_bearing_points_from_pano_to_poi():
    # a felvétel délre van a vártól -> észak felé (0°) kell néznie
    assert streetview.bearing(47.79, 18.98, 47.80, 18.98) == pytest.approx(0, abs=0.5)
    assert streetview.bearing(47.80, 18.98, 47.80, 18.99) == pytest.approx(90, abs=0.5)
    assert streetview.bearing(47.80, 18.99, 47.80, 18.98) == pytest.approx(270, abs=0.5)


def test_parse_metadata():
    meta = {"status": "OK", "location": {"lat": 47.7931, "lng": 18.9801}, "pano_id": "x", "date": "2023-05"}
    sv = streetview.parse(meta, 47.7942, 18.9811)
    assert sv == {"lat": 47.7931, "lon": 18.9801, "h": pytest.approx(sv["h"])}
    assert 0 < sv["h"] < 90  # észak-északkelet felé
    assert streetview.parse({"status": "ZERO_RESULTS"}, 47, 19) is None


def test_fetch_only_top_tiers_with_category_radius_and_never_logs_key(caplog):
    rows = [
        {"id": "Q1", "lat": 47.79, "lon": 18.98, "tier": 1, "cat": "var"},
        {"id": "Q2", "lat": 47.50, "lon": 19.03, "tier": 2, "cat": "templom"},
        {"id": "Q3", "lat": 47.60, "lon": 19.10, "tier": 3, "cat": "var"},
    ]
    seen = []

    def getter(params):
        seen.append(params)
        if params["location"].startswith("47.79"):
            return {"status": "OK", "location": {"lat": 47.789, "lng": 18.981}}
        return {"status": "ZERO_RESULTS"}

    out = streetview.fetch(rows, getter=getter, interval_s=0)
    assert set(out) == {"Q1"}
    assert [p["radius"] for p in seen] == ["400", "150"]
    assert all("key" not in p for p in seen)


def test_fetch_stops_on_rejected_key():
    rows = [{"id": "Q1", "lat": 47.79, "lon": 18.98, "tier": 1, "cat": "var"}]
    with pytest.raises(streetview.FatalApiError, match="REQUEST_DENIED"):
        streetview.fetch(
            rows, getter=lambda p: {"status": "REQUEST_DENIED", "error_message": "key=SECRET"}, interval_s=0
        )


def test_requests_getter_hides_url_on_network_error(monkeypatch):
    import requests

    class Boom(requests.Session):
        def get(self, *a, **k):
            raise requests.ConnectionError("https://maps.googleapis.com/...&key=SECRET")

    monkeypatch.setattr(requests, "Session", Boom)
    monkeypatch.setattr(streetview.time, "sleep", lambda s: None)
    g = streetview._requests_getter("SECRET", attempts=2)
    with pytest.raises(RuntimeError) as exc:
        g({"location": "1,2"})
    assert "SECRET" not in str(exc.value)


def test_attach_streetview_sets_flag():
    p = Poi(id="Q1", name="Vár", cat="var", lat=47.0, lon=19.0, county="PE")
    q = Poi(id="Q2", name="Templom", cat="templom", lat=47.0, lon=19.0, county="PE")
    assert attach_streetview([p, q], {"Q1": {"lat": 47.0, "lon": 19.0, "h": 10}}) == 1
    assert p.flags & FLAG_STREETVIEW and p.to_json()["sv"]["h"] == 10
    assert not q.flags & FLAG_STREETVIEW and "sv" not in q.to_json()


def test_pano_flag_value_distinct():
    assert FLAG_PANO == 256 and FLAG_STREETVIEW == 128


def test_classify_commons_panoramas():
    assert classify(8000, 4000, "File:Vár.jpg", []) == "sphere"
    assert classify(2400, 1200, "File:Vár 360.jpg", []) == "sphere"
    assert classify(12000, 2000, "File:Visegrád 360 fok körpanoráma.jpg", []) == "cylinder"
    assert classify(12000, 2000, "File:Széles panoráma.jpg", []) is None  # nem teljes kör
    assert classify(4000, 3000, "File:360.jpg", []) is None
