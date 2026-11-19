import { useEffect, useState } from 'react'
import { closeTrail, openTrail } from '../state/actions'
import { COLOR_LABEL, loadTrailIndex, NETWORK_LABEL, SHAPE_LABEL, type TrailIndex } from '../trails/data'
import { MarkIcon } from './MarkIcon'

/** A kiválasztott turistaút adatai: jelzés, hossz, szakaszok (és később a teljesítés). */
export function TrailCard({ id, onFit }: { id: string; onFit: () => void }) {
  const [idx, setIdx] = useState<TrailIndex | null>(null)
  useEffect(() => {
    let alive = true
    void loadTrailIndex().then((i) => alive && setIdx(i))
    return () => {
      alive = false
    }
  }, [])
  const t = idx?.byId.get(id)
  if (!idx) return <p className="hint">Betöltés…</p>
  if (!t) {
    return (
      <article className="card">
        <p>Ez a turistaút nem található.</p>
        <button type="button" className="btn" onClick={closeTrail}>
          Bezárás
        </button>
      </article>
    )
  }
  const parent = t.p ? idx.byId.get(t.p) : undefined
  const children = (t.ch ?? []).map((c) => idx.byId.get(c)).filter((x) => x !== undefined)
  return (
    <article className="card trail-card" data-testid="trail-card" aria-labelledby="trail-title">
      <header className="card-head">
        <MarkIcon c={t.c} s={t.s} size={34} />
        <div className="card-title">
          <h2 id="trail-title">{t.n}</h2>
          <div className="card-sub">
            {COLOR_LABEL[t.c]} {SHAPE_LABEL[t.s]} jelzés · {t.km.toLocaleString('hu-HU')} km
            {NETWORK_LABEL[t.net] ? ` · ${NETWORK_LABEL[t.net]} túraútvonal` : ''}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={closeTrail} aria-label="Bezárás">
          ✕
        </button>
      </header>
      <div className="actions">
        <button type="button" className="btn secondary" onClick={onFit}>
          Ráközelítés
        </button>
      </div>
      {parent && (
        <p>
          Része ennek:{' '}
          <button type="button" className="link-btn" onClick={() => openTrail(parent.id)}>
            {parent.n}
          </button>
        </p>
      )}
      {children.length > 0 && (
        <section className="along">
          <h3>Szakaszok ({children.length})</h3>
          <ul>
            {children.map((c) => (
              <li key={c.id}>
                <button type="button" className="along-name" onClick={() => openTrail(c.id)}>
                  <MarkIcon c={c.c} s={c.s} />
                  <span>
                    <span className="result-name">{c.n}</span>
                    <span className="result-sub">{c.km.toLocaleString('hu-HU')} km</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="hint credit">Turistautak: © OpenStreetMap közreműködők (ODbL)</p>
    </article>
  )
}
