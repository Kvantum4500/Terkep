"""A minta-turistautak (data/sample/trails) előállítása a webes tesztekhez.

Futtatás a pipeline könyvtárból: python scripts/make_sample_trails.py
"""

from pathlib import Path

from terkep_pipeline.sources import trails as t

R = t.TrailRel
rels = {
    1000: R(1000, {"name": "Minta Kéktúra", "jel": "k", "network": "nwn"}, [], [1001, 1002]),
    1001: R(1001, {"name": "Minta kék sáv: Visegrád – Dobogókő", "jel": "k", "network": "nwn"}, [1], []),
    1002: R(
        1002, {"name": "Minta kék sáv: Dobogókő – Pilisszentlászló", "jel": "k", "network": "nwn"}, [2], []
    ),
    1003: R(
        1003,
        {"name": "Minta sárga kereszt: Pilisszentkereszt – Pilis-tető", "jel": "s+", "network": "lwn"},
        [3],
        [],
    ),
    1004: R(1004, {"name": "Minta piros sáv: János-hegy", "jel": "p", "network": "rwn"}, [4], []),
    1005: R(1005, {"name": "Minta zöld háromszög: Nagy-Villám", "jel": "z3", "network": "lwn"}, [5], []),
}
ways = {
    1: [
        (18.9811, 47.7942),
        (18.975, 47.785),
        (18.962, 47.772),
        (18.95, 47.76),
        (18.93, 47.745),
        (18.91, 47.73),
        (18.8957, 47.7186),
    ],
    2: [(18.8957, 47.7186), (18.92, 47.722), (18.945, 47.724), (18.97, 47.725)],
    3: [(18.90, 47.69), (18.89, 47.686), (18.873, 47.68)],
    4: [(18.96, 47.52), (18.975, 47.523), (18.99, 47.53), (19.01, 47.515)],
    5: [(18.99, 47.79), (18.995, 47.785), (19.0, 47.781)],
}
index, geo = t.build(rels, ways)
t.write(index, geo, Path("../data/sample/trails"))
print([(e["id"], e["km"]) for e in index["trails"]])
