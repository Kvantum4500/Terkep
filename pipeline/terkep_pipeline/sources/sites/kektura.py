"""kektura.hu (MTSZ): Országos Kékkör pecsételőhelyek.

Ha az oldalon GPX-letöltés érhető el, a waypointok közül a pecsételőhelyeket
vesszük fel (név + koordináta). Ezek a meglévő pontokhoz „Kéktúra-pecsételőhely”
jelzőt és forráslinket adnak.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

from ...http import RobotsDisallowed
from ...models import FLAG_KEKTURA, SourceRecord
from .base import SiteAdapter
from .extract import extract

log = logging.getLogger(__name__)

_STAMP = re.compile(r"pecs[ée]t|stamp|bh\s*\d|igazol", re.I)


def parse_gpx_waypoints(text: str, ref_prefix: str) -> list[SourceRecord]:
    try:
        root = ET.fromstring(text.encode("utf-8"))
    except ET.ParseError:
        return []
    ns = {"g": root.tag.split("}")[0].strip("{")} if root.tag.startswith("{") else {}
    q = "g:wpt" if ns else "wpt"
    out = []
    for i, wpt in enumerate(root.findall(q, ns)):

        def child(tag: str, _w=wpt) -> str:
            el = _w.find(f"g:{tag}" if ns else tag, ns)
            return (el.text or "").strip() if el is not None else ""

        name, desc, sym = child("name"), child("desc"), child("sym")
        if not name or not (_STAMP.search(name) or _STAMP.search(desc) or _STAMP.search(sym)):
            continue
        clean = re.sub(r"\s*[-–(]?\s*pecs[ée]t\w*\)?\s*", " ", name, flags=re.I).strip() or name
        out.append(
            SourceRecord(
                source="kektura",
                ref=f"{ref_prefix}#{i}",
                name=clean,
                lat=float(wpt.get("lat")),
                lon=float(wpt.get("lon")),
                flags=FLAG_KEKTURA,
                extra={"stamp": name},
            )
        )
    return out


class KekturaAdapter(SiteAdapter):
    key = "kektura"

    def fetch(self, max_pages: int | None = None) -> list[SourceRecord]:
        out: list[SourceRecord] = []
        gpx_links: set[str] = set(self.cfg.get("gpx_urls", []))
        for url in self.candidate_urls()[: max_pages or 500]:
            try:
                resp = self.client.get(url)
            except RobotsDisallowed:
                continue
            gpx_links.update(extract(url, resp.text).gpx_links)
        for link in sorted(gpx_links):
            try:
                resp = self.client.get(link)
            except (RobotsDisallowed, RuntimeError) as exc:
                log.warning("GPX nem tölthető le: %s (%s)", link, exc)
                continue
            out.extend(parse_gpx_waypoints(resp.text, urlsplit(link).path))
        log.info("kektura: %d pecsételőhely", len(out))
        return out
