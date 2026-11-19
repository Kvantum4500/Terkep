# Magyarország látnivalói – szűrhető térkép

Várak, kastélyok, templomok, hidak, romok, hegycsúcsok, barlangok, sziklák
(pl. bazaltorgonák), vízesések, források, tavak, völgyek, arborétumok és kilátók
**vármegyénként**, szabadon kombinálható szűrőkkel: „csak várak”, „csak Pest
vármegye”, „Pest vármegye templomai”, „látogatható barlangok Borsodban”…

Ez egy készülő magyar túra-app. A későbbi lépések: saját teljesítmény mentése, GPS és
egészségadatok (Samsung Health / Health Connect), AI-asszisztens.

- **A térképet semmi nem takarja:** telefonon álló helyzetben a panel a térkép alatt van
  (húzható, a térkép mindig legalább 40%), fekvő helyzetben és asztalon mellette
  (asztalon elrejthető).
- **Alaptérképek:** turistatérkép (OpenTopoMap), utcatérkép (OSM), **műhold** (Esri),
  jelzett turistautak rétege (Waymarked Trails).
- **Útvonaltervezés az appban:** túra (ösvények, földutak előnyben), kerékpár, autó;
  köztes pontok, legfeljebb 3 változat táv/idő/szintemelkedés adatokkal, **látnivalók az
  út mentén**, útleírás, **GPX-letöltés**. Pont a kártyáról („Útvonal ide”, „Útba ejtem”)
  vagy a térképről (hosszú nyomás / jobb klikk). Motor: Valhalla, tartalék: OSRM
  (FOSSGIS, OpenStreetMap-adat); az útvonal csak a készüléken marad.
- **360°-os kép:** Google-utcakép az appban, a látnivaló felé fordulva (ha be vannak
  állítva a Google-kulcsok, lásd lent); nyílt gömb- és 360°-os körpanorámák (Wikimedia
  Commons, Wikidata) és – ha be van állítva – Mapillary-utcaképek. A listában „360°” jelzi,
  hol van kép, és szűrni is lehet rá.
- **Útválasztás:** autóút nélkül / kis forgalmú utak / bármilyen út / legrövidebb
  (autóval: leggyorsabb / autópálya nélkül / legrövidebb), és kiírja, mennyi az útból a közút.
- **Ha a térkép vibrál** (egyes Samsung-telefonokon): Rétegek → *Kompatibilis mód*.
- **Vissza gomb:** Androidon a kártyát és az útvonal-nézetet zárja be, nem lép ki az appból.
- **Telepíthető app (PWA):** Androidon (Samsung Internet / Chrome: „Hozzáadás a
  kezdőképernyőhöz”) és Windowson (Edge / Chrome: „Alkalmazás telepítése”) is
  ikonnal indul, és **offline is működik** (az adatok a készüléken vannak).
- **Megosztható szűrők:** a szűrők a link végén vannak, pl.
  `…/Terkep/#m=PE&k=templom`.

> **Jelenlegi állapot:** az élő app a valós adatbázissal fut (22 115 látnivaló, az
> **Adatfrissítés** workflow tölti le, lásd lent). A tesztek a kézzel összeállított
> mintaadaton (`data/sample/`, 132 ismert látnivaló) futnak.

## Teendők a repó gazdájának

1. **Repó nyilvánossá tétele:** Settings → General → Danger Zone → Change visibility.
2. **GitHub Pages:** Settings → Pages → Build and deployment → Source: **GitHub Actions**.
   Utána minden push az alapértelmezett ágra kiteszi az appot ide:
   `https://kvantum4500.github.io/Terkep/`
3. **Adatfrissítés engedélyezése:** Settings → Actions → General → „Allow GitHub
   Actions to create and approve pull requests”.
4. **Mapillary-utcaképek (nem kötelező):** regisztráció a mapillary.com-on → Dashboard →
   Developers → Register application → a „Client Token” bemásolása ide: Settings → Secrets
   and variables → Actions → **Variables** → New repository variable, név:
   `MAPILLARY_TOKEN`. Ez nyilvános, böngészőbe szánt token; nélküle a Commons-körképek és a
   Google-utcakép link működik.
5. **Google-utcakép az appban (nem kötelező, de ajánlott):** a Google Cloud Console-ban
   (console.cloud.google.com, a projekthez számlázási fiók kell, de ez a két szolgáltatás
   ingyenes):
   1. *APIs & Services → Library*: engedélyezd a **Maps Embed API**-t és a
      **Street View Static API**-t.
   2. *APIs & Services → Credentials → Create credentials → API key* – **böngészőkulcs**:
      *Application restrictions*: Websites → `https://kvantum4500.github.io/*` és
      `https://localhost/*`; *API restrictions*: csak **Maps Embed API**. A kulcsot a repóban
      így add meg: Settings → Secrets and variables → Actions → **Variables** →
      `GOOGLE_MAPS_EMBED_KEY` (ez nyilvános lesz a weboldalon, a korlátozás védi).
   3. Második API-kulcs – **szerverkulcs**: *API restrictions*: csak **Street View Static
      API**. Ezt titokként add meg: Settings → Secrets and variables → Actions → **Secrets** →
      `GOOGLE_MAPS_SERVER_KEY`. Az adatfrissítés ezzel nézi meg, melyik látnivalónál van
      utcakép (a metaadat-lekérés ingyenes).
   4. Utána futtasd az *Adatfrissítés* workflow-t.
6. **Valós adat:** Actions → *Adatfrissítés* → Run workflow. Kb. 1–2 óra; a végén PR
   nyílik a friss `data/` könyvtárral és egy riporttal (vármegyénkénti top 15,
   bizonytalan párosítások). A túraoldalak felderítési riportja az artifactok között van.

## Felépítés

```
data/       a pipeline kimenete (ODbL) – ezt olvassa az app
  sample/   kézi mintaadat (fejlesztés, tesztek)
pipeline/   Python: gyűjtés, összevonás, pontozás (terkep parancs)
web/        React + TypeScript + MapLibre GL + PWA
```

### Adatpipeline

| Lépés | Mit csinál |
|---|---|
| `terkep fetch osm` | Geofabrik Magyarország-kivonat → látnivalók + vármegye- és településhatárok |
| `terkep fetch wikidata` | osztályfák, magyarországi elemek, magyar név/leírás, kép, védettség |
| `terkep fetch huwiki` | magyar Wikipédia-listák (melyik helyet tartják számon) |
| `terkep fetch commons` | képek szerzője és licence |
| `terkep discover all` | túraoldalak felderítése: robots.txt, ÁSZF, sitemap, koordináták (csak riport) |
| `terkep fetch site all` | az engedélyezett túraoldalak (csak tények + link) |
| `terkep build` | összevonás → vármegye → pontozás → `data/` |
| `terkep golden` | aranylista: a híres helyek „kiemelt” szinten, jó vármegyében vannak-e |

**Összevonás:** ugyanannak a helynek az OSM-, Wikidata- és oldalrekordjait
azonosító (Wikidata QID), távolság és névhasonlóság alapján vonja össze, kategóriánként
eltérő sugárral (templom 150 m, vár 600 m, tó 1,5 km…). Két különböző templom egy
faluban nem olvad össze; a csúcs és a rajta álló kilátó külön marad.

**Fontosság:** pontszám (magyar Wikipédia-cikk, nyelvi változatok száma, hány válogatott
forrás említi, védettség, kép, kategória) → szintek:
*kiemelt* – kategóriánként a legjobb N (pl. vár 80, templom 100, kilátó 30; barlangnál csak
a látogatható), *érdekes* – a maradék országos rangsorának felső ~12%-a, legalább 8
vármegyénként, *helyi* – a többi. Az automatikusan alulértékelt, de híres helyeket a
`pipeline/curation/overrides.yaml` emeli ki; az aranylista (`golden.yaml`) ezt ellenőrzi.

**Túraoldalak:** csak tényeket veszünk át (név, hely, kategória) és visszalinkelünk.
Alapból *megerősítő* módban futnak: meglévő ponthoz adnak forrást és fontosságot,
újat nem hoznak létre (EU-s adatbázisjog). Részletek: [DATA_LICENSE.md](DATA_LICENSE.md).

## Fejlesztés

```bash
# pipeline
cd pipeline
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/pytest                      # egységtesztek
.venv/bin/terkep build --sample       # mintaadat -> data/sample/
.venv/bin/pytest -m data              # adatminőségi tesztek

# web
cd web
npm install
npm run dev                           # http://localhost:5173
npm test                              # egységtesztek (vitest)
BASE_PATH=/Terkep/ npm run build && npm run e2e   # Playwright, mobil + asztali nézet
```

A web-app a `data/` könyvtárat használja, ha van benne `pois.ndjson`, különben a
mintaadatot (`TERKEP_DATA` környezeti változóval felülírható).

## Licenc

Kód: MIT ([LICENSE](LICENSE)). Adat: ODbL 1.0, forrásmegjelöléssel ([DATA_LICENSE.md](DATA_LICENSE.md)).
