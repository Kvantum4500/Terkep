import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PoiDetail } from '../data/types'
import {
  commonsFilePano,
  findPanos,
  GOOGLE_EMBED_KEY,
  googlePano,
  googleSearchPano,
  googleStreetViewUrl,
  MAPILLARY_TOKEN,
  type Pano,
} from '../pano/find'
import { PanoViewer } from './PanoViewer'

type Status = 'idle' | 'loading' | 'done' | 'error' | 'offline'

/**
 * 360°-os nézetek a hely közelében, ebben a sorrendben:
 *  1. Google-utcakép, ha a pipeline talált felvételt (details.sv) és van böngészőkulcs;
 *  2. Wikidata-gömbkép (details.pano);
 *  3. Commons-gömb- és körpanorámák, Mapillary-utcaképek (keresés: kiemelt helynél
 *     magától, máshol gombnyomásra).
 * Ha a Google-ről nincs előzetes adat, de van kulcs, a „Utcakép keresése” a legközelebbi
 * Google-felvételt nyitja meg.
 */
export function PanoSection({
  lat,
  lon,
  auto,
  detail,
}: {
  lat: number
  lon: number
  auto: boolean
  detail: PoiDetail | null
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [found, setFound] = useState<Pano[]>([])
  const [wd, setWd] = useState<Pano | null>(null)
  const [open, setOpen] = useState<{ list: Pano[]; start: number } | null>(null)

  const google = useMemo(() => (detail?.sv ? googlePano(detail.sv, lat, lon) : null), [detail?.sv, lat, lon])

  // a Wikidata-gömbkép szerzője, licence és címe (egy lekérdezés)
  useEffect(() => {
    setWd(null)
    if (!detail?.pano || !navigator.onLine) return
    let alive = true
    commonsFilePano(detail.pano)
      .then((p) => alive && setWd(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [detail?.pano])

  const search = useCallback(() => {
    if (!navigator.onLine) {
      setStatus('offline')
      return () => {}
    }
    let alive = true
    setStatus('loading')
    findPanos(lat, lon)
      .then((p) => {
        if (!alive) return
        setFound(p)
        setStatus('done')
      })
      .catch(() => alive && setStatus('error'))
    return () => {
      alive = false
    }
  }, [lat, lon])

  useEffect(() => (auto ? search() : undefined), [auto, search])

  const all = useMemo(() => {
    const list: Pano[] = []
    if (google) list.push(google)
    if (wd) list.push(wd)
    for (const p of found) if (!list.some((x) => x.id === p.id)) list.push(p)
    return list
  }, [google, wd, found])

  const close = useCallback(() => setOpen(null), [])
  const searchGoogle = GOOGLE_EMBED_KEY && !google ? googleSearchPano(lat, lon) : null
  const openOthers = all.filter((p) => p.source !== 'google')

  return (
    <section className="pano" data-testid="pano">
      <h3>360°-os kép</h3>
      <div className="actions">
        {google && (
          <button type="button" className="btn" onClick={() => setOpen({ list: all, start: 0 })} data-testid="sv-open">
            Utcakép (360°)
          </button>
        )}
        {openOthers.length > 0 && (
          <button
            type="button"
            className={google ? 'btn secondary' : 'btn'}
            onClick={() => setOpen({ list: all, start: all.indexOf(openOthers[0]) })}
            data-testid="pano-open"
          >
            {google ? 'Körképek' : '360° nézet megnyitása'}
            {openOthers.length > 1 ? ` (${openOthers.length})` : ''}
          </button>
        )}
        {searchGoogle && (
          <button
            type="button"
            className="btn secondary"
            onClick={() => setOpen({ list: [searchGoogle, ...all], start: 0 })}
            data-testid="sv-search"
          >
            Utcakép keresése
          </button>
        )}
        {!searchGoogle && !google && !GOOGLE_EMBED_KEY && (
          <a className="btn secondary" href={googleStreetViewUrl(lat, lon)} target="_blank" rel="noreferrer">
            Google utcakép (külső app)
          </a>
        )}
      </div>
      {status === 'idle' && (
        <button type="button" className="link-btn" onClick={() => search()} data-testid="pano-search">
          Nyílt körképek keresése a közelben
        </button>
      )}
      {status === 'loading' && (
        <p className="route-status" role="status">
          <span className="spinner small" /> Körképek keresése…
        </p>
      )}
      {status === 'done' && all.length === 0 && (
        <p className="hint">
          A közelben nincs nyílt 360°-os felvétel{MAPILLARY_TOKEN ? '' : ' a Wikimedia Commonson'}
          {GOOGLE_EMBED_KEY ? '; próbáld az „Utcakép keresése” gombot.' : '; próbáld a Google utcaképet.'}
        </p>
      )}
      {status === 'error' && <p className="hint">A nyílt körképek most nem tölthetők be.</p>}
      {status === 'offline' && <p className="hint">A körképekhez internetkapcsolat kell.</p>}
      {open && <PanoViewer panos={open.list} start={open.start} onClose={close} />}
    </section>
  )
}
