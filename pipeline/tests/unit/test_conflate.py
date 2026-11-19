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


def test_same_qid_on_peak_and_tower_keeps_both():
    """Valós eset: a János-hegy csúcsa és az Erzsébet-kilátó ugyanazt a QID-et
    viselte az OSM-ben; a kilátó eltűnt. A QID a Wikidata-elem kategóriájával
    egyező rekordon marad, a kilátó QID nélkül, külön pont lesz."""
    conf, pois = run(
        [
            rec("osm", "n1", "Erzsébet-kilátó", 47.5181, 18.9590, cat="kilato", wikidata="Q897730"),
            rec("osm", "n2", "János-hegy", 47.5183, 18.9592, cat="csucs", wikidata="Q897730"),
            rec("wikidata", "Q897730", "János-hegy", 47.5183, 18.9592, cat="csucs", wikidata="Q897730"),
        ]
    )
    by_cat = {p.cat: p for p in pois}
    assert set(by_cat) == {"csucs", "kilato"}
    assert by_cat["csucs"].id == "Q897730" and by_cat["csucs"].osm == "n2"
    assert by_cat["kilato"].id == "n1" and by_cat["kilato"].wikidata is None
    assert [c["forras"] for c in conf.report.qid_conflicts] == ["osm:n1"]


# -- tárgyra mutató QID-ek (szobor alakja, kiállított tárgy típusa, falu) -------------

KECEL = (46.5260, 19.2520)


def test_subject_qid_without_coords_is_stripped():
    """A haditechnikai park T-34-ese a harckocsitípus QID-jét viseli (nincs helye)."""
    conf, pois = run(
        [
            rec("osm", "n1", "T-34", *KECEL, cat="egyeb", wikidata="Q172233", huwiki="T–34"),
            rec("wikidata", "Q172233", "T–34", wikidata="Q172233", huwiki="T–34", sitelinks=80),
        ]
    )
    assert len(pois) == 1
    p = pois[0]
    assert p.id == "n1" and p.wikidata is None and p.huwiki is None
    assert p.meta.get("sitelinks", 0) == 0
    assert [s["s"] for s in p.sources] == ["osm"]
    assert conf.report.subject_qids[0]["qid"] == "Q172233"


def test_subject_qid_pointing_to_village_is_stripped():
    """Egy kastély a falu QID-jét viseli: közel van, de más a neve."""
    village = (47.0560, 16.7470)
    conf, pois = run(
        [
            rec("osm", "n2", "Festetics-kastély", *village, cat="kastely", wikidata="Q9"),
            rec("wikidata", "Q9", "Kisgyalán", village[0] + 0.006, village[1], wikidata="Q9", sitelinks=30),
        ]
    )
    names = sorted(p.name for p in pois)
    assert names == ["Festetics-kastély"]
    assert pois[0].wikidata is None
    assert conf.report.subject_qids[0]["ok"] == "más a neve"


def test_subject_qid_far_away_is_stripped():
    """A csúcs a tájegység (Bakony) QID-jét viseli, amelynek a pontja 20 km-re van."""
    conf, pois = run(
        [
            rec("osm", "n3", "Bakony", 47.25, 17.80, cat="csucs", wikidata="Q8"),
            rec("wikidata", "Q8", "Bakony", 47.25 + 0.18, 17.80, wikidata="Q8", sitelinks=40),
        ]
    )
    assert [p.id for p in pois] == ["n3"]
    assert conf.report.subject_qids[0]["ok"].endswith("m-re van")


def test_uncategorized_qid_close_with_same_name_is_kept():
    """Ha a Wikidata-elem besorolhatatlan, de ott van és ugyanaz a neve, a kapcsolat jó."""
    conf, pois = run(
        [
            rec("osm", "w4", "Bory-vár", 47.2010, 18.4330, cat="kastely", wikidata="Q7"),
            rec("wikidata", "Q7", "Bory-vár Múzeum", 47.2012, 18.4332, wikidata="Q7", sitelinks=12),
        ]
    )
    assert [p.id for p in pois] == ["Q7"]
    assert not conf.report.subject_qids


def test_categorized_qid_with_other_name_is_kept():
    """A besorolt elemhez (vár) nem nyúlunk, akkor sem, ha más a neve."""
    conf, pois = run(
        [
            rec("osm", "w5", "Jurisics-vár", 47.3890, 16.5400, cat="var", wikidata="Q6"),
            rec("wikidata", "Q6", "Kőszegi vár", 47.3891, 16.5401, cat="var", wikidata="Q6", sitelinks=15),
        ]
    )
    assert [p.id for p in pois] == ["Q6"]
    assert not conf.report.subject_qids


def test_generic_osm_name_gives_way_to_real_name():
    """„Jegypénztár” vagy „Vár”: a Wikidata valódi neve lesz a látnivaló neve."""
    _, pois = run(
        [
            rec("osm", "n6", "Jegypénztár", 47.4410, 18.6050, cat="kert", wikidata="Q5"),
            rec("wikidata", "Q5", "Alcsúti Arborétum", 47.4415, 18.6055, cat="kert", wikidata="Q5"),
            rec("osm", "w7", "Vár", 47.4960, 19.0390, cat="var", wikidata="Q4"),
            rec("wikidata", "Q4", "Budai Vár", 47.4962, 19.0392, cat="var", wikidata="Q4"),
        ]
    )
    assert sorted(p.name for p in pois) == ["Alcsúti Arborétum", "Budai Vár"]
