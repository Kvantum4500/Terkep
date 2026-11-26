"""Udvarias HTTP-kliens: saját User-Agent, robots.txt, hostonkénti
sebességkorlát, újrapróbálás, lemezes gyorsítótár, offline mód."""

from __future__ import annotations

import hashlib
import json
import logging
import time
import urllib.robotparser
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import requests

from . import CACHE_DIR, config

log = logging.getLogger(__name__)

DEFAULT_INTERVAL_S = 3.0


class OfflineMiss(RuntimeError):
    """Offline módban nincs a kért válasz a gyorsítótárban."""


class RobotsDisallowed(RuntimeError):
    pass


@dataclass
class Response:
    url: str
    status: int
    text: str
    headers: dict[str, str]

    def json(self):
        return json.loads(self.text)


class PoliteClient:
    def __init__(
        self,
        cache_dir: Path = CACHE_DIR / "http",
        offline: bool = False,
        default_interval_s: float = DEFAULT_INTERVAL_S,
        ttl_days: float = 60.0,
        respect_robots: bool = True,
    ):
        self.cache_dir = cache_dir
        self.offline = offline
        self.default_interval_s = default_interval_s
        self.ttl_s = ttl_days * 86400
        self.respect_robots = respect_robots
        self.user_agent = config.sources()["user_agent"]
        self.session = requests.Session()
        self.session.headers["User-Agent"] = self.user_agent
        self.session.headers["Accept-Language"] = "hu,en;q=0.5"
        self._last: dict[str, float] = {}
        self._intervals: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._api_hosts: set[str] = set()

    def set_interval(self, host: str, seconds: float) -> None:
        self._intervals[host] = seconds

    def mark_api_host(self, host: str) -> None:
        """Hivatalos, gépi használatra szánt API (pl. Wikidata SPARQL, MediaWiki API).

        A robots.txt weboldalak bejárására vonatkozik; ezeknél az API-knál az
        üzemeltető User-Agent-szabálya az irányadó (azt betartjuk), a robots.txt-t
        nem nézzük. A túraoldalak bejárásánál a robots.txt továbbra is kötelező.
        """
        self._api_hosts.add(host)

    # -- gyorsítótár --------------------------------------------------------
    def _cache_path(self, method: str, url: str, body: str | None) -> Path:
        h = hashlib.sha256(f"{method} {url}\n{body or ''}".encode()).hexdigest()
        host = urlsplit(url).netloc or "local"
        return self.cache_dir / host / h[:2] / f"{h}.json"

    def _read_cache(self, path: Path, allow_stale: bool) -> Response | None:
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        if not allow_stale and time.time() - data["fetched"] > self.ttl_s:
            return None
        return Response(data["url"], data["status"], data["text"], data.get("headers", {}))

    def _write_cache(self, path: Path, resp: Response) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "url": resp.url,
            "status": resp.status,
            "text": resp.text,
            "headers": resp.headers,
            "fetched": time.time(),
        }
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    # -- robots.txt ----------------------------------------------------------
    def robots(self, url: str) -> urllib.robotparser.RobotFileParser | None:
        parts = urlsplit(url)
        base = f"{parts.scheme}://{parts.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                resp = self._fetch("GET", base + "/robots.txt", check_robots=False)
                if resp.status >= 400:
                    rp = None  # nincs robots.txt -> minden engedett
                else:
                    rp.parse(resp.text.splitlines())
                    delay = rp.crawl_delay(self.user_agent)
                    if delay:
                        host = parts.netloc
                        self._intervals[host] = max(self._intervals.get(host, 0.0), float(delay))
            except OfflineMiss:
                rp = None
            self._robots[base] = rp
        return self._robots[base]

    def allowed(self, url: str) -> bool:
        rp = self.robots(url)
        return True if rp is None else rp.can_fetch(self.user_agent, url)

    # -- letöltés ------------------------------------------------------------
    def _throttle(self, host: str) -> None:
        interval = self._intervals.get(host, self.default_interval_s)
        wait = self._last.get(host, 0.0) + interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last[host] = time.monotonic()

    def _fetch(
        self,
        method: str,
        url: str,
        data: dict | str | None = None,
        params: dict | None = None,
        headers: dict | None = None,
        check_robots: bool = True,
        timeout: float = 120.0,
        attempts: int = 5,
    ) -> Response:
        """Udvarias kérés gyorsítótárral. Hálózati hibánál és 429/5xx válasznál
        legfeljebb `attempts`-szer próbálkozik (az utolsó után nem vár)."""
        full_url = requests.Request(method, url, params=params).prepare().url or url
        body = json.dumps(data, sort_keys=True) if isinstance(data, dict) else data
        path = self._cache_path(method, full_url, body)
        cached = self._read_cache(path, allow_stale=self.offline)
        if cached is not None:
            return cached
        if self.offline:
            raise OfflineMiss(full_url)
        host = urlsplit(full_url).netloc
        if (
            check_robots
            and self.respect_robots
            and host not in self._api_hosts
            and not self.allowed(full_url)
        ):
            raise RobotsDisallowed(full_url)
        last_exc: Exception | None = None
        for attempt in range(attempts):
            last = attempt == attempts - 1
            self._throttle(host)
            try:
                r = self.session.request(
                    method, url, params=params, data=data, headers=headers, timeout=timeout
                )
            except requests.RequestException as exc:
                last_exc = exc
                if not last:
                    time.sleep(min(60, 2**attempt * 2))
                continue
            if r.status_code in (429, 500, 502, 503, 504):
                last_exc = RuntimeError(f"HTTP {r.status_code}")
                if last:
                    log.warning("%s -> %s (%d. próbálkozás, feladom)", full_url, r.status_code, attempts)
                    continue
                retry_after = r.headers.get("Retry-After", "")
                delay = float(retry_after) if retry_after.isdigit() else min(120, 2**attempt * 5)
                log.warning("%s -> %s, várok %.0f s-ot", full_url, r.status_code, delay)
                time.sleep(delay)
                continue
            resp = Response(full_url, r.status_code, r.text, {k.lower(): v for k, v in r.headers.items()})
            if r.status_code < 400 or r.status_code == 404:
                self._write_cache(path, resp)
            return resp
        raise RuntimeError(f"Sikertelen letöltés: {full_url}: {last_exc}")

    def forget(
        self, method: str, url: str, data: dict | str | None = None, params: dict | None = None
    ) -> None:
        """Egy gyorsítótárazott válasz törlése (pl. ha 200-as státusszal, de hibás tartalommal jött)."""
        full_url = requests.Request(method, url, params=params).prepare().url or url
        body = json.dumps(data, sort_keys=True) if isinstance(data, dict) else data
        self._cache_path(method, full_url, body).unlink(missing_ok=True)

    def get(self, url: str, params: dict | None = None, headers: dict | None = None, **kw) -> Response:
        return self._fetch("GET", url, params=params, headers=headers, **kw)

    def post(self, url: str, data: dict | str, headers: dict | None = None, **kw) -> Response:
        return self._fetch("POST", url, data=data, headers=headers, **kw)

    def download(
        self, url: str, dest: Path, chunk: int = 1 << 20, attempts: int = 5, backoff_s: float = 15.0
    ) -> Path:
        """Nagy fájl letöltése (pl. OSM PBF), gyorsítótár nélkül.

        Átmeneti hálózati hibánál (kapcsolódási hiba, megszakadt átvitel, 5xx)
        újrapróbál, egyre hosszabb várakozással."""
        if self.offline:
            if dest.exists():
                return dest
            raise OfflineMiss(url)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        last_exc: Exception | None = None
        for attempt in range(attempts):
            try:
                with self.session.get(url, stream=True, timeout=600) as r:
                    if r.status_code >= 500:
                        raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
                    r.raise_for_status()
                    with tmp.open("wb") as f:
                        for block in r.iter_content(chunk):
                            f.write(block)
                tmp.replace(dest)
                return dest
            except (
                requests.ConnectionError,
                requests.Timeout,
                requests.exceptions.ChunkedEncodingError,
            ) as exc:
                last_exc = exc
            except requests.HTTPError as exc:
                if exc.response is not None and exc.response.status_code < 500:
                    raise
                last_exc = exc
            if attempt < attempts - 1:
                delay = backoff_s * 2**attempt
                log.warning("Letöltési hiba (%s), újra %.0f s múlva: %s", last_exc, delay, url)
                time.sleep(delay)
        raise RuntimeError(f"Sikertelen letöltés {attempts} próbálkozás után: {url}: {last_exc}")
