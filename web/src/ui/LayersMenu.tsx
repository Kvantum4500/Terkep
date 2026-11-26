import { useEffect, useRef, useState } from 'react'
import { type Basemap, useStore } from '../state/store'

const BASEMAPS: { b: Basemap; label: string }[] = [
  { b: 'topo', label: 'Turistatérkép' },
  { b: 'osm', label: 'Utcatérkép' },
  { b: 'sat', label: 'Műhold' },
  { b: 'none', label: 'Alaptérkép nélkül' },
]

export function LayersMenu() {
  const basemap = useStore((s) => s.basemap)
  const trails = useStore((s) => s.trails)
  const compat = useStore((s) => s.compatMap)
  const { setBasemap, setTrails, setCompatMap } = useStore.getState()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = BASEMAPS.find((x) => x.b === basemap)?.label ?? ''

  return (
    <div className="layers" ref={ref}>
      <button
        type="button"
        className="layers-btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="layers-btn"
        title="Alaptérkép és rétegek"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M12 3 2 8l10 5 10-5-10-5Zm-7.6 9L2 13.2 12 18l10-4.8-2.4-1.2L12 15.6 4.4 12Zm0 4L2 17.2 12 22l10-4.8-2.4-1.2L12 19.6 4.4 16Z"
            fill="currentColor"
          />
        </svg>
        <span className="layers-label">{current}</span>
      </button>
      {open && (
        <div className="layers-pop" data-testid="layers-menu">
          <fieldset>
            <legend>Alaptérkép</legend>
            {BASEMAPS.map(({ b, label }) => (
              <label key={b} className="toggle">
                <input
                  type="radio"
                  name="basemap"
                  checked={basemap === b}
                  onChange={() => setBasemap(b)}
                  data-testid={`basemap-${b}`}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Rétegek</legend>
            <label className="toggle">
              <input type="checkbox" checked={trails} disabled={basemap === 'none'} onChange={(e) => setTrails(e.target.checked)} />
              <span>Jelzett turistautak</span>
            </label>
          </fieldset>
          <fieldset>
            <legend>Megjelenítés</legend>
            <label className="toggle">
              <input
                type="checkbox"
                checked={compat}
                onChange={(e) => setCompatMap(e.target.checked)}
                data-testid="compat-map"
              />
              <span>Kompatibilis mód (ha a térkép vibrál)</span>
            </label>
          </fieldset>
        </div>
      )}
    </div>
  )
}
