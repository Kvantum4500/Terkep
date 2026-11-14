from pathlib import Path

import pytest

from terkep_pipeline.sources.osm_pbf import extract

FIXTURE = Path(__file__).parent.parent / "fixtures" / "mini.osm"


@pytest.fixture(scope="module")
def extracted():
    return extract(FIXTURE)


def test_records(extracted):
    recs, _, _ = extracted
    by_name = {r.name: r for r in recs}
    assert set(by_name) == {"Próbavár", "Próba-barlang", "Szent Próba-templom", "Próba-bazaltorgona"}

    var = by_name["Próbavár"]
    assert (var.ref, var.cat, var.wikidata, var.huwiki) == ("n10", "var", "Q123", "Próbavár")
    assert var.extra.get("heritage") is True

    assert by_name["Próba-barlang"].extra.get("showcave") is True

    church = by_name["Szent Próba-templom"]
    assert church.ref == "w200" and church.cat == "templom"
    assert 47.05 <= church.lat <= 47.051 and 19.05 <= church.lon <= 19.051

    cliff = by_name["Próba-bazaltorgona"]
    assert cliff.ref == "w300" and (cliff.cat, cliff.sub) == ("szikla", "bazaltorgona")
    assert cliff.lon == pytest.approx(19.16)


def test_county_boundary(extracted):
    _, counties, _ = extracted
    assert set(counties) == {"PE"}
    assert counties["PE"].area == pytest.approx(0.04)
