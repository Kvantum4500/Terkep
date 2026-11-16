"""Wikidata (CC0): osztályfák, felderítés és dúsítás SPARQL-lel.

1. Alosztályfák: minden gyökérosztály (categories.yaml) P279* fája, egyszer
   letöltve és gyorsítótárazva -> osztály -> gyökér leképezés.
2. Felderítés: magyarországi (P17 = Q28), koordinátás elemek a fák
   osztályaiból, `VALUES` blokkokban (path-lekérdezés helyett). Ha egy köteg
   időtúllép (a WDQS 60 mp-es korlátja), kettévágjuk; a magában is hibás
   osztályt kihagyjuk és jelentjük.
3. Dúsítás: QID-kötegek (felderítés + OSM wikidata=* címkék): magyar név és
   leírás, kép, sitelink-szám, magyar Wikipédia-cikk, védettség, magasság.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Iterable
from pathlib import Path
from urllib.parse import unquote

from .. import BUILD_DIR, config
from ..categorize import categorize_wikidata
from ..http import PoliteClient
from ..models import FLAG_HERITAGE, SourceRecord

log = logging.getLogger(__name__)

CLASS_MAP_PATH = BUILD_DIR / "wikidata_classes.json"
SKIPPED_PATH = BUILD_DIR / "wikidata_skipped_classes.json"
BATCH_CLASSES = 60
BATCH_ITEMS = 250
# A felezhető kötegeknél az időtúllépés ugyanarra a lekérdezésre ismétlődik: kevés
# újrapróbálás, utána felezés. A nem felezhető (vagy már kicsi) lekérdezések türelmesebbek.
SPLIT_ATTEMPTS = 2
SPARQL_ATTEMPTS = 5
# Ennyi egyenként is sikertelen osztály után a szolgáltatást elérhetetlennek tekintjük.
MAX_SKIPPED_CLASSES = 10
ENTITY = "http://www.wikidata.org/entity/"


def _sparql(client: PoliteClient, query: str, attempts: int = SPARQL_ATTEMPTS) -> list[dict]:
    url = config.source_cfg("wikidata")["sparql_url"]
    resp = client.post(
        url,
        data={"query": query, "format": "json"},
        headers={"Accept": "application/sparql-results+json"},
        timeout=300,
        attempts=attempts,
    )
    if resp.status >= 400:
        raise RuntimeError(f"SPARQL hiba {resp.status}: {resp.text[:300]}")
    return resp.json()["results"]["bindings"]


def _qid(uri: str) -> str:
    return uri.removeprefix(ENTITY)


def _chunks(items: list, n: int) -> Iterable[list]:
    for i in range(0, len(items), n):
        yield items[i : i + n]


def _roots_fingerprint() -> str:
    """A gyökérosztály-lista és a kizárások ujjlenyomata: ha a categories.yaml
    változik, a gyorsítótárazott osztálytérkép érvénytelen."""
    cats = config.categories()
    key = {
        "roots": [r["qid"] for r in cats["wikidata_classes"]],
        "exclude": sorted(cats.get("wikidata_exclude") or []),
    }
    return hashlib.sha256(json.dumps(key, sort_keys=True).encode()).hexdigest()[:16]


def class_map(client: PoliteClient, refresh: bool = False, path: Path | None = None) -> dict[str, str]:
    """osztály QID -> gyökér QID (a categories.yaml sorrendjében az első nyer).

    A térkép gyorsítótárazva van (a CI-ben is); ha a gyökérlista azóta
    megváltozott (vagy régi formátumú a fájl), újratöltjük."""
    path = path or CLASS_MAP_PATH
    fingerprint = _roots_fingerprint()
    if path.exists() and not refresh:
        cached = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(cached, dict) and cached.get("fingerprint") == fingerprint:
            return cached["map"]
        log.info("A Wikidata-osztálytérkép elavult (a gyökérlista változott), újratöltöm.")
    roots = config.categories()["wikidata_classes"]
    exclude = set(config.categories().get("wikidata_exclude") or [])
    mapping: dict[str, str] = {}
    for root in roots:
        rows = _sparql(client, f"SELECT ?s WHERE {{ ?s wdt:P279* wd:{root['qid']} . }}")
        subs = {_qid(r["s"]["value"]) for r in rows}
        log.info("Wikidata osztályfa %s (%s): %d alosztály", root["qid"], root["label"], len(subs))
        for s in subs:
            if s not in exclude:
                mapping.setdefault(s, root["qid"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"fingerprint": fingerprint, "map": mapping}, indent=0, sort_keys=True), encoding="utf-8"
    )
    return mapping


def discover_query(classes: list[str]) -> str:
    values = " ".join(f"wd:{c}" for c in classes)
    return f"""
        SELECT DISTINCT ?item WHERE {{
          VALUES ?class {{ {values} }}
          ?item wdt:P31 ?class ; wdt:P17 wd:Q28 ; wdt:P625 ?coord .
          FILTER NOT EXISTS {{ ?item wdt:P576 ?end . }}
        }}"""


def discover(client: PoliteClient, classes: Iterable[str]) -> tuple[set[str], list[str]]:
    """Magyarországi, koordinátás, meg nem szűnt elemek a megadott osztályokból.

    Visszaadja a talált QID-ket és a kihagyott (egyenként is időtúllépő)
    osztályokat. Ha túl sok osztály hibás, a szolgáltatás valószínűleg nem
    elérhető: ekkor hibát dob, hogy ne fusson órákig."""
    found: set[str] = set()
    skipped: list[str] = []
    for chunk in _chunks(sorted(classes), BATCH_CLASSES):
        found |= _discover_split(client, chunk, skipped)
    if skipped:
        log.warning("Wikidata felderítés: %d osztály kimaradt időtúllépés miatt: %s", len(skipped), skipped)
    log.info("Wikidata felderítés: %d elem", len(found))
    return found, skipped


def _discover_split(client: PoliteClient, classes: list[str], skipped: list[str]) -> set[str]:
    try:
        rows = _sparql(client, discover_query(classes), attempts=SPLIT_ATTEMPTS)
    except RuntimeError as exc:
        if len(classes) > 1:
            mid = len(classes) // 2
            log.info("Wikidata felderítés: %d osztályos köteg sikertelen, kettévágom", len(classes))
            return _discover_split(client, classes[:mid], skipped) | _discover_split(
                client, classes[mid:], skipped
            )
        skipped.append(classes[0])
        if len(skipped) > MAX_SKIPPED_CLASSES:
            raise RuntimeError(
                f"A Wikidata-lekérdezőszolgáltatás elérhetetlennek tűnik: {len(skipped)} osztály "
                f"egyenként is sikertelen (utolsó hiba: {exc})"
            ) from exc
        log.warning("Wikidata felderítés: a(z) %s osztály kihagyva (%s)", classes[0], exc)
        return set()
    return {_qid(r["item"]["value"]) for r in rows}


def _parse_point(wkt: str) -> tuple[float, float] | None:
    # "Point(19.04 47.49)"
    if not wkt.startswith("Point("):
        return None
    lon, lat = wkt[6:-1].split()
    return float(lat), float(lon)


def _commons_file(url: str) -> str:
    # http://commons.wikimedia.org/wiki/Special:FilePath/Foo%20bar.jpg
    return unquote(url.rsplit("/", 1)[-1]).replace("_", " ")


def enrich_query(qids: list[str]) -> str:
    values = " ".join(f"wd:{q}" for q in qids)
    return f"""
    SELECT ?item (SAMPLE(?coord) AS ?c) (SAMPLE(?label) AS ?l) (SAMPLE(?desc) AS ?d) (SAMPLE(?img) AS ?i)
           (SAMPLE(?sl) AS ?s) (SAMPLE(?article) AS ?a) (SAMPLE(?herit) AS ?h) (SAMPLE(?ele) AS ?e)
           (SAMPLE(?admLabel) AS ?adm)
           (GROUP_CONCAT(DISTINCT STRAFTER(STR(?p31), "{ENTITY}"); separator="|") AS ?classes)
    WHERE {{
      VALUES ?item {{ {values} }}
      OPTIONAL {{ ?item wdt:P625 ?coord . }}
      OPTIONAL {{ ?item rdfs:label ?label . FILTER(LANG(?label) = "hu") }}
      OPTIONAL {{ ?item schema:description ?desc . FILTER(LANG(?desc) = "hu") }}
      OPTIONAL {{ ?item wdt:P18 ?img . }}
      OPTIONAL {{ ?item wikibase:sitelinks ?sl . }}
      OPTIONAL {{ ?article schema:about ?item ; schema:isPartOf <https://hu.wikipedia.org/> . }}
      OPTIONAL {{ ?item wdt:P1435 ?herit . }}
      OPTIONAL {{ ?item wdt:P2044 ?ele . }}
      OPTIONAL {{ ?item wdt:P131 ?admin . ?admin rdfs:label ?admLabel . FILTER(LANG(?admLabel) = "hu") }}
      OPTIONAL {{ ?item wdt:P31 ?p31 . }}
    }} GROUP BY ?item"""


def rows_to_records(rows: list[dict], class_to_root: dict[str, str]) -> list[SourceRecord]:
    out = []
    for r in rows:
        qid = _qid(r["item"]["value"])
        name = r.get("l", {}).get("value")
        if not name:
            continue
        coords = _parse_point(r["c"]["value"]) if "c" in r else None
        classes = [c for c in r.get("classes", {}).get("value", "").split("|") if c]
        cat = categorize_wikidata(classes, class_to_root, name)
        article = r.get("a", {}).get("value")
        huwiki = unquote(article.rsplit("/wiki/", 1)[-1]).replace("_", " ") if article else None
        ele = None
        if "e" in r:
            try:
                ele = float(r["e"]["value"])
            except ValueError:
                ele = None
        heritage = "h" in r
        out.append(
            SourceRecord(
                source="wikidata",
                ref=qid,
                name=name,
                lat=coords[0] if coords else None,
                lon=coords[1] if coords else None,
                cat=cat,
                settlement=r.get("adm", {}).get("value"),
                wikidata=qid,
                huwiki=huwiki,
                desc=r.get("d", {}).get("value"),
                ele=ele,
                image=_commons_file(r["i"]["value"]) if "i" in r else None,
                sitelinks=int(r["s"]["value"]) if "s" in r else 0,
                flags=FLAG_HERITAGE if heritage else 0,
                coord_quality="exact" if coords else "none",
                extra={"heritage": True} if heritage else {},
            )
        )
    return out


def enrich(client: PoliteClient, qids: Iterable[str], class_to_root: dict[str, str]) -> list[SourceRecord]:
    qlist = sorted(set(qids), key=lambda q: int(q[1:]))
    out: list[SourceRecord] = []
    for i, chunk in enumerate(_chunks(qlist, BATCH_ITEMS)):
        rows = _fetch_split(client, chunk)
        out.extend(rows_to_records(rows, class_to_root))
        if i % 20 == 0:
            log.info("Wikidata dúsítás: %d / %d", min((i + 1) * BATCH_ITEMS, len(qlist)), len(qlist))
    return out


def _fetch_split(client: PoliteClient, qids: list[str]) -> list[dict]:
    """Időtúllépésnél a köteget kettévágjuk; a legkisebb köteg már türelmesebb."""
    small = len(qids) <= 10
    try:
        return _sparql(client, enrich_query(qids), attempts=SPARQL_ATTEMPTS if small else SPLIT_ATTEMPTS)
    except RuntimeError:
        if small:
            raise
        mid = len(qids) // 2
        return _fetch_split(client, qids[:mid]) + _fetch_split(client, qids[mid:])


def fetch(client: PoliteClient, osm_qids: Iterable[str], refresh_classes: bool = False) -> list[SourceRecord]:
    classes = class_map(client, refresh=refresh_classes)
    found, skipped = discover(client, classes.keys())
    SKIPPED_PATH.parent.mkdir(parents=True, exist_ok=True)
    SKIPPED_PATH.write_text(json.dumps(skipped), encoding="utf-8")
    records = enrich(client, set(found) | set(osm_qids), classes)
    # A felderítésből jövő, de besorolhatatlan elemeket elhagyjuk; az OSM-címkéből
    # jövőket megtartjuk (azonosító szerint kapcsolódnak, a kategóriát az OSM adja).
    keep = [r for r in records if r.cat is not None or r.ref in set(osm_qids)]
    log.info("Wikidata: %d rekord", len(keep))
    return keep


def verify_config(client: PoliteClient) -> list[str]:
    """A categories.yaml QID-jeinek angol címkéje egyezik-e a várt címkével."""
    roots = config.categories()["wikidata_classes"]
    values = " ".join(f"wd:{r['qid']}" for r in roots)
    rows = _sparql(
        client,
        f'SELECT ?q ?l WHERE {{ VALUES ?q {{ {values} }} ?q rdfs:label ?l . FILTER(LANG(?l) = "en") }}',
    )
    got = {_qid(r["q"]["value"]): r["l"]["value"].lower() for r in rows}
    problems = []
    for r in roots:
        label = got.get(r["qid"])
        if label != r["label"].lower():
            problems.append(f"{r['qid']}: várt '{r['label']}', kapott '{label}'")
    return problems
