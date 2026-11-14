"""Kézi mintaadat betöltése (pipeline/sample/records.yaml)."""

from __future__ import annotations

from pathlib import Path

import yaml

from .. import PIPELINE_DIR
from ..models import FLAG_BY_NAME, SourceRecord
from ..normalize import fold

SAMPLE_PATH = PIPELINE_DIR / "sample" / "records.yaml"


def load(path: Path = SAMPLE_PATH) -> list[SourceRecord]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    out = []
    for row in data["records"]:
        flags = 0
        for f in row.get("f", []) or []:
            flags |= FLAG_BY_NAME[f]
        extra = {"tier": row.get("t"), "expected_county": row.get("co")}
        if "showcave" in (row.get("f") or []):
            extra["showcave"] = True
        if "heritage" in (row.get("f") or []):
            extra["heritage"] = True
        out.append(
            SourceRecord(
                source="sample",
                ref=fold(row["n"]).replace(" ", "-"),
                name=row["n"],
                lat=float(row["lat"]),
                lon=float(row["lon"]),
                cat=row["c"],
                sub=row.get("sub"),
                settlement=row.get("s"),
                desc=row.get("d"),
                ele=row.get("ele"),
                flags=flags,
                extra=extra,
            )
        )
    return out
