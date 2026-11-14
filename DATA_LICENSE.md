# Adatlicenc és forrásmegjelölés

A `data/` könyvtár látnivaló-adatbázisa (`pois.ndjson`, `meta.json`, `id_aliases.json`)
OpenStreetMap-adatokból származtatott adatbázis, ezért az
**[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)**
alatt érhető el. Forrásmegjelölés: „© OpenStreetMap közreműködők”.

| Forrás | Mit veszünk át | Licenc |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | helyek, nevek, címkék, vármegye- és településhatárok | ODbL 1.0 |
| [Wikidata](https://www.wikidata.org) | magyar név és rövid leírás, magasság, védettség, sitelink-szám, képfájl neve | CC0 1.0 |
| [Magyar Wikipédia](https://hu.wikipedia.org) | csak a listákon szereplő szócikkek címe (hivatkozás) | – (szöveget nem tárolunk) |
| [Wikimedia Commons](https://commons.wikimedia.org) | képfájl neve, szerző, licenc (a kép a Commonsról töltődik be) | képenként (a pontnál feltüntetve) |
| [geoBoundaries](https://www.geoboundaries.org) / [Natural Earth](https://www.naturalearthdata.com) | tartalék vármegyehatárok | CC0 / közkincs |

## Magyar túra- és látnivaló-oldalak

A kektura.hu, termeszetvedelem.hu, muemlekem.hu, archeodatabase.hnm.hu,
turistautak.hu, termeszetjaro.hu, kirandulastippek.hu és programturizmus.hu
oldalakról **csak tényeket** veszünk át (név, hely, kategória, település), és minden
érintett pontnál visszalinkelünk az eredeti oldalra. Leírást, fotót nem másolunk.

Az EU-s adatbázisjog (Szjt. 84/A. §) miatt ezek az oldalak alapból csak
**megerősítő** forrásként működnek: meglévő ponthoz adnak forráslinket és
fontosságot, új pontot nem hoznak létre. Egy oldal csak a `discover` riport
(robots.txt, ÁSZF) átnézése után kapcsolható be a `pipeline/config/sources.yaml`
fájlban.

## Kézi mintaadat

A `data/sample/` kézzel összeállított mintaadat (ismert látnivalók közelítő
koordinátákkal, saját rövid leírásokkal) a fejlesztéshez és a tesztekhez; a
valós buildben nem szerepel.

## Egyéb

- Ikonok: [Maki](https://github.com/mapbox/maki) (CC0 1.0) és saját rajz.
- Betűtípus: Noto Sans (SIL Open Font License 1.1, `web/public/fonts/OFL.txt`),
  a [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets) glyph-fájljai.
- Alaptérkép (futásidőben): OpenTopoMap (CC BY-SA), OpenStreetMap, Waymarked Trails (CC BY-SA).
