"""Összevonás: ugyanannak a látnivalónak a különböző forrásokból származó
rekordjait egy csoportba (klaszterbe) rendezi, majd POI-t épít belőle.

Lépések:
  1. forráson belüli duplikátumok (azonos név, <= 50 m, azonos kategória)
  2. azonosító szerinti illesztés (Wikidata QID)
  3. térbeli + névhasonlóság szerinti mohó párosítás, forrásonként legfeljebb
     egy rekord egy klaszterben, csak kompatibilis kategóriák között
  4. a „confirm” módú források nem hozhatnak létre új klasztert
"""

from __future__ import annotations

import csv
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

from . import config
from .geo import GridIndex, distance_m
from .models import (
    FLAG_APPROX,
    FLAG_HERITAGE,
    FLAG_IMAGE,
    FLAG_PANO,
    FLAG_RUIN,
    FLAG_SAMPLE,
    FLAG_SHOWCAVE,
    Poi,
    SourceRecord,
)
from .normalize import fold, is_generic, name_similarity

# Kategóriánkénti keresési sugarak méterben: (erős név >= 0.85, gyenge név >= 0.6,
# mindkét név generikus vagy None = generikus névvel nem párosítunk).
RADII: dict[str, tuple[float, float, float | None]] = {
    "templom": (150, 80, 40),
    "kastely": (300, 150, 60),
    "var": (600, 300, 100),
    "rom": (400, 200, 80),
    "hid": (200, 100, 40),
    "kilato": (200, 100, 40),
    "kilatopont": (200, 100, None),
    "egyeb": (200, 100, 40),
    "csucs": (800, 300, None),
    "barlang": (200, 80, None),
    "forras": (200, 80, None),
    "szikla": (300, 150, None),
    "vizeses": (300, 150, None),
    "kert": (500, 250, None),
    "to": (1500, 500, None),
    "volgy": (2000, 800, None),
}
DEFAULT_RADII = (300.0, 150.0, None)
DEDUPE_M = 50.0
# Azonos QID-ű rekordok ezen a távolságon belül egy pontot jelentenek (hosszú híd, tó, völgy).
SAME_QID_MAX_M = 5000.0
# Ha egy OSM-objektum besorolhatatlan Wikidata-elemre mutat, és az messze van vagy
# más a neve, az a tárgya (szobor alakja, kiállított harckocsi típusa, a falu), nem a hely.
SUBJECT_MAX_M = 2000.0
SUBJECT_MIN_SIM = 0.5
STRONG = 0.85
WEAK = 0.6
AMBIGUOUS = 0.5
APPROX_NAME = 0.9

# Forrásprioritás az adatmezők kiválasztásához (kisebb = erősebb).
PRIORITY = {"osm": 0, "wikidata": 1, "sample": 2}


def _prio(source: str) -> int:
    return PRIORITY.get(source, 10)


@cache
def _compat() -> tuple[set[frozenset[str]], set[frozenset[str]]]:
    plain: set[frozenset[str]] = set()
    strong: set[frozenset[str]] = set()
    for entry in config.categories()["compatible"]:
        a, b, *rest = entry
        pair = frozenset((a, b))
        (strong if "strong_name" in rest else plain).add(pair)
    return plain, strong


def categories_compatible(a: str | None, b: str | None, name_sim: float) -> bool:
    if a is None or b is None or a == b:
        return True
    plain, strong = _compat()
    pair = frozenset((a, b))
    if pair in plain:
        return True
    if name_sim >= STRONG and (pair in strong or frozenset(("egyeb", "*")) in strong and "egyeb" in pair):
        return True
    return False


@dataclass
class Cluster:
    records: list[SourceRecord] = field(default_factory=list)

    @property
    def anchor(self) -> SourceRecord:
        exact = [r for r in self.records if r.has_coords and r.coord_quality == "exact"]
        pool = exact or [r for r in self.records if r.has_coords] or self.records
        return min(pool, key=lambda r: _prio(r.source))

    @property
    def sources(self) -> set[str]:
        return {r.source for r in self.records}

    @property
    def cat(self) -> str | None:
        return pick_category(self.records)

    @property
    def name(self) -> str:
        ordered = sorted(self.records, key=lambda r: _prio(r.source))
        first = ordered[0].name
        if is_generic(first):
            # „Vár”, „Viadukt”, „Jegypénztár”: a többi forrás (elsőként a Wikidata) valódi neve
            for r in ordered[1:]:
                if r.name and not is_generic(r.name):
                    return r.name
        return first

    @property
    def settlement(self) -> str | None:
        for r in sorted(self.records, key=lambda r: _prio(r.source)):
            if r.settlement:
                return r.settlement
        return None

    @property
    def qids(self) -> set[str]:
        return {r.wikidata for r in self.records if r.wikidata}


@dataclass
class Report:
    ambiguous: list[dict] = field(default_factory=list)
    unmatched: list[dict] = field(default_factory=list)
    qid_conflicts: list[dict] = field(default_factory=list)
    subject_qids: list[dict] = field(default_factory=list)
    deduped: int = 0
    id_fixes: int = 0

    def write(self, out_dir: Path) -> None:
        out_dir.mkdir(parents=True, exist_ok=True)
        for name, rows in (
            ("ambiguous_matches.csv", self.ambiguous),
            ("unmatched.csv", self.unmatched),
            ("qid_conflicts.csv", self.qid_conflicts),
            ("subject_qids.csv", self.subject_qids),
        ):
            with (out_dir / name).open("w", newline="", encoding="utf-8") as f:
                if not rows:
                    f.write("")
                    continue
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                w.writeheader()
                w.writerows(rows)


def pick_category(records: Iterable[SourceRecord]) -> str | None:
    recs = sorted(records, key=lambda r: _prio(r.source))
    for r in recs:
        if r.cat and r.cat != "egyeb":
            return r.cat
    for r in recs:
        if r.cat:
            return r.cat
    return None


def _match_class(rec: SourceRecord, cl: Cluster, sim: float, d: float) -> tuple[str, float] | None:
    """Visszaadja a (párosítási osztály, sugár) párt, ha a pár elfogadható.

    - egyik név sem generikus: erős/gyenge névegyezés a kategória sugarán belül
    - pontosan az egyik generikus (pl. „Római katolikus templom” vs. „Szent
      Anna-templom”): csak a kis „generikus” sugáron belül
    - mindkettő generikus: csak szinte azonos névvel (különben a református és a
      katolikus templom összeolvadna) és a kis sugáron belül
    """
    cat = rec.cat or cl.cat
    strong_r, weak_r, generic_r = RADII.get(cat or "", DEFAULT_RADII)
    gen_a, gen_b = is_generic(rec.name), is_generic(cl.name)
    if gen_a and gen_b:
        if generic_r is not None and d <= generic_r and sim >= STRONG:
            return "generic", generic_r
        return None
    if sim >= STRONG and d <= strong_r:
        return "strong", strong_r
    if sim >= WEAK and d <= weak_r:
        return "weak", weak_r
    if generic_r is not None and d <= generic_r and (gen_a or gen_b):
        return "generic", generic_r
    return None


def _absorb(primary: SourceRecord, r: SourceRecord) -> None:
    primary.flags |= r.flags
    primary.extra.setdefault("dups", []).append(r.ref)
    for k in ("huwiki", "image", "ele", "desc", "settlement"):
        if getattr(primary, k) in (None, "") and getattr(r, k) not in (None, ""):
            setattr(primary, k, getattr(r, k))
    for k in ("heritage", "showcave"):
        if r.extra.get(k):
            primary.extra[k] = True


def _merge_same_qid(
    recs: list[SourceRecord], report: Report, qid_cat: dict[str, str | None] | None = None
) -> list[SourceRecord]:
    """Egy forráson belül azonos QID-ű rekordok (pl. egy hosszú híd vagy tó több
    OSM-darabja) egy rekorddá olvadnak, ha SAME_QID_MAX_M-en belül vannak ÉS a
    kategóriájuk összeegyeztethető. Különben a QID csak egy rekordon marad – azon,
    amelyiknek a kategóriája a Wikidata-elemével egyezik (qid_cat) –, a többiről
    levesszük (valószínű címkézési hiba, pl. a csúcs QID-je a rajta álló kilátón),
    hogy két pont ne kapja ugyanazt az azonosítót, és egyik se tűnjön el."""
    qid_cat = qid_cat or {}
    groups: dict[str, list[SourceRecord]] = defaultdict(list)
    for r in recs:
        if r.wikidata:
            groups[r.wikidata].append(r)
    absorbed: set[int] = set()
    for qid, group in groups.items():
        if len(group) < 2:
            continue
        wanted = qid_cat.get(qid)
        primary = next((r for r in group if wanted and r.cat == wanted), group[0])
        for r in group:
            if r is primary:
                continue
            d = (
                distance_m(r.lat, r.lon, primary.lat, primary.lon)
                if r.has_coords and primary.has_coords
                else -1
            )
            if 0 <= d <= SAME_QID_MAX_M and categories_compatible(primary.cat, r.cat, 1.0):
                _absorb(primary, r)
                absorbed.add(id(r))
                report.deduped += 1
            else:
                r.extra["dropped_wikidata"] = qid
                r.wikidata = None
                report.qid_conflicts.append(
                    {"forras": r.key, "nev": r.name, "kat": r.cat or "", "qid": qid, "tavolsag_m": round(d)}
                )
    return [r for r in recs if id(r) not in absorbed]


def _dedupe_within_source(
    records: list[SourceRecord], report: Report, qid_cat: dict[str, str | None] | None = None
) -> list[SourceRecord]:
    by_source: dict[str, list[SourceRecord]] = defaultdict(list)
    for r in records:
        by_source[r.source].append(r)
    out: list[SourceRecord] = []
    for _source, recs in by_source.items():
        recs = _merge_same_qid(recs, report, qid_cat)
        grid = GridIndex(cell_m=200)
        kept: list[SourceRecord] = []
        for r in recs:
            if not r.has_coords:
                kept.append(r)
                continue
            dup = None
            for other, _d in grid.near(r.lat, r.lon, DEDUPE_M):
                if other.cat == r.cat and fold(other.name) == fold(r.name):
                    dup = other
                    break
            if dup is None:
                grid.add(r.lat, r.lon, r)
                kept.append(r)
            else:
                report.deduped += 1
                dup.wikidata = dup.wikidata or r.wikidata
                dup.flags |= r.flags
                dup.extra.setdefault("dups", []).append(r.ref)
                for k in ("huwiki", "image", "ele", "desc"):
                    if getattr(dup, k) in (None, "") and getattr(r, k) not in (None, ""):
                        setattr(dup, k, getattr(r, k))
        out.extend(kept)
    return out


class Conflator:
    def __init__(self, source_cfgs: dict[str, dict]):
        self.source_cfgs = source_cfgs
        self.clusters: list[Cluster] = []
        self.by_qid: dict[str, Cluster] = {}
        self.by_settlement: dict[str, list[Cluster]] = defaultdict(list)
        self.grid = GridIndex(cell_m=2000)
        self.report = Report()

    # -- klaszterkezelés -------------------------------------------------------
    def _new_cluster(self, rec: SourceRecord) -> Cluster:
        cl = Cluster([rec])
        self.clusters.append(cl)
        if rec.has_coords:
            self.grid.add(rec.lat, rec.lon, cl)
        if rec.wikidata and rec.wikidata not in self.by_qid:
            self.by_qid[rec.wikidata] = cl
        if rec.settlement:
            self.by_settlement[fold(rec.settlement)].append(cl)
        return cl

    def _attach(self, rec: SourceRecord, cl: Cluster) -> None:
        cl.records.append(rec)
        if rec.wikidata and rec.wikidata not in self.by_qid:
            self.by_qid[rec.wikidata] = cl
        if rec.settlement:
            key = fold(rec.settlement)
            if cl not in self.by_settlement[key]:
                self.by_settlement[key].append(cl)

    # -- párosítás -------------------------------------------------------------
    def _candidates(self, rec: SourceRecord) -> list[tuple[float, Cluster, float, float, str]]:
        """(prioritás, klaszter, névhasonlóság, távolság, osztály) listája."""
        out = []
        if rec.has_coords and rec.coord_quality == "exact":
            max_r = max(RADII.get(rec.cat or "", DEFAULT_RADII)[0], 600.0 if rec.cat is None else 0.0)
            seen: set[int] = set()
            for cl, d in self.grid.near(rec.lat, rec.lon, max_r):
                if id(cl) in seen or rec.source in cl.sources:
                    continue
                seen.add(id(cl))
                sim = name_similarity(rec.name, cl.name, rec.settlement, cl.settlement)
                if not categories_compatible(rec.cat, cl.cat, sim):
                    if sim >= STRONG:
                        self.report.ambiguous.append(self._row(rec, cl, sim, d, "kategória-ütközés"))
                    continue
                m = _match_class(rec, cl, sim, d)
                if m is None:
                    weak_r = RADII.get(rec.cat or cl.cat or "", DEFAULT_RADII)[1]
                    if sim >= AMBIGUOUS and d <= weak_r:
                        self.report.ambiguous.append(self._row(rec, cl, sim, d, "bizonytalan név"))
                    continue
                klass, radius = m
                prio = 0.6 * sim + 0.4 * (1.0 - d / radius)
                out.append((prio, cl, sim, d, klass))
        elif rec.settlement:
            for cl in self.by_settlement.get(fold(rec.settlement), ()):
                if rec.source in cl.sources:
                    continue
                sim = name_similarity(rec.name, cl.name, rec.settlement, cl.settlement)
                if sim >= APPROX_NAME and categories_compatible(rec.cat, cl.cat, sim):
                    out.append((sim, cl, sim, -1.0, "settlement"))
        return out

    @staticmethod
    def _row(rec: SourceRecord, cl: Cluster, sim: float, d: float, why: str) -> dict:
        return {
            "ok": why,
            "forras": rec.key,
            "nev": rec.name,
            "kat": rec.cat or "",
            "klaszter": cl.anchor.key,
            "klaszter_nev": cl.name,
            "klaszter_kat": cl.cat or "",
            "nevhasonlosag": round(sim, 3),
            "tavolsag_m": round(d),
        }

    def add_source(self, records: list[SourceRecord]) -> None:
        """Egy forrás összes rekordjának beillesztése."""
        if not records:
            return
        source = records[0].source
        mode = self.source_cfgs.get(source, {}).get("mode", "confirm")
        pending: list[SourceRecord] = []
        for rec in records:
            cl = self.by_qid.get(rec.wikidata) if rec.wikidata else None
            if cl is not None and source not in cl.sources:
                self._attach(rec, cl)
            elif cl is not None:
                # Ugyanaz a QID több rekordon ugyanabból a forrásból (pl. egy hosszú
                # híd vagy tó több OSM-darabja, egy vár területe és pontja).
                d = distance_m(rec.lat, rec.lon, cl.anchor.lat, cl.anchor.lon) if rec.has_coords else 0
                if d <= SAME_QID_MAX_M:
                    cl.anchor.extra.setdefault("dups", []).append(rec.ref)
                    self.report.deduped += 1
                else:
                    # messze van: valószínű címkézési hiba -> QID nélkül megy tovább,
                    # különben két pont kapná ugyanazt az azonosítót
                    rec.extra["dropped_wikidata"] = rec.wikidata
                    rec.wikidata = None
                    self.report.qid_conflicts.append(
                        {
                            "forras": rec.key,
                            "nev": rec.name,
                            "qid": rec.extra["dropped_wikidata"],
                            "tavolsag_m": round(d),
                        }
                    )
                    pending.append(rec)
            else:
                pending.append(rec)

        pairs = []
        for rec in pending:
            for prio, cl, sim, d, klass in self._candidates(rec):
                pairs.append((prio, id(rec), rec, cl, sim, d, klass))
        pairs.sort(key=lambda p: -p[0])
        assigned: set[int] = set()
        for _prio_val, rid, rec, cl, _sim, _d, _klass in pairs:
            if rid in assigned or source in cl.sources:
                continue
            self._attach(rec, cl)
            assigned.add(rid)

        for rec in pending:
            if id(rec) in assigned:
                continue
            if mode == "add" and rec.has_coords:
                self._new_cluster(rec)
            else:
                self.report.unmatched.append(
                    {
                        "forras": rec.key,
                        "nev": rec.name,
                        "kat": rec.cat or "",
                        "telepules": rec.settlement or "",
                        "lat": rec.lat if rec.lat is not None else "",
                        "lon": rec.lon if rec.lon is not None else "",
                    }
                )

    def force_merge(self, refs: list[str]) -> None:
        """Kézi összevonás (overrides.yaml `merge`): a megadott rekord-kulcsok
        (forrás:ref) klasztereit egyesíti."""
        targets = [cl for cl in self.clusters if any(r.key in refs for r in cl.records)]
        if len(targets) < 2:
            return
        head, *rest = targets
        for cl in rest:
            head.records.extend(cl.records)
            self.clusters.remove(cl)
        for qid in head.qids:
            self.by_qid[qid] = head


def _subject_reason(rec: SourceRecord, item: SourceRecord) -> str | None:
    """Miért a tárgyára (és nem a helyre) mutat a rekord QID-je; None, ha a helyre."""
    if not item.has_coords:
        return "a Wikidata-elemnek nincs helye"
    if rec.has_coords:
        d = distance_m(rec.lat, rec.lon, item.lat, item.lon)
        if d > SUBJECT_MAX_M:
            return f"{round(d)} m-re van"
    if name_similarity(rec.name, item.name, rec.settlement, item.settlement) < SUBJECT_MIN_SIM:
        return "más a neve"
    return None


# Ezek a források a QID-en keresztül csak „rákapcsolódnak” egy elemre (nem saját helyük
# van): ha a QID tárgyra mutat, a rekordjuk is a tárgyat írja le (pl. a hu-wiki
# kastélylista a falu cikkére linkel, mert a kastélynak nincs saját cikke).
LINK_ONLY_SOURCES = frozenset({"wikidata", "huwiki"})


def _strip_subject_qids(records: list[SourceRecord], report: Report) -> list[SourceRecord]:
    """A tárgyra mutató QID-ek leválasztása; a szűrt rekordlistát adja vissza.

    Az OSM-ben a „wikidata” címke gyakran a szobor alakjára, a kiállított tárgy típusára
    (T-34, MiG-21), egy fajtára vagy a falura mutat (a helyes címke a „subject:wikidata”
    lenne). Ilyenkor a pontozás a tárgy Wikipédia-ismertségét kapná, és a hely a kiemeltek
    közé kerülne. Jel: a Wikidata-elem a mi osztálytérképünkkel besorolhatatlan, és nincs
    helye, messze van, vagy más a neve. A besorolt elemekhez (vár, templom…) nem nyúlunk.

    Ha egy QID-et minden helyhez kötött rekord elengedett, a Wikidata-eleme és a rá mutató
    hu-wiki rekordok is kimaradnak – különben ők ketten (a falu koordinátájával, nevével
    és ismertségével) új, hamis pontot alkotnának.
    """
    items = {r.ref: r for r in records if r.source == "wikidata"}
    stripped: dict[str, list[dict]] = defaultdict(list)
    kept: set[str] = set()
    for rec in records:
        if rec.source in LINK_ONLY_SOURCES or not rec.wikidata:
            continue
        item = items.get(rec.wikidata)
        if item is None or item.cat is not None:
            continue
        why = _subject_reason(rec, item)
        if why is None:
            kept.add(rec.wikidata)
            continue
        row = {"forras": rec.key, "nev": rec.name, "qid": rec.wikidata, "targy": item.name, "ok": why}
        stripped[rec.wikidata].append(row)
        report.subject_qids.append(row)
        rec.extra["subject_wikidata"] = rec.wikidata
        rec.wikidata = None
        if rec.huwiki and rec.huwiki == item.huwiki:
            rec.huwiki = None

    subjects = set(stripped) - kept
    if not subjects:
        return records
    out: list[SourceRecord] = []
    dropped: dict[str, int] = defaultdict(int)
    for rec in records:
        if rec.wikidata in subjects:
            if rec.source in LINK_ONLY_SOURCES:
                dropped[rec.wikidata] += 1
                continue
            rec.extra["subject_wikidata"] = rec.wikidata
            rec.wikidata = None
        out.append(rec)
    for qid, rows in stripped.items():
        for row in rows:
            row["kihagyott_rekordok"] = dropped.get(qid, 0)
    return out


def conflate(records: list[SourceRecord], source_order: list[str], source_cfgs: dict[str, dict]) -> Conflator:
    conf = Conflator(source_cfgs)
    records = _strip_subject_qids(records, conf.report)
    # a Wikidata-elemek saját kategóriája: ez dönti el, melyik OSM-rekordon marad a QID
    qid_cat = {r.ref: r.cat for r in records if r.source == "wikidata"}
    records = _dedupe_within_source(records, conf.report, qid_cat)
    by_source: dict[str, list[SourceRecord]] = defaultdict(list)
    for r in records:
        by_source[r.source].append(r)
    ordered = [s for s in source_order if s in by_source] + sorted(
        s for s in by_source if s not in source_order
    )
    for s in ordered:
        conf.add_source(by_source[s])
    return conf


# -- POI építése ------------------------------------------------------------------


def _choose(records: list[SourceRecord], attr: str):
    for r in sorted(records, key=lambda r: _prio(r.source)):
        val = getattr(r, attr)
        if val not in (None, "", [], 0):
            return val
    return None


def poi_id(cl: Cluster) -> str:
    qids = sorted(cl.qids, key=lambda q: int(q[1:]) if q[1:].isdigit() else 0)
    if qids:
        return qids[0]
    osm = [r for r in cl.records if r.source == "osm"]
    if osm:
        return osm[0].ref
    first = min(cl.records, key=lambda r: (_prio(r.source), r.ref))
    return f"{first.source}:{first.ref}"


def build_poi(cl: Cluster) -> Poi | None:
    recs = cl.records
    anchor = cl.anchor
    if not anchor.has_coords:
        return None
    cat = pick_category(recs)
    if cat is None:
        return None
    sub = None
    for r in sorted(recs, key=lambda r: _prio(r.source)):
        if r.cat == cat and r.sub:
            sub = r.sub
            break
    flags = 0
    for r in recs:
        flags |= r.flags
    if anchor.coord_quality != "exact":
        flags |= FLAG_APPROX
    if any(r.source == "sample" for r in recs):
        flags |= FLAG_SAMPLE
    if any(r.extra.get("heritage") for r in recs):
        flags |= FLAG_HERITAGE
    if any(r.extra.get("showcave") for r in recs):
        flags |= FLAG_SHOWCAVE
    if cat == "rom" or (sub and "rom" in fold(sub)):
        flags |= FLAG_RUIN
    image = _choose(recs, "image")
    img = None
    if image:
        img = {"file": image}
        for r in recs:
            meta = r.extra.get("image_meta")
            if meta and meta.get("file") == image:
                img.update({k: v for k, v in meta.items() if v})
        if img.get("license"):
            flags |= FLAG_IMAGE
    names = []
    seen = {fold(cl.name)}
    for r in recs:
        for n in [r.name, *r.alt_names]:
            if n and fold(n) not in seen:
                seen.add(fold(n))
                names.append(n)
    sources = []
    seen_src = set()
    for r in sorted(recs, key=lambda r: (_prio(r.source), r.source, r.ref)):
        if (r.source, r.ref) not in seen_src and r.source != "sample":
            seen_src.add((r.source, r.ref))
            sources.append({"s": r.source, "ref": r.ref})
    osm_ref = next((r.ref for r in recs if r.source == "osm"), None)
    huwiki = _choose(recs, "huwiki")
    if huwiki is None:
        huwiki = next((r.ref for r in recs if r.source == "huwiki"), None)
    tier_hint = next((r.extra["tier"] for r in recs if r.extra.get("tier")), None)
    pano = next((r.extra["pano"] for r in recs if r.extra.get("pano")), None)
    if pano:
        flags |= FLAG_PANO
    poi = Poi(
        id=poi_id(cl),
        name=cl.name,
        cat=cat,
        sub=sub,
        lat=anchor.lat,
        lon=anchor.lon,
        county=_choose(recs, "county") or "",
        settlement=cl.settlement,
        flags=flags,
        wikidata=min(cl.qids, key=lambda q: int(q[1:])) if cl.qids else None,
        osm=osm_ref,
        huwiki=huwiki,
        sources=sources,
        desc=_choose(recs, "desc"),
        ele=_choose(recs, "ele"),
        img=img,
        alt=names[:3],
        pano=pano,
    )
    poi.meta = {
        "sitelinks": max((r.sitelinks for r in recs), default=0),
        "sources": {r.source for r in recs},
        "tier_hint": tier_hint,
        "generic": is_generic(cl.name),
        "showcave": any(r.extra.get("showcave") for r in recs),
    }
    return poi


FINAL_DEDUPE_M = 30.0


def merge_close_duplicates(pois: list[Poi]) -> tuple[list[Poi], int]:
    """Utolsó biztonsági kör: azonos kategóriájú, azonos nevű pontok 30 m-en belül
    egy pontba (pl. ugyanarra a helyre mutató két különböző Wikidata-elem).
    A több forrással rendelkező pont marad meg, a másik forrásai átkerülnek rá."""
    order = sorted(pois, key=lambda p: (-len(p.sources), p.id))
    grid = GridIndex(cell_m=100)
    kept: list[Poi] = []
    merged = 0
    for p in order:
        target = None
        for other, _d in grid.near(p.lat, p.lon, FINAL_DEDUPE_M):
            if other.cat == p.cat and fold(other.name) == fold(p.name):
                target = other
                break
        if target is None:
            grid.add(p.lat, p.lon, p)
            kept.append(p)
            continue
        merged += 1
        have = {(s["s"], s["ref"]) for s in target.sources}
        target.sources.extend(s for s in p.sources if (s["s"], s["ref"]) not in have)
        target.flags |= p.flags
        for attr in ("wikidata", "osm", "huwiki", "desc", "ele", "img", "settlement", "sub"):
            if getattr(target, attr) in (None, "") and getattr(p, attr) not in (None, ""):
                setattr(target, attr, getattr(p, attr))
        target.meta["sitelinks"] = max(target.meta.get("sitelinks", 0), p.meta.get("sitelinks", 0))
        target.meta["sources"] = set(target.meta.get("sources", set())) | set(p.meta.get("sources", set()))
        target.meta["showcave"] = target.meta.get("showcave") or p.meta.get("showcave")
    return kept, merged


def ensure_unique_ids(pois: list[Poi]) -> int:
    """Biztonsági háló: ha két pont mégis ugyanazt az azonosítót kapná, a több
    forrású marad, a többi az OSM-azonosítóját (vagy <forrás>:<ref>) kapja, és
    lekerül róla a QID. Visszaadja a javított pontok számát."""
    groups: dict[str, list[Poi]] = defaultdict(list)
    for p in pois:
        groups[p.id].append(p)
    taken = set(groups)
    fixed = 0
    for pid, group in groups.items():
        if len(group) < 2:
            continue
        group.sort(key=lambda p: (-len(p.sources), p.osm or "", p.name))
        for k, p in enumerate(group[1:], start=2):
            candidates = [p.osm] if p.osm else []
            candidates += [f"{s['s']}:{s['ref']}" for s in p.sources if s["s"] not in ("osm", "wikidata")]
            new_id = next((c for c in candidates if c and c not in taken), None) or f"dup:{pid}-{k}"
            if p.wikidata == pid:
                p.wikidata = None
                p.sources = [s for s in p.sources if not (s["s"] == "wikidata" and s["ref"] == pid)]
            p.id = new_id
            taken.add(new_id)
            fixed += 1
    return fixed
