"""Parancssori felület.

Példák:
  terkep build --sample            # mintaadat -> data/sample/ (hálózat nélkül)
  terkep boundaries                # tartalék vármegyehatárok (geoBoundaries + NE)
  terkep fetch osm                 # Geofabrik PBF -> rekordok + OSM-határok
  terkep fetch wikidata            # osztályfák, felderítés, dúsítás
  terkep fetch huwiki | commons
  terkep discover all              # túraoldalak felderítése (riport)
  terkep fetch site all            # engedélyezett túraoldalak
  terkep build                     # valós adat -> data/
  terkep fetch streetview          # Google-utcakép helye (GOOGLE_MAPS_SERVER_KEY)
  terkep golden                    # aranylista-ellenőrzés
  terkep pano-audit                # 360°-os képek lefedettsége (riport)
  terkep verify-config             # Wikidata QID-k ellenőrzése
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

from . import BUILD_DIR, CACHE_DIR, DATA_DIR, boundaries, build, config, records
from .export import load_ndjson
from .http import PoliteClient
from .normalize import fold

log = logging.getLogger("terkep")


def _client(args) -> PoliteClient:
    c = PoliteClient(offline=args.offline)
    for key in ("wikidata", "huwiki", "commons"):
        cfg = config.source_cfg(key)
        url = cfg.get("sparql_url") or cfg.get("api_url")
        if url:
            from urllib.parse import urlsplit

            host = urlsplit(url).netloc
            c.set_interval(host, float(cfg.get("min_interval_s", 1.0)))
            c.mark_api_host(host)
    return c


def cmd_boundaries(args) -> int:
    from .sources import natural_earth as fb

    client = _client(args)
    gb = (
        Path(args.geoboundaries)
        if args.geoboundaries
        else CACHE_DIR / "fallback" / "geoboundaries_hun_adm1.geojson"
    )
    ne = Path(args.natural_earth) if args.natural_earth else CACHE_DIR / "fallback" / "ne_admin1.geojson"
    if not gb.exists():
        client.download(fb.GB_URL, gb)
    if not ne.exists():
        client.download(fb.NE_URL, ne)
    polys = fb.polygons(gb, ne)
    problems = boundaries.check(polys)
    if problems:
        log.error("Hibás határok: %s", problems)
        return 1
    boundaries.write(polys, BUILD_DIR / "megyek_full.geojson", DATA_DIR / "megyek.geojson", fb.SOURCE_LABEL)
    log.info("Vármegyehatárok kiírva: %s", DATA_DIR / "megyek.geojson")
    return 0


def fetch_pbf(client: PoliteClient, urls: list[str], dest: Path) -> Path:
    """A Magyarország-kivonat letöltése: a tükrök sorrendben; ha egyik sem érhető
    el, a korábban letöltött (pl. a CI-gyorsítótárból visszaállított) fájllal megy
    tovább, figyelmeztetéssel. Ha az sincs, hibát dob."""
    errors = []
    for url in urls:
        log.info("PBF letöltése: %s", url)
        try:
            return client.download(url, dest, attempts=3)
        except Exception as exc:  # noqa: BLE001 - a következő tükörrel próbálkozunk
            errors.append(f"{url}: {exc}")
            log.warning("PBF-tükör nem elérhető: %s", url)
    if dest.exists():
        age_days = (time.time() - dest.stat().st_mtime) / 86400
        log.warning("Egyik tükör sem elérhető; a meglévő, %.1f napos PBF-fel folytatom.", age_days)
        return dest
    raise RuntimeError("A PBF nem tölthető le, és nincs korábbi példány: " + " | ".join(errors))


def cmd_fetch(args) -> int:
    client = _client(args)
    what = args.what
    if what == "osm":
        from .sources import osm_pbf

        pbf = Path(args.pbf) if args.pbf else CACHE_DIR / "osm" / "hungary-latest.osm.pbf"
        if not args.pbf and (not pbf.exists() or time.time() - pbf.stat().st_mtime > 7 * 86400):
            fetch_pbf(client, config.source_cfg("osm")["pbf_urls"], pbf)
        recs, counties, settlements = osm_pbf.extract(pbf)
        records.save("osm", recs)
        osm_pbf.write_boundaries(counties, settlements)
    elif what == "wikidata":
        from .sources import wikidata

        osm_qids = {r.wikidata for r in records.load("osm") if r.wikidata}
        records.save("wikidata", wikidata.fetch(client, osm_qids, refresh_classes=args.refresh))
    elif what == "huwiki":
        from .sources import huwiki

        records.save("huwiki", huwiki.fetch(client))
    elif what == "commons":
        from .sources import commons

        files = {r.image for src in ("osm", "wikidata") for r in records.load(src) if r.image}
        old = commons.load_meta()
        meta = {**old, **commons.fetch_meta(client, files - set(old))}
        commons.save_meta(meta)
    elif what == "streetview":
        import os

        from .sources import streetview

        key = os.environ.get(streetview.KEY_ENV, "").strip()
        if not key:
            log.warning("Nincs %s – az utcakép-lépés kimarad.", streetview.KEY_ENV)
            return 0
        rows = load_ndjson(DATA_DIR / "pois.ndjson")
        streetview.save(streetview.fetch(rows, key=key, max_tier=args.max_tier))
    elif what == "site":
        from .sources.sites import SITE_KEYS, adapter_for

        keys = SITE_KEYS if args.site == "all" else [args.site]
        for key in keys:
            cfg = config.source_cfg(key)
            if not cfg.get("enabled") or not cfg.get("poi_url_patterns") and key != "kektura":
                log.info("%s: kihagyva (nincs engedélyezve vagy nincs URL-minta)", key)
                continue
            records.save(key, adapter_for(key, client, cfg).fetch(args.max_pages))
    return 0


def cmd_discover(args) -> int:
    from .sources.sites import SITE_KEYS, adapter_for

    client = _client(args)
    keys = SITE_KEYS if args.site == "all" else [args.site]
    summary = {}
    for key in keys:
        try:
            rep = adapter_for(key, client, config.source_cfg(key)).discover(sample_pages=args.samples)
        except Exception as exc:  # noqa: BLE001 - egy oldal hibája ne állítsa meg a többit
            log.exception("%s felderítése sikertelen", key)
            rep = {"site": key, "error": str(exc)}
        summary[key] = {
            k: rep.get(k)
            for k in (
                "robots_status",
                "crawl_delay",
                "homepage_allowed",
                "sitemap_url_count",
                "allowed_ratio",
                "error",
            )
        }
        summary[key]["coords_found"] = sum(1 for p in rep.get("sample_pages", []) if p.get("lat") is not None)
    out = BUILD_DIR / "discovery" / "summary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


def cmd_build(args) -> int:
    if args.sample:
        from .sources import sample

        result = build.run(
            {"sample": sample.load()},
            sample=True,
            out_dir=DATA_DIR / "sample",
            reports_dir=BUILD_DIR / "reports-sample",
        )
        if result.county_mismatch:
            for m in result.county_mismatch:
                log.warning("Eltérő vármegye: %s", m)
    else:
        from .sources import commons

        recs = build.load_all_records()
        if not recs:
            log.error("Nincsenek forrásrekordok – előbb futtasd a `terkep fetch …` lépéseket.")
            return 1
        meta = commons.load_meta()
        for rlist in recs.values():
            commons.attach(rlist, meta)
        result = build.run(recs, sample=False, out_dir=DATA_DIR, reports_dir=BUILD_DIR / "reports")
    log.info("Kész: %d látnivaló, %d elvetett", len(result.pois), len(result.dropped))
    return 0


def check_golden(data_dir: Path) -> list[str]:
    """Aranylista: minden tételhez legyen legalább egy pont a megadott vármegyében,
    a megadott kategóriák egyikében, amelynek (név + település) szövegében minden
    `match` szórész szerepel, és a szintje legfeljebb `max_tier` (alapból 1)."""
    rows = load_ndjson(data_dir / "pois.ndjson")
    failures = []
    for g in config.golden():
        cats = g["cat"] if isinstance(g["cat"], list) else [g["cat"]]
        hits = [
            r
            for r in rows
            if r["county"] == g["county"]
            and r["cat"] in cats
            and all(m in fold(f"{r['name']} {r.get('settlement', '')}") for m in g["match"])
        ]
        if not hits:
            failures.append(f"hiányzik: {g}" + _explain_missing(g))
        elif not any(r["tier"] <= g.get("max_tier", 1) for r in hits):
            failures.append(f"nem kiemelt: {g} -> {[(r['name'], r['cat'], r['tier']) for r in hits][:5]}")
    return failures


def _explain_missing(g: dict) -> str:
    """Diagnosztika a riportba: a hiányzó aranylista-tétel nevére illeszkedő nyers
    forrásrekordok (ha a pipeline/build/records elérhető, pl. az adatfrissítésben)."""
    found = []
    for src in records.available():
        for r in records.load(src):
            if all(m in fold(f"{r.name} {r.settlement or ''}") for m in g["match"]):
                found.append(f"{r.key} kat={r.cat} qid={r.wikidata or '-'} ({r.lat}, {r.lon})")
    if not found:
        return " | egyik forrásban sincs ilyen nevű rekord (besorolás vagy szűrés hiányzik?)"
    return " | nyers rekordok: " + "; ".join(found[:8])


def cmd_golden(args) -> int:
    failures = check_golden(Path(args.data))
    for f in failures:
        print("HIBA:", f)
    print(f"Aranylista: {len(config.golden()) - len(failures)}/{len(config.golden())} rendben")
    return 1 if failures else 0


def cmd_pano_audit(args) -> int:
    from .pano_audit import audit

    report = audit(_client(args), load_ndjson(Path(args.data) / "pois.ndjson"), max_tier=args.max_tier)
    out = BUILD_DIR / "reports" / "pano_audit.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report, encoding="utf-8")
    print(report)
    return 0


def cmd_verify_config(args) -> int:
    from .sources import wikidata

    problems = wikidata.verify_config(_client(args))
    for p in problems:
        print("HIBA:", p)
    print("Rendben." if not problems else f"{len(problems)} hiba")
    return 1 if problems else 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="terkep", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--offline", action="store_true", help="csak gyorsítótárból dolgozik, nem tölt le")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("boundaries", help="tartalék vármegyehatárok (geoBoundaries + Natural Earth)")
    b.add_argument("--geoboundaries", help="helyi geoBoundaries HUN ADM1 GeoJSON")
    b.add_argument("--natural-earth", help="helyi ne_10m_admin_1 GeoJSON (Budapesthez)")
    b.set_defaults(func=cmd_boundaries)

    f = sub.add_parser("fetch", help="forrás letöltése")
    f.add_argument("what", choices=["osm", "wikidata", "huwiki", "commons", "streetview", "site"])
    f.add_argument("site", nargs="?", default="all")
    f.add_argument("--pbf", help="helyi PBF-fájl (letöltés helyett)")
    f.add_argument("--refresh", action="store_true", help="Wikidata osztályfák újratöltése")
    f.add_argument("--max-pages", type=int, default=None)
    f.add_argument("--max-tier", type=int, default=2, help="utcakép: legfeljebb ilyen szintű helyekhez")
    f.set_defaults(func=cmd_fetch)

    d = sub.add_parser("discover", help="túraoldalak felderítése")
    d.add_argument("site", nargs="?", default="all")
    d.add_argument("--samples", type=int, default=5)
    d.set_defaults(func=cmd_discover)

    bl = sub.add_parser("build", help="összevonás, pontozás, export")
    bl.add_argument("--sample", action="store_true", help="kézi mintaadatból (data/sample/)")
    bl.set_defaults(func=cmd_build)

    g = sub.add_parser("golden", help="aranylista-ellenőrzés")
    g.add_argument("--data", default=str(DATA_DIR))
    g.set_defaults(func=cmd_golden)

    pa = sub.add_parser("pano-audit", help="360°-os képek: hány kiemelt helynél van (riport)")
    pa.add_argument("--data", default=str(DATA_DIR))
    pa.add_argument("--max-tier", type=int, default=1)
    pa.set_defaults(func=cmd_pano_audit)

    v = sub.add_parser("verify-config", help="Wikidata QID-k ellenőrzése")
    v.set_defaults(func=cmd_verify_config)

    args = p.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(name)s: %(message)s"
    )
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
