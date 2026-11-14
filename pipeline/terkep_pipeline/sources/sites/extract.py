"""Általános tény-kinyerő HTML-oldalakból: név, koordináta, település.

Csak tényeket keresünk (leírást, képet nem veszünk át). Koordináta-forrásként
sorban próbáljuk:
  1. JSON-LD (schema.org GeoCoordinates / Place)
  2. <meta name="geo.position"> / ICBM / place:location:*
  3. data-lat / data-lng (data-lon) attribútumok
  4. térképlinkek (Google Maps ?q=lat,lon / @lat,lon, OSM mlat/mlon)
  5. GPX-letöltési hivatkozások (külön visszaadva)
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import urljoin

from ...geo import in_hu_bbox

_NUM = r"(-?\d{1,2}\.\d{3,})"
_MAPS_Q = re.compile(r"[?&](?:q|query|ll|center)=" + _NUM + r"\s*,\s*" + _NUM)
_MAPS_AT = re.compile(r"@" + _NUM + r"," + _NUM)
_OSM = re.compile(r"mlat=" + _NUM + r".*?mlon=" + _NUM)


@dataclass
class PageFacts:
    url: str
    name: str | None = None
    lat: float | None = None
    lon: float | None = None
    settlement: str | None = None
    coord_source: str | None = None
    gpx_links: list[str] = field(default_factory=list)
    types: list[str] = field(default_factory=list)


class _Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.jsonld: list[str] = []
        self.links: list[str] = []
        self.data_coords: list[tuple[str, str]] = []
        self.h1: list[str] = []
        self.title = ""
        self._in_jsonld = False
        self._in_h1 = False
        self._in_title = False
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("name") or a.get("property") or "").lower()
            if key:
                self.meta[key] = a.get("content", "")
        elif tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._in_jsonld = True
            self._buf = []
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "iframe" and a.get("src"):
            self.links.append(a["src"])
        elif tag == "h1":
            self._in_h1 = True
            self._buf = []
        elif tag == "title":
            self._in_title = True
            self._buf = []
        lat = a.get("data-lat") or a.get("data-latitude")
        lon = a.get("data-lng") or a.get("data-lon") or a.get("data-longitude")
        if lat and lon:
            self.data_coords.append((lat, lon))

    def handle_endtag(self, tag):
        if tag == "script" and self._in_jsonld:
            self.jsonld.append("".join(self._buf))
            self._in_jsonld = False
        elif tag == "h1" and self._in_h1:
            self.h1.append(" ".join("".join(self._buf).split()))
            self._in_h1 = False
        elif tag == "title" and self._in_title:
            self.title = " ".join("".join(self._buf).split())
            self._in_title = False

    def handle_data(self, data):
        if self._in_jsonld or self._in_h1 or self._in_title:
            self._buf.append(data)


def _walk(obj):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def _valid(lat: float, lon: float) -> bool:
    return in_hu_bbox(lat, lon)


def extract(url: str, html: str) -> PageFacts:
    c = _Collector()
    c.feed(html)
    facts = PageFacts(url=url)

    # 1. JSON-LD
    for raw in c.jsonld:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        for node in _walk(data):
            t = node.get("@type")
            if t:
                facts.types.extend(t if isinstance(t, list) else [t])
            geo = node.get("geo")
            if isinstance(geo, dict) and facts.lat is None:
                try:
                    lat, lon = float(geo.get("latitude")), float(geo.get("longitude"))
                except (TypeError, ValueError):
                    lat = lon = None
                if lat is not None and _valid(lat, lon):
                    facts.lat, facts.lon, facts.coord_source = lat, lon, "jsonld"
                    if isinstance(node.get("name"), str):
                        facts.name = facts.name or node["name"].strip()
            addr = node.get("address")
            if isinstance(addr, dict) and addr.get("addressLocality") and not facts.settlement:
                facts.settlement = str(addr["addressLocality"]).strip()

    # 2. meta címkék
    if facts.lat is None:
        pos = c.meta.get("geo.position") or c.meta.get("icbm")
        if pos:
            parts = re.split(r"[;,]\s*", pos.strip())
            if len(parts) == 2:
                try:
                    lat, lon = float(parts[0]), float(parts[1])
                    if _valid(lat, lon):
                        facts.lat, facts.lon, facts.coord_source = lat, lon, "meta"
                except ValueError:
                    pass
    if facts.lat is None:
        la = c.meta.get("place:location:latitude") or c.meta.get("og:latitude")
        lo = c.meta.get("place:location:longitude") or c.meta.get("og:longitude")
        if la and lo:
            try:
                lat, lon = float(la), float(lo)
                if _valid(lat, lon):
                    facts.lat, facts.lon, facts.coord_source = lat, lon, "meta"
            except ValueError:
                pass

    # 3. data-* attribútumok (csak ha egyértelmű: egyetlen különböző pont)
    if facts.lat is None and c.data_coords:
        uniq = {(a, b) for a, b in c.data_coords}
        if len(uniq) == 1:
            a, b = uniq.pop()
            try:
                lat, lon = float(a), float(b)
                if _valid(lat, lon):
                    facts.lat, facts.lon, facts.coord_source = lat, lon, "data-attr"
            except ValueError:
                pass

    # 4. térképlinkek
    if facts.lat is None:
        hits = set()
        for href in c.links:
            for rx in (_MAPS_Q, _MAPS_AT, _OSM):
                m = rx.search(href)
                if m:
                    lat, lon = float(m.group(1)), float(m.group(2))
                    if _valid(lat, lon):
                        hits.add((round(lat, 5), round(lon, 5)))
        if len(hits) == 1:
            facts.lat, facts.lon = hits.pop()
            facts.coord_source = "map-link"

    # 5. GPX
    facts.gpx_links = sorted({urljoin(url, h) for h in c.links if h.lower().split("?")[0].endswith(".gpx")})

    if not facts.name:
        facts.name = (c.h1[0] if c.h1 else None) or c.meta.get("og:title") or c.title or None
    if facts.name:
        facts.name = facts.name.split(" | ")[0].split(" - ")[0].strip() or None
    return facts
