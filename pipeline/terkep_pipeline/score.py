"""Fontossági pontszám és szintek (1 = kiemelt, 2 = érdekes, 3 = helyi)."""

from __future__ import annotations

import math
from collections import defaultdict

from . import config
from .models import FLAG_BY_NAME, FLAG_HERITAGE, FLAG_IMAGE, FLAG_SHOWCAVE, Poi

TIER1_MIN_SCORE = 5.0
TIER2_FRACTION = 0.12
COUNTY_MIN_TIER2 = 8
SITELINKS_CAP = 8.0
SHOWCAVE_BONUS = 5.0


def score_poi(poi: Poi) -> float:
    srcs = config.sources()["sources"]
    cats = config.categories()["categories"]
    meta = poi.meta
    sources: set[str] = meta.get("sources", set())

    s = 0.0
    if poi.huwiki:
        s += 3.0
    # sok nyelvű Wikipédia-cikk = országosan ismert hely (40 nyelv ~ 8 pont)
    s += min(SITELINKS_CAP, 1.5 * math.log2(1 + meta.get("sitelinks", 0)))
    editorial = sum(1 for k in sources if srcs.get(k, {}).get("kind") == "editorial")
    registry = sum(1 for k in sources if srcs.get(k, {}).get("kind") == "registry")
    s += min(4.0, 2.0 * editorial)
    s += 0.5 * registry
    if poi.flags & FLAG_HERITAGE:
        s += 2.0
    if poi.flags & FLAG_IMAGE:
        s += 1.0
    s += float(cats[poi.cat].get("base", 0.0))
    if poi.cat == "barlang" and (meta.get("showcave") or poi.flags & FLAG_SHOWCAVE):
        s += SHOWCAVE_BONUS
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
    tier2_fraction: float = TIER2_FRACTION,
    county_min: int = COUNTY_MIN_TIER2,
    tier1_min_score: float = TIER1_MIN_SCORE,
) -> None:
    """Szintezés:
    - 1 (kiemelt): kategóriánként a legjobb `tier1_quota` pont, ha eléri a
      minimumpontszámot (és megvan a `tier1_requires` jelző, pl. látogatható barlang);
    - 2 (érdekes): a maradékból az országos rangsor felső `tier2_fraction` része,
      plusz vármegyénként legalább `county_min` pont;
    - 3 (helyi): a többi.
    A kézi szint (mintaadat, overrides.yaml) mindig felülír."""
    cats = config.categories()["categories"]
    for p in pois:
        p.score = score_poi(p)
        p.tier = 3
    ranked = sorted(pois, key=lambda p: (-p.score, p.id))

    by_cat: dict[str, list[Poi]] = defaultdict(list)
    for p in ranked:
        by_cat[p.cat].append(p)
    for cat, plist in by_cat.items():
        quota = int(cats[cat].get("tier1_quota", 0))
        required = FLAG_BY_NAME.get(cats[cat].get("tier1_requires", ""), 0)
        given = 0
        for p in plist:
            if given >= quota or p.score < tier1_min_score:
                break
            if required and not p.flags & required:
                continue
            p.tier = 1
            given += 1

    n2 = math.ceil(len(ranked) * tier2_fraction)
    c2 = 0
    for p in ranked:
        if p.tier == 1:
            continue
        if c2 >= n2:
            break
        p.tier = 2
        c2 += 1

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
