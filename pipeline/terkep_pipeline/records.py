"""Forrásrekordok mentése/betöltése (pipeline/build/records/<forrás>.jsonl)."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from . import BUILD_DIR
from .models import SourceRecord

RECORDS_DIR = BUILD_DIR / "records"


def path_for(source: str, base: Path = RECORDS_DIR) -> Path:
    return base / f"{source}.jsonl"


def save(source: str, records: list[SourceRecord], base: Path = RECORDS_DIR) -> Path:
    base.mkdir(parents=True, exist_ok=True)
    p = path_for(source, base)
    with p.open("w", encoding="utf-8") as f:
        for r in sorted(records, key=lambda r: r.ref):
            f.write(json.dumps(asdict(r), ensure_ascii=False, separators=(",", ":")) + "\n")
    return p


def load(source: str, base: Path = RECORDS_DIR) -> list[SourceRecord]:
    p = path_for(source, base)
    if not p.exists():
        return []
    out = []
    with p.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                out.append(SourceRecord(**json.loads(line)))
    return out


def available(base: Path = RECORDS_DIR) -> list[str]:
    if not base.exists():
        return []
    return sorted(p.stem for p in base.glob("*.jsonl"))
