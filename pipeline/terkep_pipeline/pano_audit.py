"""360°-os képek lefedettsége a kiemelt helyeken (riport az adatfrissítéshez).

Ugyanazzal a Commons-lekérdezéssel dolgozik, mint az app (web/src/pano/find.ts):
geokeresés 1 km-en belül, gömbpanoráma = 2:1 oldalarány; körpanoráma = legalább
3,5:1 és „360” a címben vagy a kategóriában. Mellé a Google-utcakép (sv) és a
Wikidata-gömbkép (P4640) jelzője az adatból.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from .http import PoliteClient
from .models import FLAG_PANO, FLAG_STREETVIEW

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
RADIUS_M = 1000
PANO_WORD = re.compile(r"360|panoram|spherical|equirectangular|photosphere|gömbpanor|körpanor", re.I)


def classify(width: int, height: int, title: str, categories: list[str]) -> str | None:
    """'sphere' (gömb), 'cylinder' (360°-os körpanoráma) vagy None."""
    if not width or not height:
        return None
    ratio = width / height
    tagged = bool(PANO_WORD.search(title)) or any(PANO_WORD.search(c) for c in categories)
    if abs(ratio - 2) <= 0.04 and width >= 3000:
        return "sphere"
    if abs(ratio - 2) <= 0.1 and width >= 2000 and tagged:
        return "sphere"
    has360 = "360" in title or any("360" in c for c in categories)
    if ratio >= 3.5 and width >= 3000 and has360:
        return "cylinder"
    return None


def commons_panos(client: PoliteClient, lat: float, lon: float) -> list[tuple[str, str]]:
    resp = client.get(
        COMMONS_API,
        params={
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "generator": "geosearch",
            "ggscoord": f"{lat}|{lon}",
            "ggsradius": str(RADIUS_M),
            "ggsnamespace": "6",
            "ggslimit": "50",
            "prop": "imageinfo|categories",
            "iiprop": "size",
            "clshow": "!hidden",
            "cllimit": "max",
        },
    )
    if resp.status >= 400:
        return []
    out = []
    for p in resp.json().get("query", {}).get("pages", []):
        ii = (p.get("imageinfo") or [{}])[0]
        kind = classify(
            ii.get("width", 0), ii.get("height", 0), p["title"], [c["title"] for c in p.get("categories", [])]
        )
        if kind:
            out.append((p["title"], kind))
    return out


def audit(client: PoliteClient, rows: list[dict[str, Any]], max_tier: int = 1) -> str:
    todo = [r for r in rows if r["tier"] <= max_tier]
    by_cat: dict[str, Counter] = {}
    missing_castles = []
    for r in todo:
        c = by_cat.setdefault(r["cat"], Counter())
        c["n"] += 1
        sv = bool(r["flags"] & FLAG_STREETVIEW)
        wd = bool(r["flags"] & FLAG_PANO)
        found = commons_panos(client, r["lat"], r["lon"])
        kinds = {k for _, k in found}
        c["sv"] += sv
        c["wd"] += wd
        c["sphere"] += "sphere" in kinds
        c["cylinder"] += "cylinder" in kinds
        c["any"] += sv or wd or bool(kinds)
        if r["cat"] in ("var", "kastely") and not (sv or wd or kinds):
            missing_castles.append(r["name"])
    total = Counter()
    for c in by_cat.values():
        total.update(c)
    lines = [
        f"# 360°-os képek a {max_tier}. szintig ({total['n']} hely)",
        "",
        "| Kategória | Db | Google-utcakép | Wikidata-gömbkép | Commons gömb (1 km) | Commons 360° kör | Bármelyik |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for cat, c in sorted(by_cat.items(), key=lambda kv: -kv[1]["n"]):
        lines.append(
            f"| {cat} | {c['n']} | {c['sv']} | {c['wd']} | {c['sphere']} | {c['cylinder']} | {c['any']} |"
        )
    lines.append(
        f"| **összesen** | {total['n']} | {total['sv']} | {total['wd']} | {total['sphere']} | "
        f"{total['cylinder']} | {total['any']} |"
    )
    if missing_castles:
        lines += [
            "",
            f"Vár/kastély semmilyen 360°-os képpel ({len(missing_castles)}): "
            + ", ".join(sorted(missing_castles)[:40]),
        ]
    return "\n".join(lines) + "\n"
