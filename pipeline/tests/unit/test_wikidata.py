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

    def post(self, url, data, headers=None, timeout=None):
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
