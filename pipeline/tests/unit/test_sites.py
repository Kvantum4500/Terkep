"""Az oldal-kinyerő tesztjei SZINTETIKUS HTML-lel (valódi oldalak tartalmát
nem tároljuk a nyilvános repóban)."""

from terkep_pipeline.sources.sites.extract import extract
from terkep_pipeline.sources.sites.kektura import parse_gpx_waypoints

JSONLD = """<html><head><title>Próbavár | Oldal</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"TouristAttraction","name":"Próbavár",
 "geo":{"@type":"GeoCoordinates","latitude":47.9,"longitude":20.37},
 "address":{"@type":"PostalAddress","addressLocality":"Eger"}}
</script></head><body><h1>Próbavár</h1></body></html>"""

META = """<html><head><meta name="geo.position" content="46.83;17.45">
<meta property="og:title" content="Bazaltorgonák - Valami oldal"></head><body></body></html>"""

MAPLINK = """<html><body><h1>Kilátó a hegyen</h1>
<a href="https://www.google.com/maps?q=47.5181,18.959">Térkép</a>
<a href="https://maps.google.com/?q=47.5181,18.959">Térkép újra</a>
<a href="/letoltes/tura.gpx">GPX</a></body></html>"""

AMBIGUOUS = """<html><body><h1>Lista</h1>
<div data-lat="47.1" data-lng="19.1"></div><div data-lat="47.2" data-lng="19.2"></div></body></html>"""

OUTSIDE = (
    """<html><head><meta name="geo.position" content="48.9;2.35"></head><body><h1>Párizs</h1></body></html>"""
)


def test_jsonld():
    f = extract("https://x.hu/a", JSONLD)
    assert (f.name, f.lat, f.lon, f.settlement, f.coord_source) == ("Próbavár", 47.9, 20.37, "Eger", "jsonld")


def test_meta_geo_position_and_title_cleanup():
    f = extract("https://x.hu/b", META)
    assert (f.lat, f.lon, f.coord_source) == (46.83, 17.45, "meta")
    assert f.name == "Bazaltorgonák"


def test_map_link_and_gpx():
    f = extract("https://x.hu/c/d", MAPLINK)
    assert (f.lat, f.lon, f.coord_source) == (47.5181, 18.959, "map-link")
    assert f.gpx_links == ["https://x.hu/letoltes/tura.gpx"]


def test_ambiguous_data_attrs_ignored():
    assert extract("https://x.hu/e", AMBIGUOUS).lat is None


def test_coords_outside_hungary_ignored():
    assert extract("https://x.hu/f", OUTSIDE).lat is None


GPX = """<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <wpt lat="47.8724" lon="20.0090"><name>Kékes – pecsételőhely</name></wpt>
  <wpt lat="47.9" lon="20.1"><name>Forrás</name></wpt>
  <wpt lat="47.7" lon="19.9"><name>Mátraháza</name><desc>Bélyegző (pecsét) a büfében</desc></wpt>
</gpx>"""


def test_gpx_stamp_points():
    recs = parse_gpx_waypoints(GPX, "/gpx/okt.gpx")
    assert [(r.name, r.lat) for r in recs] == [("Kékes", 47.8724), ("Mátraháza", 47.7)]
    assert all(r.flags == 4 for r in recs)
