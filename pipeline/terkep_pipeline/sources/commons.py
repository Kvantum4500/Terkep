"""Wikimedia Commons: a képek szerzője és licence (a CC BY / BY-SA ezt előírja).

Kép csak akkor jelenik meg az appban, ha van licencadat; különben csak egy
hivatkozás a Commons-oldalra.
"""

from __future__ import annotations

import html
import json
import logging
import re
from collections.abc import Iterable
from pathlib import Path

from .. import BUILD_DIR, config
from ..http import PoliteClient
from ..models import SourceRecord

log = logging.getLogger(__name__)

META_PATH = BUILD_DIR / "records" / "commons_meta.json"
_TAG = re.compile(r"<[^>]+>")


def _clean(text: str | None) -> str | None:
    if not text:
        return None
    out = html.unescape(_TAG.sub("", text)).strip()
    return re.sub(r"\s+", " ", out)[:120] or None


def fetch_meta(client: PoliteClient, files: Iterable[str]) -> dict[str, dict[str, str]]:
    url = config.source_cfg("commons")["api_url"]
    names = sorted(set(files))
    out: dict[str, dict[str, str]] = {}
    for i in range(0, len(names), 50):
        chunk = names[i : i + 50]
        resp = client.get(
            url,
            params={
                "action": "query",
                "format": "json",
                "formatversion": "2",
                "prop": "imageinfo",
                "iiprop": "extmetadata",
                "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl",
                "titles": "|".join(f"File:{n}" for n in chunk),
            },
        )
        data = resp.json().get("query", {})
        norm = {n["to"]: n["from"] for n in data.get("normalized", [])}
        for p in data.get("pages", []):
            info = (p.get("imageinfo") or [{}])[0].get("extmetadata", {})
            title = norm.get(p["title"], p["title"]).removeprefix("File:")
            lic = _clean(info.get("LicenseShortName", {}).get("value"))
            if not lic:
                continue
            out[title] = {
                "file": title,
                "artist": _clean(info.get("Artist", {}).get("value")) or "ismeretlen",
                "license": lic,
                "license_url": (info.get("LicenseUrl", {}).get("value") or "").strip(),
            }
        if i % 1000 == 0:
            log.info("Commons: %d / %d", i + len(chunk), len(names))
    return out


def save_meta(meta: dict[str, dict[str, str]], path: Path = META_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=0), encoding="utf-8")


def load_meta(path: Path = META_PATH) -> dict[str, dict[str, str]]:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def attach(records: Iterable[SourceRecord], meta: dict[str, dict[str, str]]) -> None:
    for r in records:
        if r.image and r.image in meta:
            r.extra["image_meta"] = meta[r.image]
