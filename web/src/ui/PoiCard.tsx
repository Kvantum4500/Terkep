import { useEffect, useState } from 'react'
import { settlementOf } from '../data/decode'
import { loadCountyDetails } from '../data/load'
import { FLAG, type PoiDetail } from '../data/types'
import { googleStreetViewUrl } from '../pano/find'
import { poiWaypoint, routeTo } from '../state/actions'
import { useStore } from '../state/store'
import { CategoryIcon } from './CategoryIcon'
import { commonsPage, commonsThumb, geoUri, googleMapsUrl, osmMapUrl, sourceUrl } from './links'
import { PanoSection } from './PanoSection'

const TIER_LABEL = { 1: 'Kiemelt', 2: 'Érdekes', 3: 'Helyi' } as const

export function PoiCard({ id, onClose }: { id: string; onClose: () => void }) {
  const data = useStore((s) => s.data)!
  const { index, meta } = data
  const i = index.byId.get(id)
  const [detail, setDetail] = useState<PoiDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const county = i !== undefined ? index.counties[index.county[i]] : null

  useEffect(() => {
    if (!county) return
    let alive = true
    setDetail(null)
    setFailed(false)
    loadCountyDetails(county)
      .then((d) => alive && setDetail(d[id] ?? null))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [id, county])

  if (i === undefined || !county) {
    return (
      <article className="card">
        <p>Ez a látnivaló nem található (lehet, hogy az adatfrissítés óta megváltozott).</p>
        <button type="button" className="btn" onClick={onClose}>
          Bezárás
        </button>
      </article>
    )
  }

  const cat = meta.categories[index.cats[index.cat[i]]]
  const flags = index.flags[i]
  const lat = index.lat[i]
  const lon = index.lon[i]
  const name = index.name[i]
  const settlement = settlementOf(index, i)
  const tier = index.tier[i] as 1 | 2 | 3

  return (
    <article className="card" data-testid="poi-card" aria-labelledby="poi-title">
      <header className="card-head">
        <CategoryIcon cat={cat} size={34} />
        <div className="card-title">
          <h2 id="poi-title">{name}</h2>
          <div className="card-sub">
            {detail?.sub ? `${cat.label} – ${detail.sub}` : cat.label}
            <br />
            {settlement ? `${settlement}, ` : ''}
            {meta.counties[county].name}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Bezárás">
          ✕
        </button>
      </header>

      <div className="badges">
        <span className={`badge tier-${tier}`}>{TIER_LABEL[tier]}</span>
        {flags & FLAG.heritage ? <span className="badge">Műemlék / védett</span> : null}
        {flags & FLAG.showcave ? <span className="badge warn">Látogatható barlang – általában csak vezetéssel</span> : null}
        {flags & FLAG.kektura ? <span className="badge blue">Kéktúra-pecsételőhely</span> : null}
        {flags & FLAG.ruin ? <span className="badge">Rom</span> : null}
        {flags & FLAG.sample ? <span className="badge muted">Mintaadat – közelítő hely</span> : null}
        {flags & FLAG.approx && !(flags & FLAG.sample) ? <span className="badge muted">Közelítő hely</span> : null}
      </div>

      {detail?.img?.license && (
        <figure className="photo">
          <img src={commonsThumb(detail.img.file)} alt={name} loading="lazy" />
          <figcaption>
            Fotó: {detail.img.artist ?? 'ismeretlen'},{' '}
            {detail.img.license_url ? (
              <a href={detail.img.license_url} target="_blank" rel="noreferrer">
                {detail.img.license}
              </a>
            ) : (
              detail.img.license
            )}{' '}
            –{' '}
            <a href={commonsPage(detail.img.file)} target="_blank" rel="noreferrer">
              Wikimedia Commons
            </a>
          </figcaption>
        </figure>
      )}

      {detail?.desc && <p className="desc">{detail.desc}</p>}

      <dl className="facts">
        {detail?.ele !== undefined && (
          <>
            <dt>Magasság</dt>
            <dd>{Math.round(detail.ele)} m</dd>
          </>
        )}
        <dt>Koordináta</dt>
        <dd>
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </dd>
        {detail?.alt?.length ? (
          <>
            <dt>Más néven</dt>
            <dd>{detail.alt.join(', ')}</dd>
          </>
        ) : null}
      </dl>

      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            const w = poiWaypoint(id)
            if (w) routeTo(w, 'end')
          }}
          data-testid="route-to"
        >
          Útvonal ide
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            const w = poiWaypoint(id)
            if (w) routeTo(w, 'via')
          }}
          data-testid="route-via"
        >
          Útba ejtem
        </button>
      </div>

      <PanoSection key={id} lat={lat} lon={lon} auto={tier === 1} />

      <div className="ext-links">
        <span className="hint">Megnyitás másik appban:</span>
        <a href={geoUri(lat, lon, name)}>Navigáció</a>
        <a href={googleStreetViewUrl(lat, lon)} target="_blank" rel="noreferrer" data-testid="gsv-link">
          Google utcakép
        </a>
        <a href={googleMapsUrl(lat, lon)} target="_blank" rel="noreferrer">
          Google Térkép
        </a>
        <a href={osmMapUrl(lat, lon)} target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
      </div>

      <section className="sources" data-testid="sources">
        <h3>Források</h3>
        {failed && <p className="hint">A részletek nem tölthetők be (offline?).</p>}
        {!detail && !failed && <p className="hint">Betöltés…</p>}
        {detail && detail.sources.length === 0 && (
          <p className="hint">Kézi mintaadat – a valós források az első adatfrissítés után jelennek meg.</p>
        )}
        {detail && detail.sources.length > 0 && (
          <ul>
            {detail.sources.map((s) => {
              const url = sourceUrl(meta, s.s, s.ref)
              const label = meta.sources[s.s]?.label ?? s.s
              return (
                <li key={`${s.s}:${s.ref}`}>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                </li>
              )
            })}
            {detail.huwiki && !detail.sources.some((s) => s.s === 'huwiki') && (
              <li>
                <a href={sourceUrl(meta, 'huwiki', detail.huwiki) ?? '#'} target="_blank" rel="noreferrer">
                  Magyar Wikipédia
                </a>
              </li>
            )}
          </ul>
        )}
      </section>
    </article>
  )
}
