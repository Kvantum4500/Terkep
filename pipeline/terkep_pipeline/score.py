"""Fontossági pontszám és szintek (1 = kiemelt, 2 = érdekes, 3 = helyi)."""

from __future__ import annotations

import math
from collections import Counter, defaultdict

from . import config
from .models import FLAG_HERITAGE, FLAG_IMAGE, Poi

TIER1_FRACTION = 0.015
TIER2_FRACTION = 0.12
COUNTY_MIN_TIER2 = 8


def score_poi(poi: Poi) -> float:
    srcs = config.sources()["sources"]
    cats = config.categories()["categories"]
    meta = poi.meta
    sources: set[str] = meta.get("sources", set())

    s = 0.0
    if poi.huwiki:
        s += 3.0
    s += min(6.0, 1.5 * math.log2(1 + meta.get("sitelinks", 0)))
    editorial = sum(1 for k in sources if srcs.get(k, {}).get("kind") == "editorial")
    registry = sum(1 for k in sources if srcs.get(k, {}).get("kind") == "registry")
    s += min(4.0, 2.0 * editorial)
    s += 0.5 * registry
    if poi.flags & FLAG_HERITAGE:
        s += 2.0
    if poi.flags & FLAG_IMAGE:
        s += 1.0
    s += float(cats[poi.cat].get("base", 0.0))
    if poi.cat == "barlang" and meta.get("showcave"):
        s += 3.0
    if poi.cat == "csucs" and poi.ele is not None:
        if poi.ele >= 900:
            s += 2.0
        elif poi.ele >= 700:
            s += 1.0
    if meta.get("generic"):
        s -= 1.5
    return s


def assign_tiers(
    pois: list[Poi],
    tier1_fraction: float = TIER1_FRACTION,
    tier2_fraction: float = TIER2_FRACTION,
    county_min: int = COUNTY_MIN_TIER2,
) -> None:
    """Rangsor alapján szintez, kategóriánkénti plafonnal és vármegyénkénti
    minimummal. A kézi szint (minta/overrides) mindig felülír."""
    cats = config.categories()["categories"]
    for p in pois:
        p.score = score_poi(p)
    ranked = sorted(pois, key=lambda p: (-p.score, p.id))
    n = len(ranked)
    n1 = math.ceil(n * tier1_fraction)
    n2 = math.ceil(n * tier2_fraction)
    tier1_by_cat: Counter[str] = Counter()
    c1 = c2 = 0
    for p in ranked:
        cap = cats[p.cat].get("tier1_cap", n)
        if c1 < n1 and tier1_by_cat[p.cat] < cap:
            p.tier = 1
            c1 += 1
            tier1_by_cat[p.cat] += 1
        elif c2 < n2:
            p.tier = 2
            c2 += 1
        else:
            p.tier = 3

    by_county: dict[str, list[Poi]] = defaultdict(list)
    for p in ranked:
        by_county[p.county].append(p)
    for plist in by_county.values():
        for p in plist[:county_min]:
            p.tier = min(p.tier, 2)

    for p in pois:
        hint = p.meta.get("tier_hint")
        if hint:
            p.tier = int(hint)
