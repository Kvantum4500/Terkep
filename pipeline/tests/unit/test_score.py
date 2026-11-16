from collections import Counter

import pytest

from terkep_pipeline.models import FLAG_HERITAGE, FLAG_SHOWCAVE, Poi
from terkep_pipeline.score import assign_tiers, score_poi


def poi(i, cat="var", county="PE", sitelinks=0, flags=0, huwiki=None, sources=("osm",), **meta):
    p = Poi(id=f"n{i}", name=f"P{i}", cat=cat, lat=47.0, lon=19.0, county=county, flags=flags, huwiki=huwiki)
    p.meta = {"sitelinks": sitelinks, "sources": set(sources), "generic": False, **meta}
    return p


def test_score_components():
    base = score_poi(poi(1))
    assert score_poi(poi(2, huwiki="X")) == base + 3
    assert score_poi(poi(3, flags=FLAG_HERITAGE)) == base + 2
    # szerkesztett forrás (pl. kektura) +2
    assert score_poi(poi(4, sources=("osm", "kektura"))) == base + 2
    # templom alappontja kisebb, mint a váré
    assert score_poi(poi(5, cat="templom")) < base
    # látogatható barlang bónusz
    assert score_poi(poi(6, cat="barlang", showcave=True)) == score_poi(poi(7, cat="barlang")) + 5
    # a sok nyelvű Wikipédia-cikk többet ér, de legfeljebb 8 pontot
    assert score_poi(poi(8, sitelinks=40)) - base == pytest.approx(8.0, abs=0.05)
    assert score_poi(poi(9, sitelinks=400)) - base == 8.0


def test_tier1_quota_per_category():
    # 300 templom és 300 csúcs, a templomok pontszáma magasabb: globális rangsorral
    # a templomok vinnék el a kiemelt helyeket, kvótával mindkét kategória kap
    pois = [poi(i, cat="templom", sitelinks=i % 37, huwiki="X") for i in range(300)]
    pois += [poi(1000 + i, cat="csucs", sitelinks=i % 30) for i in range(300)]
    assign_tiers(pois, tier2_fraction=0.1, county_min=0)
    t1 = Counter(p.cat for p in pois if p.tier == 1)
    assert t1 == {"templom": 100, "csucs": 50}  # categories.yaml tier1_quota
    # kategórián belül a kiemeltek pontszáma nem kisebb a többiekénél
    for cat in ("templom", "csucs"):
        t1_min = min(p.score for p in pois if p.cat == cat and p.tier == 1)
        rest_max = max(p.score for p in pois if p.cat == cat and p.tier != 1)
        assert t1_min >= rest_max
    # 2. szint: a maradék országos rangsorának felső 10%-a
    assert sum(1 for p in pois if p.tier == 2) == 60


def test_tier1_min_score_and_required_flag():
    weak = [poi(i, cat="kert") for i in range(5)]  # pontszám ~1 < 5
    caves = [poi(10, cat="barlang", sitelinks=100, huwiki="X"), poi(11, cat="barlang", flags=FLAG_SHOWCAVE)]
    assign_tiers(weak + caves, tier2_fraction=0.0, county_min=0, tier1_min_score=1.5)
    assert all(p.tier == 3 for p in weak)
    # a nagy pontszámú, de nem látogatható barlang nem lehet kiemelt
    assert caves[0].tier == 3 and caves[1].tier == 1


def test_county_minimum():
    pois = [poi(i, county="PE", sitelinks=100) for i in range(50)] + [
        poi(100 + i, county="BE") for i in range(10)
    ]
    assign_tiers(pois, tier2_fraction=0.02, county_min=8)
    be = [p for p in pois if p.county == "BE"]
    assert sum(1 for p in be if p.tier <= 2) == 8


def test_tier_hint_wins():
    p = poi(1, tier_hint=1)
    q = poi(2, sitelinks=100)
    assign_tiers([p, q], tier2_fraction=0.01, county_min=0)
    assert p.tier == 1
