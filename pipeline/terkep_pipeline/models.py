"""Adatmodellek: forrásrekord (egy forrás egy említése) és a végső POI."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Jelzőbitek (a webes kliens is ezeket használja: web/src/data/types.ts)
FLAG_HERITAGE = 1  # műemlék / védett
FLAG_IMAGE = 2  # van nyílt licencű képe
FLAG_KEKTURA = 4  # Kéktúra-pecsételőhely
FLAG_SHOWCAVE = 8  # látogatható barlang (általában csak vezetéssel)
FLAG_RUIN = 16  # rom
FLAG_APPROX = 32  # közelítő koordináta
FLAG_SAMPLE = 64  # kézi mintaadat
FLAG_STREETVIEW = 128  # van Google-utcakép a közelben
FLAG_PANO = 256  # van nyílt gömbpanoráma (Wikidata P4640)

FLAG_BY_NAME = {
    "heritage": FLAG_HERITAGE,
    "image": FLAG_IMAGE,
    "kektura": FLAG_KEKTURA,
    "showcave": FLAG_SHOWCAVE,
    "ruin": FLAG_RUIN,
    "approx": FLAG_APPROX,
    "sample": FLAG_SAMPLE,
    "streetview": FLAG_STREETVIEW,
    "pano": FLAG_PANO,
}


@dataclass
class SourceRecord:
    """Egy látnivaló egy forrásban. A forrásadapterek ezt állítják elő."""

    source: str  # forráskulcs (sources.yaml)
    ref: str  # forráson belüli azonosító (OSM: n123/w123/r123, Wikidata: Q123, oldal: URL-útvonal)
    name: str
    lat: float | None = None
    lon: float | None = None
    cat: str | None = None
    sub: str | None = None
    settlement: str | None = None
    county: str | None = None  # csak ha a forrás megadja (pl. mintaadat)
    wikidata: str | None = None
    huwiki: str | None = None
    alt_names: list[str] = field(default_factory=list)
    desc: str | None = None
    ele: float | None = None
    image: str | None = None  # Commons fájlnév
    sitelinks: int = 0
    flags: int = 0
    coord_quality: str = "exact"  # exact | approx | none
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def has_coords(self) -> bool:
        return self.lat is not None and self.lon is not None

    @property
    def key(self) -> str:
        return f"{self.source}:{self.ref}"


@dataclass
class Poi:
    """A végső, összevont látnivaló (a data/pois.ndjson egy sora)."""

    id: str
    name: str
    cat: str
    lat: float
    lon: float
    county: str
    sub: str | None = None
    alt: list[str] = field(default_factory=list)
    settlement: str | None = None
    tier: int = 3
    score: float = 0.0
    flags: int = 0
    wikidata: str | None = None
    osm: str | None = None
    huwiki: str | None = None
    sources: list[dict[str, str]] = field(default_factory=list)
    desc: str | None = None
    ele: float | None = None
    img: dict[str, str] | None = None
    # Google-utcakép a közelben: a felvétel helye és az irány a látnivaló felé
    sv: dict[str, float] | None = None
    # nyílt gömbpanoráma (Commons-fájlnév, Wikidata P4640)
    pano: str | None = None
    # belső, nem exportált adatok a pontozáshoz (sitelinks, források halmaza stb.)
    meta: dict[str, Any] = field(default_factory=dict, repr=False)

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "cat": self.cat,
            "lat": round(self.lat, 5),
            "lon": round(self.lon, 5),
            "county": self.county,
            "tier": self.tier,
            "score": round(self.score, 2),
            "flags": self.flags,
            "sources": self.sources,
        }
        for key in ("sub", "settlement", "wikidata", "osm", "huwiki", "desc"):
            val = getattr(self, key)
            if val:
                out[key] = val
        if self.alt:
            out["alt"] = self.alt
        if self.ele is not None:
            out["ele"] = round(self.ele)
        if self.img:
            out["img"] = self.img
        if self.sv:
            out["sv"] = self.sv
        if self.pano:
            out["pano"] = self.pano
        return out
