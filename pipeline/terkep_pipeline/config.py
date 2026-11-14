"""Konfigurációs fájlok betöltése (egyszer, gyorsítótárazva)."""

from __future__ import annotations

from functools import cache
from pathlib import Path
from typing import Any

import yaml

from . import CONFIG_DIR, CURATION_DIR


def _load(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


@cache
def categories() -> dict[str, Any]:
    return _load(CONFIG_DIR / "categories.yaml")


@cache
def counties() -> dict[str, Any]:
    return _load(CONFIG_DIR / "counties.yaml")


@cache
def sources() -> dict[str, Any]:
    return _load(CONFIG_DIR / "sources.yaml")


@cache
def huwiki_lists() -> dict[str, Any]:
    return _load(CONFIG_DIR / "huwiki_lists.yaml")


@cache
def overrides() -> dict[str, Any]:
    data = _load(CURATION_DIR / "overrides.yaml") or {}
    return data


@cache
def golden() -> list[dict[str, Any]]:
    return _load(CURATION_DIR / "golden.yaml")["golden"]


def source_cfg(key: str) -> dict[str, Any]:
    return sources()["sources"][key]


def category_keys() -> list[str]:
    return list(categories()["categories"].keys())


def county_codes() -> list[str]:
    return list(counties()["counties"].keys())
