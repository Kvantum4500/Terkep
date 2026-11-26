"""Magyar nevek normalizálása és hasonlósága az összevonáshoz."""

from __future__ import annotations

import re
import unicodedata
from functools import cache

from rapidfuzz import fuzz

from . import config

_NON_ALNUM = re.compile(r"[^0-9a-z]+")

# Rendhagyó helynév-melléknevek (ékezet nélkül).
_IRREGULAR_ADJ = {
    "eger": ["egri"],
    "szekesfehervar": ["szekesfehervari", "fehervari"],
    "budapest": ["budapesti", "pesti", "budai"],
}


def fold(text: str) -> str:
    """Kisbetű, ékezet nélkül, írásjelek helyén szóköz."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _NON_ALNUM.sub(" ", stripped).strip()


def tokens(text: str) -> list[str]:
    return [t for t in fold(text).split() if t]


@cache
def generic_words() -> frozenset[str]:
    words = config.categories()["generic_words"]
    folded = {fold(str(w)) for w in words}
    folded.discard("ko")  # a „kő” sosem generikus
    return frozenset(w for w in folded if w)


@cache
def settlement_adjectives(settlement: str) -> frozenset[str]:
    """Egy településnév lehetséges melléknévi alakjai (pl. Visegrád -> visegradi)."""
    base = fold(settlement).replace(" ", "")
    if not base:
        return frozenset()
    out = {base, base + "i"}
    if base[-1] in "aeiou":
        out.add(base[:-1] + "i")
        out.add(base + "i")
    out.update(_IRREGULAR_ADJ.get(base, []))
    return frozenset(out)


def core_tokens(name: str, settlement: str | None = None) -> list[str]:
    """A név megkülönböztető szavai (generikus szavak és opcionálisan a
    település melléknévi alakja nélkül)."""
    gen = generic_words()
    adj = settlement_adjectives(settlement) if settlement else frozenset()
    return [t for t in tokens(name) if t not in gen and t not in adj]


@cache
def is_generic(name: str) -> bool:
    """Igaz, ha a névben nincs megkülönböztető szó (pl. „Római katolikus templom”)."""
    return not core_tokens(name)


def name_similarity(
    a: str, b: str, settlement_a: str | None = None, settlement_b: str | None = None
) -> float:
    """0..1 közötti névhasonlóság.

    Ha mindkét névben van megkülönböztető szó, CSAK azokat hasonlítjuk össze
    (különben a közös generikus végződés – „-i vár”, „templom” – hamis
    egyezést adna). Ha valamelyik név generikus, a teljes nevek arányát nézzük.
    A token_set_ratio részhalmaz esetén 100-at ad, ezért csak akkor használjuk,
    ha mindkét oldalon legalább két szó van.
    """
    best: float | None = None
    for ca, cb in (
        (core_tokens(a), core_tokens(b)),
        (core_tokens(a, settlement_a), core_tokens(b, settlement_b)),
    ):
        if not ca or not cb:
            continue
        sa, sb = " ".join(ca), " ".join(cb)
        if min(len(ca), len(cb)) >= 2:
            sim = fuzz.token_set_ratio(sa, sb) / 100.0
        else:
            sim = fuzz.token_sort_ratio(sa, sb) / 100.0
        best = sim if best is None else max(best, sim)
    if best is not None:
        return best
    return fuzz.ratio(fold(a), fold(b)) / 100.0
