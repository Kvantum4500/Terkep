from terkep_pipeline import config
from terkep_pipeline.conflate import build_poi, categories_compatible, conflate
from terkep_pipeline.models import FLAG_KEKTURA, SourceRecord

CFGS = config.sources()["sources"]
ORDER = ["osm", "wikidata", "sample", "huwiki", "kektura", "turistautak"]

# 1 fok szélesség ~ 110,6 km -> 0,001 fok ~ 110 m
EGER = (47.9040, 20.3780)


def rec(source, ref, name, lat=None, lon=None, cat=None, **kw):
    return SourceRecord(source=source, ref=ref, name=name, lat=lat, lon=lon, cat=cat, **kw)


def run(records):
    conf = conflate(records, ORDER, CFGS)
    return conf, [p for p in (build_poi(c) for c in conf.clusters) if p]


def test_id_join_by_wikidata():
    conf, pois = run(
        [
            rec("osm", "w1", "Egri vár", *EGER, cat="var", wikidata="Q1"),
            rec(
                "wikidata", "Q1", "Egri vár", EGER[0] + 0.01, EGER[1], cat="var", wikidata="Q1", sitelinks=20
            ),
        ]
    )
    assert len(pois) == 1
    p = pois[0]
    assert p.id == "Q1" and p.osm == "w1"
    # az OSM koordinátája nyer
    assert (p.lat, p.lon) == EGER
    assert {s["s"] for s in p.sources} == {"osm", "wikidata"}


def test_spatial_match_without_id():
    _, pois = run(
        [
            rec("osm", "n1", "Egri vár", *EGER, cat="var"),
            rec("wikidata", "Q1", "Egri vár", EGER[0] + 0.002, EGER[1], cat="var", wikidata="Q1"),
        ]
    )
    assert len(pois) == 1 and pois[0].id == "Q1"


def test_peak_and_tower_never_merge():
    _, pois = run(
        [
            rec("osm", "n1", "Kékes", 47.8724, 20.0090, cat="csucs"),
            rec("osm", "n2", "Kékesi kilátó", 47.8725, 20.0091, cat="kilato"),
            rec("wikidata", "Q5", "Kékes", 47.8726, 20.0092, cat="csucs", wikidata="Q5"),
        ]
    )
    cats = sorted(p.cat for p in pois)
    assert cats == ["csucs", "kilato"]


def test_generic_churches_far_apart_stay_separate():
    _, pois = run(
        [
            rec("osm", "n1", "Római katolikus templom", 47.0, 19.0, cat="templom"),
            rec("wikidata", "Q9", "Római katolikus templom", 47.0, 19.02, cat="templom", wikidata="Q9"),
        ]
    )
    assert len(pois) == 2


def test_different_denominations_close_by_stay_separate():
    _, pois = run(
        [
            rec("osm", "n1", "Református templom", 47.0, 19.0, cat="templom"),
            rec("wikidata", "Q9", "Római katolikus templom", 47.0002, 19.0, cat="templom", wikidata="Q9"),
        ]
    )
    assert len(pois) == 2


def test_different_named_churches_close_by_stay_separate():
    _, pois = run(
        [
            rec("osm", "n1", "Szent Anna-templom", 47.0, 19.0, cat="templom"),
            rec("wikidata", "Q9", "Szent Péter-templom", 47.0004, 19.0, cat="templom", wikidata="Q9"),
        ]
    )
    assert len(pois) == 2


def test_generic_church_matches_named_one_close_by():
    _, pois = run(
        [
            rec("osm", "n1", "Római katolikus templom", 47.0, 19.0, cat="templom"),
            rec("wikidata", "Q9", "Szent Anna-templom", 47.0001, 19.0, cat="templom", wikidata="Q9"),
        ]
    )
    assert len(pois) == 1


def test_confirm_source_never_creates_poi():
    conf, pois = run(
        [
            rec("osm", "n1", "Egri vár", *EGER, cat="var"),
            rec("turistautak", "/p/1", "Egri vár", EGER[0] + 0.001, EGER[1], cat="var"),
            rec("turistautak", "/p/2", "Ismeretlen kilátó", 46.5, 18.0, cat="kilato"),
        ]
    )
    assert len(pois) == 1
    assert {s["s"] for s in pois[0].sources} == {"osm", "turistautak"}
    assert [u["forras"] for u in conf.report.unmatched] == ["turistautak:/p/2"]


def test_one_record_per_source_per_cluster():
    _, pois = run(
        [
            rec("osm", "n1", "Egri vár", *EGER, cat="var"),
            rec("kektura", "/a#1", "Egri vár", EGER[0] + 0.0005, EGER[1], flags=FLAG_KEKTURA),
            rec("kektura", "/a#2", "Egri vár", EGER[0] + 0.0010, EGER[1], flags=FLAG_KEKTURA),
        ]
    )
    assert len(pois) == 1
    assert sum(1 for s in pois[0].sources if s["s"] == "kektura") == 1
    assert pois[0].flags & FLAG_KEKTURA


def test_within_source_dedupe():
    conf, pois = run(
        [
            rec("osm", "n1", "Jáki templom", 47.0817, 16.5797, cat="templom"),
            rec("osm", "w2", "Jáki templom", 47.0819, 16.5797, cat="templom", wikidata="Q7"),
        ]
    )
    assert len(pois) == 1
    assert conf.report.deduped == 1
    assert pois[0].wikidata == "Q7"


def test_settlement_match_for_records_without_coords():
    _, pois = run(
        [
            rec("osm", "n1", "Füzéri vár", 48.539, 21.459, cat="var", settlement="Füzér"),
            rec("turistautak", "/f", "Füzéri vár", cat="var", settlement="Füzér", coord_quality="none"),
        ]
    )
    assert len(pois) == 1 and len(pois[0].sources) == 2


def test_huwiki_joins_by_qid_only():
    conf, pois = run(
        [
            rec("wikidata", "Q1", "Egri vár", *EGER, cat="var", wikidata="Q1"),
            rec("huwiki", "Egri vár", "Egri vár", wikidata="Q1", coord_quality="none"),
            rec("huwiki", "Eger", "Eger", wikidata="Q42", coord_quality="none"),
        ]
    )
    assert len(pois) == 1
    assert pois[0].huwiki == "Egri vár"
    assert len(conf.report.unmatched) == 1


def test_category_compatibility():
    assert categories_compatible("var", "rom", 0.0)
    assert not categories_compatible("var", "kastely", 0.7)
    assert categories_compatible("var", "kastely", 0.9)
    assert not categories_compatible("csucs", "kilato", 1.0)
    assert categories_compatible("egyeb", "templom", 0.9)
    assert categories_compatible(None, "templom", 0.1)


def test_flags_from_extra():
    _, pois = run(
        [
            rec("osm", "n1", "Baradla-barlang", 48.474, 20.495, cat="barlang", extra={"showcave": True}),
            rec("osm", "n2", "Jáki templom", 47.08, 16.58, cat="templom", extra={"heritage": True}),
        ]
    )
    by = {p.name: p.flags for p in pois}
    assert by["Baradla-barlang"] & 8
    assert by["Jáki templom"] & 1
