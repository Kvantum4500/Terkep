"""Kimenetek írása a data/ könyvtárba (a pipeline és a web közti szerződés)."""

from __future__ import annotations

import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import jsonschema

from . import DATA_DIR, config
from .models import FLAG_BY_NAME, Poi

SCHEMA_PATH = DATA_DIR / "schema" / "poi.schema.json"


def _dump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def load_ndjson(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def validate(rows: list[dict[str, Any]]) -> None:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    for row in rows:
        errors = sorted(validator.iter_errors(row), key=lambda e: e.path)
        if errors:
            raise ValueError(f"Sémahiba ({row.get('id')}): {errors[0].message}")


def compute_aliases(
    old_rows: list[dict[str, Any]], new_rows: list[dict[str, Any]], old_aliases: dict[str, str]
) -> dict[str, str]:
    """Ha egy látnivaló azonosítója megváltozott (pl. kapott Wikidata QID-t),
    a régi -> új leképezést megőrizzük, hogy a készüléken tárolt kedvencek
    és látogatások ne vesszenek el."""
    new_ids = {r["id"] for r in new_rows}
    ref_to_new: dict[str, str] = {}
    for r in new_rows:
        for s in r.get("sources", []):
            ref_to_new[f"{s['s']}:{s['ref']}"] = r["id"]
    aliases = dict(old_aliases)
    for r in old_rows:
        if r["id"] in new_ids:
            continue
        for s in r.get("sources", []):
            target = ref_to_new.get(f"{s['s']}:{s['ref']}")
            if target:
                aliases[r["id"]] = target
                break
    # láncok feloldása (a -> b -> c  =>  a -> c), és a ma is létező id-k kivétele
    for k in list(aliases):
        seen = {k}
        v = aliases[k]
        while v in aliases and v not in seen:
            seen.add(v)
            v = aliases[v]
        aliases[k] = v
        if k in new_ids:
            del aliases[k]
    return dict(sorted(aliases.items()))


def build_meta(rows: list[dict[str, Any]], sample: bool, boundaries_source: str) -> dict[str, Any]:
    cats_cfg = config.categories()
    srcs = config.sources()["sources"]
    counties = config.counties()["counties"]
    used_sources = sorted({s["s"] for r in rows for s in r.get("sources", [])})
    by_county_cat: dict[str, Counter[str]] = {}
    for r in rows:
        by_county_cat.setdefault(r["county"], Counter())[r["cat"]] += 1
    return {
        "version": 1,
        "generated": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sample": sample,
        "boundaries": boundaries_source,
        "counts": {
            "total": len(rows),
            "by_tier": dict(sorted(Counter(str(r["tier"]) for r in rows).items())),
            "by_cat": dict(sorted(Counter(r["cat"] for r in rows).items())),
            "by_county": {k: dict(sorted(v.items())) for k, v in sorted(by_county_cat.items())},
        },
        "groups": cats_cfg["groups"],
        "categories": {
            k: {f: v[f] for f in ("label", "group", "icon", "color")}
            for k, v in cats_cfg["categories"].items()
        },
        "counties": {k: {"name": v["name"], "short": v["short"]} for k, v in counties.items()},
        "flags": FLAG_BY_NAME,
        "sources": {
            k: {
                "label": v["label"],
                "url": v.get("ref_url", ""),
                "license": v.get("license", ""),
                "kind": v["kind"],
            }
            for k, v in srcs.items()
            if k in used_sources or k in ("osm", "wikidata")
        },
    }


def write_outputs(
    pois: list[Poi], out_dir: Path, sample: bool, boundaries_source: str
) -> list[dict[str, Any]]:
    rows = sorted((p.to_json() for p in pois), key=lambda r: r["id"])
    validate(rows)
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        dup = [k for k, v in Counter(ids).items() if v > 1]
        raise ValueError(f"Ismétlődő azonosítók: {dup[:10]}")
    out_dir.mkdir(parents=True, exist_ok=True)
    pois_path = out_dir / "pois.ndjson"
    aliases_path = out_dir / "id_aliases.json"
    old_rows = load_ndjson(pois_path)
    old_aliases = json.loads(aliases_path.read_text(encoding="utf-8")) if aliases_path.exists() else {}
    aliases = compute_aliases(old_rows, rows, old_aliases)
    with pois_path.open("w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(_dump(r) + "\n")
    aliases_path.write_text(json.dumps(aliases, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    meta = build_meta(rows, sample, boundaries_source)
    (out_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    return rows
