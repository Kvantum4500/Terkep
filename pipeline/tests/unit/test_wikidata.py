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
