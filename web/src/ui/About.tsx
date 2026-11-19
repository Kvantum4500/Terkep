import { useEffect, useRef } from 'react'
import { formatCount } from '../filters/text'
import { useStore } from '../state/store'

export function About() {
  const open = useStore((s) => s.aboutOpen)
  const setOpen = useStore((s) => s.setAboutOpen)
  const data = useStore((s) => s.data)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  if (!data) return null
  const { meta } = data
  const generated = new Date(meta.generated).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <dialog ref={ref} className="about" onClose={() => setOpen(false)} aria-labelledby="about-title">
      <h2 id="about-title">Az adatokról</h2>
      {meta.sample ? (
        <p className="notice">
          Most <strong>kézi mintaadat</strong> látható ({formatCount(meta.counts.total)} ismert látnivaló, közelítő
          helyekkel). A teljes adatbázis az első adatfrissítés után jelenik meg.
        </p>
      ) : (
        <p>
          {formatCount(meta.counts.total)} látnivaló, utolsó frissítés: {generated}.
        </p>
      )}
      <h3>Források</h3>
      <ul>
        {Object.entries(meta.sources)
          .filter(([k]) => k !== 'sample')
          .map(([k, s]) => (
            <li key={k}>
              <strong>{s.label}</strong>
              {s.license ? ` – ${s.license}` : ''}
            </li>
          ))}
      </ul>
      <p>
        A magyar túra- és látnivaló-oldalakról csak tényeket veszünk át (név, hely, kategória), és minden pontnál
        visszalinkelünk az eredeti oldalra. Leírás és fotó csak nyílt licencű forrásból származik.
      </p>
      <h3>Térkép és jogok</h3>
      <ul>
        <li>
          Látnivaló-adatbázis: ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>{' '}
          közreműködők (ODbL 1.0), Wikidata (CC0)
        </li>
        <li>Vármegyehatárok: {meta.boundaries}</li>
        <li>Alaptérkép: OpenTopoMap (CC BY-SA), OpenStreetMap; turistautak: Waymarked Trails (CC BY-SA)</li>
        <li>Műholdkép: Esri World Imagery (© Esri, Maxar, Earthstar Geographics, GIS User Community)</li>
        <li>
          Útvonaltervezés és a nyomvonalak ráillesztése: Valhalla és OSRM a FOSSGIS e.V. szerverein (openstreetmap.de),
          OpenStreetMap-adatokból. A tervezett útvonal és a saját túrák csak ezen a készüléken maradnak.
        </li>
        <li>
          Jelzett turistautak: © OpenStreetMap közreműködők (ODbL)
        </li>
        <li>
          360°-os képek: Google utcakép (Maps Embed API), Wikimedia Commons és Wikidata (a szerzők licencével),
          Mapillary (CC BY-SA 4.0); nézegetők: Pannellum, MapillaryJS (MIT)
        </li>
        <li>Ikonok: Maki (CC0); betűtípus: Noto Sans (SIL OFL)</li>
      </ul>
      <p className="hint">
        Barlangok, fokozottan védett területek: a látogatás sokszor csak engedéllyel vagy vezetéssel lehetséges.
        Indulás előtt nézd meg a nemzeti park oldalát!
      </p>
      <form method="dialog">
        <button className="btn" type="submit">
          Bezárás
        </button>
      </form>
    </dialog>
  )
}
