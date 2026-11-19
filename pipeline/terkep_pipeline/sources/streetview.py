"""Google-utcakép (Street View) a kiemelt és érdekes helyek közelében.

A Street View Static API metaadat-végpontja ingyenes, és csak azt mondja meg, hogy
van-e felvétel egy adott sugárban, és pontosan hol. A felvétel helyét és a
látnivaló felé mutató irányt a details-be írjuk; az app ezzel nyitja meg a
beágyazott utcaképet (Maps Embed API), a látnivaló felé fordulva. A koordinátákat
a havi adatfrissítés tartja naprakészen (a Google 30 napig engedi a lat/lng
tárolását).

A kulcs csak környezeti változóból jön (GOOGLE_MAPS_SERVER_KEY), és sosem kerül a
naplóba: a repó és így az Actions-napló is nyilvános.
"""

from __future__ import annotations

import json
import logging
import math
import time
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from .. import BUILD_DIR

log = logging.getLogger(__name__)

METADATA_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"
OUT_PATH = BUILD_DIR / "streetview.json"
KEY_ENV = "GOOGLE_MAPS_SERVER_KEY"

# Hegyi vár, kilátó: a legközelebbi felvétel gyakran az odavezető úton vagy egy
# felhasználói gömbképen van, távolabb; templomnál, hídnál csak a közvetlen környezet számít.
RADIUS_M = {
    "var": 400,
    "kastely": 400,
    "rom": 400,
    "kilato": 400,
    "csucs": 400,
    "kilatopont": 300,
    "templom": 150,
    "hid": 150,
}
DEFAULT_RADIUS_M = 300

# ezeknél a válaszoknál nincs értelme folytatni (rossz vagy letiltott kulcs, elfogyott kvóta)
FATAL_STATUSES = {"REQUEST_DENIED", "OVER_QUERY_LIMIT", "OVER_DAILY_LIMIT", "INVALID_REQUEST"}


def radius_for(cat: str) -> int:
    return RADIUS_M.get(cat, DEFAULT_RADIUS_M)


def bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Kezdeti irányszög (fok, észak = 0, óramutató szerint) az 1. pontból a 2. felé."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def parse(meta: dict[str, Any], poi_lat: float, poi_lon: float) -> dict[str, float] | None:
    """Metaadat-válasz -> {lat, lon, h}, ha van felvétel."""
    if meta.get("status") != "OK" or "location" not in meta:
        return None
    lat = float(meta["location"]["lat"])
    lon = float(meta["location"]["lng"])
    return {"lat": round(lat, 6), "lon": round(lon, 6), "h": round(bearing(lat, lon, poi_lat, poi_lon))}


class FatalApiError(RuntimeError):
    pass


Getter = Callable[[dict[str, str]], dict[str, Any]]


def _requests_getter(key: str, timeout: float = 20.0, attempts: int = 3) -> Getter:
    import requests

    session = requests.Session()
    session.headers["User-Agent"] = "TerkepBot/0.1 (+https://github.com/Kvantum4500/Terkep)"

    def get(params: dict[str, str]) -> dict[str, Any]:
        last: Exception | None = None
        for attempt in range(attempts):
            try:
                r = session.get(METADATA_URL, params={**params, "key": key}, timeout=timeout)
            except requests.RequestException as exc:  # a kivétel szövegében az URL (kulcs!) lehet
                last = RuntimeError(type(exc).__name__)
            else:
                if r.status_code < 500 and r.status_code != 429:
                    return r.json()
                last = RuntimeError(f"HTTP {r.status_code}")
            time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"Utcakép-metaadat sikertelen: {last}")

    return get


def fetch(
    rows: Iterable[dict[str, Any]],
    key: str | None = None,
    max_tier: int = 2,
    getter: Getter | None = None,
    interval_s: float = 0.05,
) -> dict[str, dict[str, float]]:
    """A legfeljebb `max_tier` szintű látnivalókhoz a legközelebbi utcakép helye és iránya."""
    if getter is None:
        if not key:
            raise ValueError("Nincs Google-kulcs")
        getter = _requests_getter(key)
    todo = [r for r in rows if r["tier"] <= max_tier]
    out: dict[str, dict[str, float]] = {}
    errors = 0
    for n, r in enumerate(todo, 1):
        params = {
            "location": f"{r['lat']},{r['lon']}",
            "radius": str(radius_for(r["cat"])),
            # a felhasználói gömbképek (pl. várbelsők) is számítanak
            "source": "default",
        }
        try:
            meta = getter(params)
        except RuntimeError as exc:
            errors += 1
            log.warning("Utcakép: %s – %s", r["id"], exc)
            if errors > 25:
                raise RuntimeError("Túl sok hiba az utcakép-lekérdezésnél, leállok.") from exc
            continue
        status = meta.get("status", "")
        if status in FATAL_STATUSES:
            # az error_message-et nem naplózzuk teljesen (biztonsági okból csak a státuszt)
            raise FatalApiError(f"A Google-API elutasította a kérést: {status}")
        sv = parse(meta, r["lat"], r["lon"])
        if sv:
            out[r["id"]] = sv
        if n % 500 == 0:
            log.info("Utcakép: %d / %d, találat: %d", n, len(todo), len(out))
        if interval_s:
            time.sleep(interval_s)
    log.info("Utcakép: %d helyből %d-nál van felvétel", len(todo), len(out))
    return out


def save(data: dict[str, dict[str, float]], path: Path | None = None) -> None:
    path = path or OUT_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")


def load(path: Path | None = None) -> dict[str, dict[str, float]]:
    path = path or OUT_PATH
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))
