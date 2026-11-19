import { useEffect, useMemo, useState } from 'react'
import { openTrail } from '../state/actions'
import { useStore } from '../state/store'
import {
  COLOR_LABEL,
  MARK_COLORS,
  MARK_SHAPES,
  type MarkColor,
  type MarkShape,
  NETWORK_LABEL,
  SHAPE_LABEL,
  searchTrails,
  type TrailIndex,
  loadTrailIndex,
} from '../trails/data'
import { MarkIcon } from './MarkIcon'

/** Szűrő: csak a kiválasztott jelzésű turistautak a térképen (pl. kék sáv, sárga kereszt), és keresés név szerint. */
export function TrailFilter() {
  const filter = useStore((s) => s.trailFilter)
  const setTrailFilter = useStore((s) => s.setTrailFilter)
  const [idx, setIdx] = useState<TrailIndex | null | undefined>(undefined)
  const q = useStore((s) => s.trailQuery)
  const setQ = useStore((s) => s.setTrailQuery)

  useEffect(() => {
    let alive = true
    void loadTrailIndex().then((i) => alive && setIdx(i))
    return () => {
      alive = false
    }
  }, [])

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const t of idx?.trails ?? []) {
      if (t.p) continue // a szakaszokat a szülőnél számoljuk
      c.set(t.c, (c.get(t.c) ?? 0) + 1)
      c.set(`${t.c}-${t.s}`, (c.get(`${t.c}-${t.s}`) ?? 0) + 1)
    }
    return c
  }, [idx])

  const hits = useMemo(() => (idx ? searchTrails(idx, q) : []), [idx, q])

  if (idx === undefined) return null
  if (idx === null) {
    return (
      <section className="filter-section" data-testid="trail-filter">
        <h3>Jelzett turistautak</h3>
        <p className="hint">A turistaút-adat a következő adatfrissítéssel érkezik.</p>
      </section>
    )
  }

  const toggleColor = (c: MarkColor) =>
    setTrailFilter({ colors: filter.colors.includes(c) ? filter.colors.filter((x) => x !== c) : [...filter.colors, c] })
  const toggleShape = (s: MarkShape) =>
    setTrailFilter({ shapes: filter.shapes.includes(s) ? filter.shapes.filter((x) => x !== s) : [...filter.shapes, s] })

  return (
    <section className="filter-section" data-testid="trail-filter">
      <h3>Jelzett turistautak</h3>
      <div className="cat-group-label">Szín</div>
      <div className="chips">
        {MARK_COLORS.filter((c) => counts.get(c)).map((c) => (
          <button
            key={c}
            type="button"
            className={`chip${filter.colors.includes(c) ? ' on' : ''}`}
            aria-pressed={filter.colors.includes(c)}
            onClick={() => toggleColor(c)}
            data-testid={`trail-color-${c}`}
          >
            <MarkIcon c={c} s="sav" size={18} />
            <span>{COLOR_LABEL[c]}</span>
          </button>
        ))}
      </div>
      {filter.colors.length > 0 && (
        <>
          <div className="cat-group-label">Jel (ha egyik sincs kijelölve: mind)</div>
          <div className="chips">
            {MARK_SHAPES.filter((s) => filter.colors.some((c) => counts.get(`${c}-${s}`))).map((s) => (
              <button
                key={s}
                type="button"
                className={`chip${filter.shapes.includes(s) ? ' on' : ''}`}
                aria-pressed={filter.shapes.includes(s)}
                onClick={() => toggleShape(s)}
                data-testid={`trail-shape-${s}`}
              >
                <MarkIcon c={filter.colors[0]} s={s} size={18} />
                <span>{SHAPE_LABEL[s]}</span>
              </button>
            ))}
          </div>
          <button type="button" className="link-btn" onClick={() => setTrailFilter({ colors: [], shapes: [] })}>
            Turistautak elrejtése
          </button>
        </>
      )}
      <label className="search trail-search">
        <span className="visually-hidden">Turistaút keresése</span>
        <input
          type="search"
          placeholder="Turistaút keresése (pl. Kéktúra)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="trail-search"
        />
      </label>
      {hits.length > 0 && (
        <ul className="trail-hits">
          {hits.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => openTrail(t.id)} data-testid="trail-hit">
                <MarkIcon c={t.c} s={t.s} />
                <span className="result-text">
                  <span className="result-name">{t.n}</span>
                  <span className="result-sub">
                    {t.km.toLocaleString('hu-HU')} km{NETWORK_LABEL[t.net] ? ` · ${NETWORK_LABEL[t.net]}` : ''}
                    {t.ch?.length ? ` · ${t.ch.length} szakasz` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
