"""Besorolás: OSM-címkék és Wikidata-osztályok -> kategória (+ alkategória)."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import cache
from typing import Any

from . import config


@dataclass(frozen=True)
class Rule:
    cat: str
    when: tuple[tuple[str, Any], ...]
    not_: tuple[tuple[str, Any], ...]
    name: re.Pattern[str] | None
    name_not: re.Pattern[str] | None
    require: tuple[Any, ...]
    sub: str | None
    sub_from: tuple[tuple[str, tuple[tuple[str, str], ...]], ...]


def _tag_matches(tags: Mapping[str, str], key: str, expected: Any) -> bool:
    val = tags.get(key)
    if val is None:
        return False
    if expected == "*":
        return True
    if isinstance(expected, list):
        return val in [str(e) for e in expected]
    return val == str(expected)


@cache
def osm_rules() -> tuple[Rule, ...]:
    rules = []
    valid = set(config.category_keys())
    for raw in config.categories()["osm_rules"]:
        if raw["cat"] not in valid:
            raise ValueError(f"Ismeretlen kategória a szabályban: {raw}")
        rules.append(
            Rule(
                cat=raw["cat"],
                when=tuple((raw.get("when") or {}).items()),
                not_=tuple((raw.get("not") or {}).items()),
                name=re.compile(raw["name"], re.IGNORECASE) if raw.get("name") else None,
                name_not=re.compile(raw["name_not"], re.IGNORECASE) if raw.get("name_not") else None,
                require=tuple(raw.get("require") or ()),
                sub=raw.get("sub"),
                sub_from=tuple(
                    (k, tuple((str(vk), vv) for vk, vv in v.items()))
                    for k, v in (raw.get("sub_from") or {}).items()
                ),
            )
        )
    return tuple(rules)


def is_notable(tags: Mapping[str, str]) -> bool:
    return any(
        k in tags for k in ("wikidata", "wikipedia", "heritage", "heritage:operator", "ref:hu:muemlek")
    )


def _requirements_met(rule: Rule, tags: Mapping[str, str], area_km2: float | None) -> bool:
    for req in rule.require:
        if req == "notable":
            if not is_notable(tags):
                return False
        elif isinstance(req, dict) and "area_km2" in req:
            if area_km2 is None or area_km2 < float(req["area_km2"]):
                return False
        else:
            raise ValueError(f"Ismeretlen require: {req!r}")
    return True


def categorize_osm(tags: Mapping[str, str], area_km2: float | None = None) -> tuple[str, str | None] | None:
    """Visszaadja a (kategória, alkategória) párt, vagy None-t, ha nem látnivaló."""
    name = tags.get("name")
    if not name:
        return None
    for rule in osm_rules():
        if not all(_tag_matches(tags, k, v) for k, v in rule.when):
            continue
        if any(_tag_matches(tags, k, v) for k, v in rule.not_):
            continue
        if rule.name and not rule.name.search(name):
            continue
        if rule.name_not and rule.name_not.search(name):
            continue
        if not _requirements_met(rule, tags, area_km2):
            continue
        sub = rule.sub
        for key, mapping in rule.sub_from:
            val = tags.get(key)
            hit = dict(mapping).get(val) if val is not None else None
            if hit:
                sub = hit
                break
        return rule.cat, sub
    return None


def osm_prefilter_keys() -> set[str]:
    """Azok a címkekulcsok, amelyek bármely szabály `when` feltételében szerepelnek
    (az osmium előszűréshez)."""
    keys: set[str] = set()
    for rule in osm_rules():
        for k, _ in rule.when:
            keys.add(k)
    return keys


# --- Wikidata -------------------------------------------------------------


def categorize_wikidata(
    instance_of: Iterable[str], class_to_root: Mapping[str, str], name: str | None = None
) -> str | None:
    """P31 értékek -> kategória.

    class_to_root: osztály QID -> gyökérosztály QID (az alosztályfából).
    A gyökerek sorrendje a categories.yaml-ben adja a prioritást. A név a
    vár/kastély szétválasztásban segít (a Q23413 „castle” mindkettőt fedi).
    """
    roots = config.categories()["wikidata_classes"]
    order = {r["qid"]: i for i, r in enumerate(roots)}
    cat_of = {r["qid"]: r["cat"] for r in roots}
    # csak a konfigurációban (még) szereplő gyökerek számítanak (régi térkép ellen)
    hits = sorted(
        {class_to_root[c] for c in instance_of if c in class_to_root and class_to_root[c] in order},
        key=lambda q: order[q],
    )
    if not hits:
        return None
    cat = cat_of[hits[0]]
    if cat == "var" and name and re.search(r"kastély|kúria|palota", name, re.IGNORECASE):
        return "kastely"
    if cat == "kastely" and name and re.search(r"\bvár\b|vára\b|erőd", name, re.IGNORECASE):
        return "var"
    return cat
