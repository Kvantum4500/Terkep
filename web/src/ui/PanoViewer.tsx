import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MAPILLARY_TOKEN, type Pano } from '../pano/find'

/**
 * Teljes képernyős 360°-os nézegető (külön mód, „Bezárás” gombbal).
 * Commons-gömbpanorámához Pannellum, Mapillaryhez MapillaryJS – mindkettő lustán töltődik.
 */
export function PanoViewer({ panos, start, onClose }: { panos: Pano[]; start: number; onClose: () => void }) {
  const [k, setK] = useState(start)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const p = panos[k]

  useEffect(() => {
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    const el = box.current
    if (!el || !p) return
    let alive = true
    let viewer: { destroy: () => void } | null = null
    setError(null)
    el.replaceChildren()
    if (p.source === 'google') {
      // Google-utcakép: beágyazott oldal (a Google saját nézegetője és forrásmegjelölése)
      const f = document.createElement('iframe')
      f.src = p.url!
      f.title = p.title
      f.allowFullscreen = true
      f.referrerPolicy = 'strict-origin-when-cross-origin'
      f.setAttribute('data-testid', 'pano-iframe')
      el.appendChild(f)
      return () => {
        alive = false
        f.remove()
      }
    }
    const load =
      p.source === 'mapillary'
        ? import('../pano/mapillaryViewer').then((m) => m.openMapillary(el, p.id, MAPILLARY_TOKEN))
        : import('../pano/pannellumViewer').then((m) => m.openPannellum(el, p.url!, { vaov: p.vaov }))
    load
      .then((v) => {
        if (alive) viewer = v
        else v.destroy()
      })
      .catch(() => alive && setError('A nézegető nem tölthető be (nincs internet?).'))
    return () => {
      alive = false
      viewer?.destroy()
    }
  }, [p])

  if (!p) return null
  // portál: a panel saját rétegrendjéből kiemelve, a felső sáv fölé kerül
  return createPortal(
    <div className="pano-overlay" role="dialog" aria-modal="true" aria-labelledby="pano-title" data-testid="pano-viewer">
      <div className="pano-head">
        <div className="pano-title">
          <strong id="pano-title">{p.title}</strong>
          <span className="pano-credit">
            {p.source === 'google' ? 'Google' : p.source === 'mapillary' ? 'Mapillary' : 'Wikimedia Commons'}
            {p.kind === 'cylinder' ? ' · 360°-os körpanoráma' : ''}
            {p.author ? ` · ${p.author}` : ''}
            {p.license ? (
              <>
                {' · '}
                {p.licenseUrl ? (
                  <a href={p.licenseUrl} target="_blank" rel="noreferrer">
                    {p.license}
                  </a>
                ) : (
                  p.license
                )}
              </>
            ) : null}
            {p.pageUrl ? (
              <>
                {' · '}
                <a href={p.pageUrl} target="_blank" rel="noreferrer">
                  forrás
                </a>
              </>
            ) : null}
            {p.distM !== undefined ? ` · ${p.distM} m-re` : ''}
          </span>
        </div>
        <button ref={closeBtn} type="button" className="icon-btn pano-close" onClick={onClose} aria-label="Bezárás" data-testid="pano-close">
          ✕
        </button>
      </div>
      <div className="pano-box" ref={box} />
      {error && (
        <p className="pano-error" role="alert">
          {error}
        </p>
      )}
      {panos.length > 1 && (
        <div className="pano-strip" role="tablist" aria-label="Körképek">
          {panos.map((x, i) => (
            <button
              key={`${x.source}:${x.id}`}
              type="button"
              role="tab"
              aria-selected={i === k}
              className={i === k ? 'on' : ''}
              onClick={() => setK(i)}
              title={x.title}
            >
              {x.thumb ? <img src={x.thumb} alt="" loading="lazy" /> : <span>{x.source === 'google' ? 'Google' : i + 1}</span>}
              {x.distM !== undefined && <small>{x.distM} m</small>}
            </button>
          ))}
        </div>
      )}
      <p className="pano-hint">Húzd az ujjad (vagy az egeret) a körbeforduláshoz.</p>
    </div>,
    document.body,
  )
}
