"""Harmadik féltől származó túra- és látnivaló-oldalak közös kerete.

Minden oldal `discover` lépéssel indul, ami egy JSON-riportot ír
(pipeline/build/discovery/<oldal>.json): robots.txt, Crawl-delay, sitemapek,
URL-minták, ÁSZF-hivatkozások, mintaoldalakon talált tények. Ez alapján döntünk
(sources.yaml: enabled, poi_url_patterns), és csak utána fut a `fetch`.

Csak tényeket veszünk át (név, hely, kategória-tipp, település) + forráslinket.
"""

from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import asdict
from urllib.parse import urljoin, urlsplit

from ... import BUILD_DIR
from ...http import OfflineMiss, PoliteClient, RobotsDisallowed
from ...models import FLAG_BY_NAME, SourceRecord
from .extract import PageFacts, extract

log = logging.getLogger(__name__)

DISCOVERY_DIR = BUILD_DIR / "discovery"
_TOS_LINK = re.compile(
    r"aszf|felhasznalasi|felhasználási|feltetel|feltétel|jogi|impresszum|terms|adatvedelem", re.I
)
_TOS_CLAUSE = re.compile(
    r"[^.]{0,200}(automati|robot|adatgyűjt|adatbázis|másol|letölt|tartalm|szerzői jog|crawl|scrap)[^.]{0,200}\.",
    re.I,
)
_SM_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


class SiteAdapter:
    key: str = ""

    def __init__(self, client: PoliteClient, cfg: dict):
        self.client = client
        self.cfg = cfg
        self.base = cfg["base_url"].rstrip("/")
        self.patterns = [re.compile(p) for p in cfg.get("poi_url_patterns", [])]
        self.cat_hints = [(re.compile(k, re.I), v) for k, v in (cfg.get("category_hints") or {}).items()]

    # -- sitemap ---------------------------------------------------------------
    def sitemap_roots(self) -> list[str]:
        roots = []
        rp = self.client.robots(self.base + "/")
        if rp is not None:
            roots.extend(rp.site_maps() or [])
        roots.append(self.base + "/sitemap.xml")
        return list(dict.fromkeys(roots))

    def sitemap_urls(self, limit_sitemaps: int = 200) -> list[tuple[str, str | None]]:
        """(url, lastmod) párok az összes sitemapből (index-sitemapeket követve)."""
        todo = self.sitemap_roots()
        seen: set[str] = set()
        out: list[tuple[str, str | None]] = []
        while todo and len(seen) < limit_sitemaps:
            sm = todo.pop(0)
            if sm in seen:
                continue
            seen.add(sm)
            if sm.endswith(".gz"):
                log.info("%s: tömörített sitemap kihagyva: %s", self.key, sm)
                continue
            try:
                resp = self.client.get(sm)
            except (RobotsDisallowed, OfflineMiss, RuntimeError) as exc:
                log.info("%s: sitemap nem érhető el (%s): %s", self.key, sm, exc)
                continue
            if resp.status >= 400:
                continue
            try:
                root = ET.fromstring(resp.text.encode("utf-8"))
            except ET.ParseError:
                continue
            if root.tag.endswith("sitemapindex"):
                todo.extend(loc.text.strip() for loc in root.iter(f"{_SM_NS}loc") if loc.text)
            else:
                for url in root.iter(f"{_SM_NS}url"):
                    loc = url.find(f"{_SM_NS}loc")
                    mod = url.find(f"{_SM_NS}lastmod")
                    if loc is not None and loc.text:
                        out.append(
                            (loc.text.strip(), mod.text.strip() if mod is not None and mod.text else None)
                        )
        return out

    def candidate_urls(self) -> list[str]:
        if not self.patterns:
            return []
        urls = [u for u, _ in self.sitemap_urls() if any(p.search(u) for p in self.patterns)]
        return sorted(set(urls))

    # -- felderítés --------------------------------------------------------------
    def discover(self, sample_pages: int = 5) -> dict:
        report: dict = {"site": self.key, "base_url": self.base}
        try:
            robots = self.client.get(self.base + "/robots.txt", check_robots=False)
            report["robots_status"] = robots.status
            report["robots_txt"] = robots.text[:4000] if robots.status < 400 else None
        except Exception as exc:  # noqa: BLE001 - a riportba kerül
            report["robots_error"] = str(exc)
            return report
        rp = self.client.robots(self.base + "/")
        report["crawl_delay"] = rp.crawl_delay(self.client.user_agent) if rp else None
        report["homepage_allowed"] = self.client.allowed(self.base + "/")
        try:
            home = self.client.get(self.base + "/")
            report["homepage_status"] = home.status
            facts = extract(self.base + "/", home.text)
            report["homepage_title"] = facts.name
            tos = sorted(
                {
                    urljoin(self.base + "/", h)
                    for h in re.findall(r'href="([^"]+)"', home.text)
                    if _TOS_LINK.search(h)
                }
            )
            report["tos_links"] = tos[:15]
            clauses = []
            for link in tos[:3]:
                if urlsplit(link).netloc != urlsplit(self.base).netloc:
                    continue
                try:
                    page = self.client.get(link)
                except Exception:  # noqa: BLE001
                    continue
                text = re.sub(r"<[^>]+>", " ", page.text)
                clauses += [m.group(0).strip() for m in _TOS_CLAUSE.finditer(text)][:8]
            report["tos_clauses"] = clauses
        except (RobotsDisallowed, RuntimeError) as exc:
            report["homepage_error"] = str(exc)
        urls = self.sitemap_urls()
        report["sitemap_url_count"] = len(urls)
        report["sitemap_lastmod_count"] = sum(1 for _, m in urls if m)
        prefixes = Counter("/".join(urlsplit(u).path.split("/")[:2]) for u, _ in urls)
        report["path_prefixes"] = prefixes.most_common(25)
        report["allowed_ratio"] = (
            round(sum(1 for u, _ in urls[:200] if self.client.allowed(u)) / min(200, len(urls)), 2)
            if urls
            else None
        )
        pages = (
            self.candidate_urls()[:sample_pages]
            or [u for u, _ in urls[:: max(1, len(urls) // sample_pages or 1)]][:sample_pages]
        )
        samples = []
        for u in pages:
            try:
                resp = self.client.get(u)
                samples.append(asdict(extract(u, resp.text)))
            except Exception as exc:  # noqa: BLE001
                samples.append({"url": u, "error": str(exc)})
        report["sample_pages"] = samples
        DISCOVERY_DIR.mkdir(parents=True, exist_ok=True)
        (DISCOVERY_DIR / f"{self.key}.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        return report

    # -- letöltés ----------------------------------------------------------------
    def category_hint(self, url: str, facts: PageFacts) -> str | None:
        for rx, cat in self.cat_hints:
            if rx.search(url) or (facts.name and rx.search(facts.name)):
                return cat
        return None

    def to_record(self, url: str, facts: PageFacts) -> SourceRecord | None:
        if not facts.name:
            return None
        flags = FLAG_BY_NAME.get(self.cfg.get("flag", ""), 0)
        extra: dict = {}
        if self.cfg.get("flag") == "showcave":
            extra["showcave"] = True
        return SourceRecord(
            source=self.key,
            ref=urlsplit(url).path,
            name=facts.name,
            lat=facts.lat,
            lon=facts.lon,
            cat=self.category_hint(url, facts),
            settlement=facts.settlement,
            flags=flags,
            coord_quality="exact" if facts.lat is not None else "none",
            extra=extra,
        )

    def fetch(self, max_pages: int | None = None) -> list[SourceRecord]:
        limit = max_pages or int(self.cfg.get("max_pages_per_run", 1000))
        out = []
        for url in self.candidate_urls()[:limit]:
            try:
                resp = self.client.get(url)
            except RobotsDisallowed:
                continue
            except RuntimeError as exc:
                log.warning("%s: %s", url, exc)
                continue
            if resp.status >= 400:
                continue
            rec = self.to_record(url, extract(url, resp.text))
            if rec:
                out.append(rec)
        log.info("%s: %d rekord", self.key, len(out))
        return out
