"""Magyar túra- és látnivaló-oldalak adapterei.

A legtöbb oldal az általános `SiteAdapter`-t használja (sitemap + tény-kinyerő);
oldalspecifikus logika csak ott van, ahol szükséges (pl. kektura.hu GPX).
Egy oldal csak akkor fut, ha a sources.yaml-ben `enabled: true` és van
`poi_url_patterns` – ezeket a `discover` riport alapján kell beállítani.
"""

from __future__ import annotations

from .base import SiteAdapter
from .kektura import KekturaAdapter

SITE_KEYS = [
    "kektura",
    "termeszetvedelem",
    "muemlekem",
    "archeodatabase",
    "turistautak",
    "termeszetjaro",
    "kirandulastippek",
    "programturizmus",
]

_SPECIAL: dict[str, type[SiteAdapter]] = {"kektura": KekturaAdapter}


def adapter_for(key: str, client, cfg: dict) -> SiteAdapter:
    cls = _SPECIAL.get(key, SiteAdapter)
    inst = cls(client, cfg)
    inst.key = key
    return inst
