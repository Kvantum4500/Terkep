import { useMemo } from 'react'
import type { Tier } from '../data/types'
import { isDefault, toggle } from '../filters/filter'
import { compareHu, formatCount } from '../filters/text'
import { useStore } from '../state/store'
import { CategoryIcon } from './CategoryIcon'

const TIERS: { t: Tier; label: string; hint: string }[] = [
  { t: 1, label: 'Kiemelt', hint: 'országos jelentőségű' },
  { t: 2, label: 'Érdekes', hint: 'környékbeli kirándulócél' },
  { t: 3, label: 'Helyi', hint: 'minden egyéb' },
]

export function FilterPanel() {
  const data = useStore((s) => s.data)!
  const filters = useStore((s) => s.filters)
  const result = useStore((s) => s.result)!
  const setFilters = useStore((s) => s.setFilters)
  const resetFilters = useStore((s) => s.resetFilters)
  const { meta } = data

  const groups = useMemo(() => {
    const byGroup = new Map<string, string[]>()
    for (const [key, c] of Object.entries(meta.categories)) {
      byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), key])
    }
    return Object.entries(meta.groups)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([g, info]) => ({ key: g, label: info.label, cats: byGroup.get(g) ?? [] }))
  }, [meta])

  const counties = useMemo(
    () =>
      Object.entries(meta.counties).sort((a, b) =>
        a[0] === 'BU' ? -1 : b[0] === 'BU' ? 1 : compareHu(a[1].short, b[1].short),
      ),
    [meta],
  )

  return (
    <div className="filters" data-testid="filters">
      <div className="filters-head">
        <div className="result-count" data-testid="result-count" aria-live="polite">
          <strong>{formatCount(result.indices.length)}</strong> látnivaló
        </div>
        {!isDefault(filters) && (
          <button type="button" className="link-btn" onClick={resetFilters}>
            Szűrők törlése
          </button>
        )}
      </div>

      <label className="search">
        <span className="visually-hidden">Keresés</span>
        <input
          type="search"
          placeholder="Keresés név vagy település szerint…"
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value })}
          data-testid="search"
        />
      </label>

      <section className="filter-section">
        <h3>Kategória</h3>
        {groups.map((g) => (
          <div key={g.key} className="cat-group">
            <div className="cat-group-label">{g.label}</div>
            <div className="chips">
              {g.cats.map((key) => {
                const c = meta.categories[key]
                const on = filters.cats.includes(key)
                const n = result.catCounts[key] ?? 0
                return (
                  <button
                    key={key}
                    type="button"
                    className={`chip${on ? ' on' : ''}${n === 0 && !on ? ' empty' : ''}`}
                    aria-pressed={on}
                    data-testid={`cat-${key}`}
                    onClick={() => setFilters({ cats: toggle(filters.cats, key) })}
                  >
                    <CategoryIcon cat={c} size={18} />
                    <span>{c.label}</span>
                    <span className="chip-count">{formatCount(n)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="filter-section">
        <h3>Vármegye</h3>
        <div className="county-grid">
          {counties.map(([code, c]) => {
            const on = filters.counties.includes(code)
            const n = result.countyCounts[code] ?? 0
            return (
              <label key={code} className={`county${on ? ' on' : ''}`} data-testid={`county-${code}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setFilters({ counties: toggle(filters.counties, code) })}
                />
                <span className="county-name">{c.short}</span>
                <span className="county-count">{formatCount(n)}</span>
              </label>
            )
          })}
        </div>
      </section>

      <section className="filter-section">
        <h3>Fontosság</h3>
        <div className="chips">
          {TIERS.map(({ t, label, hint }) => {
            const on = filters.tiers.includes(t)
            return (
              <button
                key={t}
                type="button"
                className={`chip tier tier-${t}${on ? ' on' : ''}`}
                aria-pressed={on}
                title={hint}
                data-testid={`tier-${t}`}
                onClick={() => setFilters({ tiers: toggle(filters.tiers, t) })}
              >
                <span>{label}</span>
                <span className="chip-count">{formatCount(result.tierCounts[t])}</span>
              </button>
            )
          })}
        </div>
        {filters.tiers.length === 0 && <p className="hint">Nincs szint kiválasztva – mindet mutatom.</p>}
      </section>

      <section className="filter-section">
        <h3>Csak…</h3>
        <div className="toggles">
          <Toggle label="látogatható barlangok" on={filters.showcave} onChange={(v) => setFilters({ showcave: v })} />
          <Toggle label="Kéktúra-pecsételőhelyek" on={filters.kektura} onChange={(v) => setFilters({ kektura: v })} />
          <Toggle label="műemlékek, védett helyek" on={filters.heritage} onChange={(v) => setFilters({ heritage: v })} />
        </div>
      </section>

    </div>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
