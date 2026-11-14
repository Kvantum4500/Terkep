"""Magyar Wikipédia-listák: a listákon hivatkozott szócikkek -> Wikidata QID.

Csak a címet és a QID-t tároljuk (megerősítő forrás). Az API-t használjuk,
HTML-táblázatot nem dolgozunk fel.
"""

from __future__ import annotations

import logging
import re

from .. import config
from ..http import PoliteClient
from ..models import SourceRecord

log = logging.getLogger(__name__)

_PAREN = re.compile(r"\s*\([^)]*\)\s*$")


def _api(client: PoliteClient, params: dict) -> dict:
    url = config.source_cfg("huwiki")["api_url"]
    resp = client.get(url, params={"format": "json", "formatversion": "2", **params})
    if resp.status >= 400:
        raise RuntimeError(f"Wikipédia API hiba {resp.status}")
    return resp.json()


def list_links(client: PoliteClient, title: str) -> list[str] | None:
    """A lista szócikk-hivatkozásai (fő névtér). None, ha a lap nem létezik."""
    links: list[str] = []
    params = {
        "action": "query",
        "prop": "links",
        "titles": title,
        "plnamespace": "0",
        "pllimit": "max",
        "redirects": "1",
    }
    while True:
        data = _api(client, params)
        pages = data.get("query", {}).get("pages", [])
        if not pages or pages[0].get("missing"):
            return None
        for p in pages:
            links.extend(link["title"] for link in p.get("links", []))
        cont = data.get("continue")
        if not cont:
            break
        params = {**params, **cont}
    return links


def titles_to_qids(client: PoliteClient, titles: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i : i + 50]
        data = _api(
            client,
            {
                "action": "query",
                "prop": "pageprops",
                "ppprop": "wikibase_item",
                "titles": "|".join(chunk),
                "redirects": "1",
            },
        )
        q = data.get("query", {})
        redirect = {r["to"]: r["from"] for r in q.get("redirects", [])}
        normalized = {n["to"]: n["from"] for n in q.get("normalized", [])}
        for p in q.get("pages", []):
            qid = p.get("pageprops", {}).get("wikibase_item")
            if not qid:
                continue
            title = p["title"]
            original = redirect.get(title, title)
            original = normalized.get(original, original)
            out[original] = qid
            out[title] = qid
    return out


def fetch(client: PoliteClient) -> list[SourceRecord]:
    out: dict[str, SourceRecord] = {}
    for entry in config.huwiki_lists()["lists"]:
        links = list_links(client, entry["title"])
        if links is None:
            log.warning("Nincs ilyen Wikipédia-lap: %s", entry["title"])
            continue
        qids = titles_to_qids(client, links)
        log.info("%s: %d hivatkozás, %d QID", entry["title"], len(links), len(set(qids.values())))
        for title in links:
            qid = qids.get(title)
            if not qid or qid in out:
                continue
            out[qid] = SourceRecord(
                source="huwiki",
                ref=title,
                name=_PAREN.sub("", title),
                cat=entry.get("cat"),
                wikidata=qid,
                huwiki=title,
                coord_quality="none",
                extra={"list": entry["title"]},
            )
    return list(out.values())
