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


def test_wikidata_duplicates_merge_within_source():
    _, pois = run(
        [
            rec("osm", "n1", "Egri vár", *EGER, cat="var", wikidata="Q1"),
            rec("wikidata", "Q1", "Egri vár", *EGER, cat="var", wikidata="Q1"),
            # ugyanaz a hely egy másik (duplikált) Wikidata-elemmel
            rec("wikidata", "Q2", "Egri vár", EGER[0] + 0.0001, EGER[1], cat="var", wikidata="Q2"),
        ]
    )
    assert [p.id for p in pois] == ["Q1"]


def test_final_merge_close_duplicates():
    from terkep_pipeline.conflate import merge_close_duplicates
    from terkep_pipeline.models import Poi

    def poi(id_, cat, sources, dlat=0.0, **kw):
        p = Poi(
            id=id_,
            name="Egri vár",
            cat=cat,
            lat=EGER[0] + dlat,
            lon=EGER[1],
            county="HE",
            sources=sources,
            **kw,
        )
        p.meta = {"sitelinks": 3, "sources": {s["s"] for s in sources}}
        return p

    pois = [
        poi("Q1", "var", [{"s": "osm", "ref": "n1"}, {"s": "wikidata", "ref": "Q1"}]),
        poi("Q2", "var", [{"s": "wikidata", "ref": "Q2"}], dlat=0.0001, desc="leírás"),
        # azonos név, másik kategória: marad
        poi("n3", "kilatopont", [{"s": "osm", "ref": "n3"}], dlat=0.0001),
        # azonos név és kategória, de 200 m-re: marad
        poi("Q4", "var", [{"s": "wikidata", "ref": "Q4"}], dlat=0.002),
    ]
    kept, merged = merge_close_duplicates(pois)
    assert merged == 1
    assert sorted(p.id for p in kept) == ["Q1", "Q4", "n3"]
    q1 = next(p for p in kept if p.id == "Q1")
    assert {s["ref"] for s in q1.sources} == {"n1", "Q1", "Q2"}
    assert q1.desc == "leírás"


def test_same_qid_on_far_apart_osm_objects_gives_unique_ids():
    """Valós adaton ez okozott ismétlődő azonosítót (pl. Q1092030)."""
    from terkep_pipeline.conflate import ensure_unique_ids

    conf, pois = run(
        [
            # hosszú híd két OSM-darabja ugyanazzal a QID-del, 1,5 km-re: egy pont
            rec("osm", "w1", "Kőröshegyi völgyhíd", 46.835, 17.900, cat="hid", wikidata="Q7"),
            rec("osm", "w2", "Kőröshegyi völgyhíd", 46.835, 17.920, cat="hid", wikidata="Q7"),
            # ugyanaz a QID egy 30 km-re lévő, másik objektumon: címkézési hiba
            rec("osm", "n3", "Valami kilátó", 47.100, 17.900, cat="kilato", wikidata="Q8"),
            rec("osm", "n4", "Másik kilátó", 46.830, 17.900, cat="kilato", wikidata="Q8"),
        ]
    )
    ids = [p.id for p in pois]
    assert len(ids) == len(set(ids)), ids
    assert sorted(ids) == ["Q7", "Q8", "n4"]
    assert [c["forras"] for c in conf.report.qid_conflicts] == ["osm:n4"]
    assert ensure_unique_ids(pois) == 0


def test_ensure_unique_ids_safety_net():
    from terkep_pipeline.conflate import ensure_unique_ids
    from terkep_pipeline.models import Poi

    a = Poi(
        id="Q5",
        name="A",
        cat="var",
        lat=47.0,
        lon=19.0,
        county="PE",
        wikidata="Q5",
        osm="w1",
        sources=[{"s": "osm", "ref": "w1"}, {"s": "wikidata", "ref": "Q5"}],
    )
    b = Poi(
        id="Q5",
        name="B",
        cat="var",
        lat=47.5,
        lon=19.0,
        county="PE",
        wikidata="Q5",
        osm="n2",
        sources=[{"s": "osm", "ref": "n2"}],
    )
    c = Poi(
        id="Q5",
        name="C",
        cat="var",
        lat=47.6,
        lon=19.0,
        county="PE",
        wikidata="Q5",
        sources=[{"s": "huwiki", "ref": "C"}],
    )
    assert ensure_unique_ids([a, b, c]) == 2
    assert (a.id, b.id, c.id) == ("Q5", "n2", "huwiki:C")
    assert a.wikidata == "Q5" and b.wikidata is None and c.wikidata is None
