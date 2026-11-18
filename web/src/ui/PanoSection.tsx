import { useCallback, useEffect, useState } from 'react'
import { findPanos, MAPILLARY_TOKEN, type Pano } from '../pano/find'
import { PanoViewer } from './PanoViewer'

type Status = 'idle' | 'loading' | 'found' | 'none' | 'error' | 'offline'

/**
 * 360°-os körkép a hely közelében (Commons-gömbpanoráma, Mapillary-utcakép).
 * Kiemelt helynél a kártya megnyitásakor magától keres, máshol gombnyomásra.
 */
export function PanoSection({ lat, lon, auto }: { lat: number; lon: number; auto: boolean }) {
  const [status, setStatus] = useState<Status>('idle')
  const [panos, setPanos] = useState<Pano[]>([])
  const [open, setOpen] = useState<number | null>(null)

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
        setPanos(p)
        setStatus(p.length ? 'found' : 'none')
      })
      .catch(() => alive && setStatus('error'))
    return () => {
      alive = false
    }
  }, [lat, lon])

  useEffect(() => (auto ? search() : undefined), [auto, search])

  const close = useCallback(() => setOpen(null), [])

  return (
    <section className="pano" data-testid="pano">
      <h3>360°-os körkép</h3>
      {status === 'idle' && (
        <button type="button" className="btn secondary" onClick={() => search()} data-testid="pano-search">
          Körkép keresése a közelben
        </button>
      )}
      {status === 'loading' && (
        <p className="route-status" role="status">
          <span className="spinner small" /> Körképek keresése…
        </p>
      )}
      {status === 'found' && (
        <button type="button" className="btn" onClick={() => setOpen(0)} data-testid="pano-open">
          360° nézet megnyitása{panos.length > 1 ? ` (${panos.length})` : ''}
        </button>
      )}
      {status === 'none' && (
        <p className="hint">
          A közelben nincs nyílt 360°-os felvétel{MAPILLARY_TOKEN ? '' : ' a Wikimedia Commonson'}. Próbáld a Google
          utcaképet (lent).
        </p>
      )}
      {status === 'error' && <p className="hint">A körképek most nem tölthetők be.</p>}
      {status === 'offline' && <p className="hint">A körképekhez internetkapcsolat kell.</p>}
      {open !== null && <PanoViewer panos={panos} start={open} onClose={close} />}
    </section>
  )
}
