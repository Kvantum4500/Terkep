from terkep_pipeline.sources.wikidata import enrich_query, rows_to_records

E = "http://www.wikidata.org/entity/"


def lit(v):
    return {"type": "literal", "value": v}


def test_enrich_query_has_values():
    q = enrich_query(["Q1", "Q2"])
    assert "VALUES ?item { wd:Q1 wd:Q2 }" in q
    assert "GROUP BY ?item" in q


def test_rows_to_records():
    rows = [
        {
            "item": {"type": "uri", "value": E + "Q1"},
            "c": lit("Point(20.378 47.904)"),
            "l": lit("Egri vár"),
            "d": lit("vár Egerben"),
            "i": lit("http://commons.wikimedia.org/wiki/Special:FilePath/Eger%20castle.jpg"),
            "s": lit("25"),
            "a": {"type": "uri", "value": "https://hu.wikipedia.org/wiki/Egri_v%C3%A1r"},
            "h": {"type": "uri", "value": E + "Q2"},
            "e": lit("200"),
            "adm": lit("Eger"),
            "classes": lit("Q23413|Q5"),
        },
        # magyar név nélkül kimarad
        {"item": {"type": "uri", "value": E + "Q3"}, "classes": lit("Q23413")},
        # koordináta nélkül: coord_quality none
        {"item": {"type": "uri", "value": E + "Q4"}, "l": lit("Valami"), "classes": lit("")},
    ]
    recs = rows_to_records(rows, {"Q23413": "Q23413"})
    assert [r.ref for r in recs] == ["Q1", "Q4"]
    r = recs[0]
    assert (r.lat, r.lon) == (47.904, 20.378)
    assert r.cat == "var" and r.huwiki == "Egri vár" and r.image == "Eger castle.jpg"
    assert r.sitelinks == 25 and r.ele == 200 and r.settlement == "Eger"
    assert r.extra["heritage"] is True and r.flags & 1
    assert recs[1].coord_quality == "none" and recs[1].cat is None


def test_categorize_ignores_roots_removed_from_config():
    from terkep_pipeline.categorize import categorize_wikidata

    # régi térkép: a Q181623 egykor gyökér volt, azóta kikerült a configból
    stale = {"Q181623": "Q181623", "Q23413": "Q23413"}
    assert categorize_wikidata(["Q181623"], stale, "Valami") is None
    assert categorize_wikidata(["Q181623", "Q23413"], stale, "Egri vár") == "var"


class _FakeSparql:
    def __init__(self):
        self.queries = 0

    def post(self, url, data, headers=None, **kw):
        from terkep_pipeline.http import Response

        self.queries += 1
        qid = data["query"].split("wd:")[1].split(" ")[0]
        body = {"results": {"bindings": [{"s": {"type": "uri", "value": E + qid}}]}}
        import json as _json

        return Response(url, 200, _json.dumps(body), {})


def test_class_map_refreshes_when_roots_change(tmp_path):
    import json as _json

    from terkep_pipeline import config
    from terkep_pipeline.sources.wikidata import class_map

    path = tmp_path / "classes.json"
    # régi formátum (fingerprint nélkül) -> újratöltés
    path.write_text(_json.dumps({"Q181623": "Q181623"}))
    c = _FakeSparql()
    m = class_map(c, path=path)
    n_roots = len(config.categories()["wikidata_classes"])
    assert c.queries == n_roots and "Q181623" not in m
    # aktuális ujjlenyomattal: nincs újabb lekérdezés
    c2 = _FakeSparql()
    assert class_map(c2, path=path) == m and c2.queries == 0


class _TimeoutSparql:
    """Felderítő lekérdezés: túl sok osztályra (vagy a `bad` osztályokra) 504, egyébként
    osztályonként egy elem (Q<n> -> Q<n>000)."""

    def __init__(self, max_classes, bad=()):
        self.max_classes = max_classes
        self.bad = set(bad)
        self.sizes = []

    def post(self, url, data, headers=None, **kw):
        import json as _json
        import re

        from terkep_pipeline.http import Response

        classes = re.search(r"VALUES \?class \{([^}]*)\}", data["query"]).group(1).split()
        classes = [c.removeprefix("wd:") for c in classes]
        self.sizes.append(len(classes))
        if len(classes) > self.max_classes or self.bad & set(classes):
            return Response(url, 504, "upstream request timeout", {})
        rows = [{"item": {"type": "uri", "value": f"{E}{c}000"}} for c in classes]
        return Response(url, 200, _json.dumps({"results": {"bindings": rows}}), {})


def test_discover_halves_batches_that_time_out():
    from terkep_pipeline.sources.wikidata import discover

    classes = [f"Q{i}" for i in range(1, 11)]
    c = _TimeoutSparql(max_classes=3)
    found, skipped = discover(c, classes)
    assert found == {f"{q}000" for q in classes} and skipped == []
    assert max(s for s in c.sizes if s <= 3) <= 3 and c.sizes[0] == 10


def test_discover_skips_single_class_that_keeps_failing():
    from terkep_pipeline.sources.wikidata import discover

    classes = [f"Q{i}" for i in range(1, 9)]
    found, skipped = discover(_TimeoutSparql(max_classes=100, bad={"Q5"}), classes)
    assert skipped == ["Q5"]
    assert found == {f"{q}000" for q in classes if q != "Q5"}


def test_discover_gives_up_when_service_is_down():
    import pytest

    from terkep_pipeline.sources.wikidata import MAX_SKIPPED_CLASSES, discover

    classes = [f"Q{i}" for i in range(1, 200)]
    c = _TimeoutSparql(max_classes=0)
    with pytest.raises(RuntimeError, match="elérhetetlen"):
        discover(c, classes)
    # nem járja végig mind a 199 osztályt egyesével
    assert sum(1 for s in c.sizes if s == 1) == MAX_SKIPPED_CLASSES + 1


def test_split_queries_use_few_retries_others_more():
    from terkep_pipeline.sources import wikidata

    seen = []

    class C:
        def post(self, url, data, headers=None, **kw):
            from terkep_pipeline.http import Response

            seen.append(kw["attempts"])
            return Response(url, 200, '{"results": {"bindings": []}}', {})

    wikidata.discover(C(), ["Q1"])
    wikidata.enrich(C(), [f"Q{i}" for i in range(1, 50)], {})
    wikidata.enrich(C(), ["Q1"], {})
    wikidata._sparql(C(), "SELECT 1")
    assert seen == [wikidata.SPLIT_ATTEMPTS] * 2 + [wikidata.SPARQL_ATTEMPTS] * 2
    assert wikidata.SPLIT_ATTEMPTS < wikidata.SPARQL_ATTEMPTS


def test_photosphere_p4640_becomes_pano_flag():
    from terkep_pipeline import config
    from terkep_pipeline.conflate import build_poi, conflate
    from terkep_pipeline.models import FLAG_PANO

    rows = [
        {
            "item": {"type": "uri", "value": E + "Q10"},
            "c": lit("Point(18.98 47.79)"),
            "l": lit("Visegrádi fellegvár"),
            "ps": lit("http://commons.wikimedia.org/wiki/Special:FilePath/Visegr%C3%A1d%20360.jpg"),
            "classes": lit("Q23413"),
        }
    ]
    rec = rows_to_records(rows, {"Q23413": "Q23413"})[0]
    assert rec.extra["pano"] == "Visegrád 360.jpg"
    conf = conflate([rec], ["wikidata"], config.sources()["sources"])
    poi = build_poi(conf.clusters[0])
    assert poi.pano == "Visegrád 360.jpg"
    assert poi.flags & FLAG_PANO
    assert poi.to_json()["pano"] == "Visegrád 360.jpg"


def test_truncated_200_response_splits_and_is_not_cached(tmp_path):
    """A WDQS időtúllépéskor 200-zal, csonka JSON-nal is válaszolhat (8. futás után a 10.)."""
    import re

    from terkep_pipeline.http import PoliteClient
    from terkep_pipeline.sources.wikidata import discover

    class Session:
        def __init__(self):
            self.sizes = []

        def request(self, method, url, data=None, **kw):
            classes = re.search(r"VALUES \?class \{([^}]*)\}", data["query"]).group(1).split()
            self.sizes.append(len(classes))

            class R:
                status_code = 200
                headers = {}

            if len(classes) > 2:
                R.text = '{"results": {"bindings": [{"item": {"type": "uri", "value": "x\u0001'
            else:
                R.text = json.dumps(
                    {
                        "results": {
                            "bindings": [{"item": {"type": "uri", "value": E + c[3:] + "0"}} for c in classes]
                        }
                    }
                )
            return R()

    import json

    c = PoliteClient(cache_dir=tmp_path, default_interval_s=0)
    c.session = Session()
    c.mark_api_host("query.wikidata.org")
    found, skipped = discover(c, [f"Q{i}" for i in range(1, 5)])
    assert found == {f"Q{i}0" for i in range(1, 5)} and skipped == []
    # a csonka válasz nem maradt a gyorsítótárban: újrafuttatva ismét lekéri (és ismét feloszt)
    before = len(c.session.sizes)
    discover(c, [f"Q{i}" for i in range(1, 5)])
    assert c.session.sizes[before] == 4


def test_rows_to_records_keeps_classes():
    rows = [{"item": {"type": "uri", "value": E + "Q1"}, "l": lit("Zselic"), "classes": lit("Q54050|Q82794")}]
    rec = rows_to_records(rows, {"Q54050": "Q54050"})[0]
    assert rec.cat == "csucs" and rec.extra["classes"] == ["Q54050", "Q82794"]


class _LabelSparql:
    """Címke-lekérdezés: minden QID-re angol és magyar címke."""

    def __init__(self):
        self.queries = 0

    def post(self, url, data, headers=None, **kw):
        import json as _json
        import re

        from terkep_pipeline.http import Response

        self.queries += 1
        qids = re.findall(r"wd:(Q\d+)", data["query"])
        rows = []
        for q in qids:
            for lang in ("en", "hu"):
                rows.append(
                    {"q": {"type": "uri", "value": E + q}, "l": lit(f"{q}-{lang}"), "lang": lit(lang)}
                )
        return Response(url, 200, _json.dumps({"results": {"bindings": rows}}), {})


def test_class_labels_in_batches():
    from terkep_pipeline.sources import wikidata

    c = _LabelSparql()
    qids = [f"Q{i}" for i in range(1, wikidata.LABEL_BATCH + 6)]
    labels = wikidata.class_labels(c, qids)
    assert c.queries == 2
    assert labels["Q1"] == {"en": "Q1-en", "hu": "Q1-hu"} and len(labels) == len(qids)


def test_peak_class_report_lists_wikidata_only_peaks():
    from terkep_pipeline import config
    from terkep_pipeline.build import wikidata_only_peak_classes
    from terkep_pipeline.conflate import conflate
    from terkep_pipeline.models import SourceRecord

    recs = [
        # tájegység: csak Wikidata
        SourceRecord(
            source="wikidata",
            ref="Q1",
            name="Zselic",
            lat=46.2,
            lon=17.8,
            cat="csucs",
            wikidata="Q1",
            extra={"classes": ["Q54050", "Q82794"]},
        ),
        # valódi csúcs OSM-ponttal: nem kerül a listába
        SourceRecord(
            source="osm", ref="n1", name="Kékes", lat=47.873, lon=20.009, cat="csucs", wikidata="Q2"
        ),
        SourceRecord(
            source="wikidata",
            ref="Q2",
            name="Kékes",
            lat=47.873,
            lon=20.009,
            cat="csucs",
            wikidata="Q2",
            extra={"classes": ["Q8502"]},
        ),
    ]
    conf = conflate(recs, ["osm", "wikidata"], config.sources()["sources"])
    lines = wikidata_only_peak_classes(conf, labels={"Q82794": {"hu": "régió", "en": "region"}})
    text = "\n".join(lines)
    assert "1 csúcsnak nincs OSM-pontja" in text
    assert "| Q82794 | régió / region | 1 | Zselic |" in text
    assert "Q8502" not in text and "Kékes" not in text


def _wd_only_cluster(name, classes, extra_osm=False):
    from terkep_pipeline import config
    from terkep_pipeline.conflate import conflate
    from terkep_pipeline.models import SourceRecord

    recs = [
        SourceRecord(
            source="wikidata",
            ref="Q9",
            name=name,
            lat=46.2,
            lon=17.8,
            cat="csucs",
            wikidata="Q9",
            extra={"classes": classes},
        )
    ]
    if extra_osm:
        recs.append(
            SourceRecord(source="osm", ref="n9", name=name, lat=46.2, lon=17.8, cat="csucs", wikidata="Q9")
        )
    conf = conflate(recs, ["osm", "wikidata"], config.sources()["sources"])
    return conf.clusters[0]


def test_landscape_units_are_not_peaks():
    from terkep_pipeline.build import landscape_reason

    # kistáj-osztály (Zselic), középtáj (Zalai-dombság), névvég (Csíki-hegyek), TT
    assert "Q1162817" in landscape_reason(_wd_only_cluster("Zselic", ["Q54050", "Q1162817"]))
    assert landscape_reason(_wd_only_cluster("Zalai-dombság", ["Q54050"])) == "tájegység, nem csúcs (név)"
    assert landscape_reason(_wd_only_cluster("Csíki-hegyek", ["Q54050"]))
    assert landscape_reason(_wd_only_cluster("Rupp-hegy természetvédelmi terület", ["Q54050"]))
    # valódi csúcsok maradnak (a Natura 2000 nem kizáró, a Nagy-Banyászó neve sem)
    assert landscape_reason(_wd_only_cluster("Sár-hegy", ["Q207326", "Q15069452"])) is None
    assert landscape_reason(_wd_only_cluster("Nagy-Banyászó", ["Q8502"])) is None
    # OSM-pontos csúcshoz nem nyúl, akkor sem, ha a Wikidata-elem kistáj is
    assert landscape_reason(_wd_only_cluster("Karancs", ["Q8502", "Q1162817"], extra_osm=True)) is None
