import { useEffect, useMemo, useRef, useState } from 'react'
import { settlementOf } from '../data/decode'
import { FLAG } from '../data/types'
import { compareHu, formatCount } from '../filters/text'
import { useStore } from '../state/store'
import { CategoryIcon } from './CategoryIcon'

const ROW = 58

type Sort = 'score' | 'name'

/** Virtualizált lista: csak a látható sorokat rajzolja (több tízezer találatnál is gyors). */
export function ResultList({ onPick }: { onPick: (id: string) => void }) {
  const data = useStore((s) => s.data)!
  const result = useStore((s) => s.result)!
  const selected = useStore((s) => s.selected)
  const [sort, setSort] = useState<Sort>('score')
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)
  const ref = useRef<HTMLDivElement>(null)
  const { index, meta } = data

  const order = useMemo(() => {
    if (sort === 'score') return result.indices
    return Uint32Array.from(result.indices).sort((a, b) => compareHu(index.name[a], index.name[b]))
  }, [result.indices, sort, index])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 })
    setScrollTop(0)
  }, [result.indices])

  const first = Math.max(0, Math.floor(scrollTop / ROW) - 5)
  const last = Math.min(order.length, Math.ceil((scrollTop + height) / ROW) + 5)
  const rows = []
  for (let k = first; k < last; k++) {
    const i = order[k]
    const id = index.id[i]
    const cat = meta.categories[index.cats[index.cat[i]]]
    const county = meta.counties[index.counties[index.county[i]]]
    const settlement = settlementOf(index, i)
    rows.push(
      <li
        key={id}
        className={`result${selected === id ? ' sel' : ''}`}
        style={{ top: k * ROW, height: ROW }}
        data-testid="result-row"
        data-id={id}
      >
        <button type="button" onClick={() => onPick(id)}>
          <CategoryIcon cat={cat} />
          <span className="result-text">
            <span className="result-name">{index.name[i]}</span>
            <span className="result-sub">
              {cat.label} · {settlement ? `${settlement}, ` : ''}
              {county.short}
            </span>
          </span>
          {index.flags[i] & (FLAG.streetview | FLAG.pano) ? (
            <span className="badge tag360" title="360°-os kép">
              360°
            </span>
          ) : null}
          {index.tier[i] === 1 && (
            <span className="badge star" title="Kiemelt">
              ★
            </span>
          )}
        </button>
      </li>,
    )
  }

  return (
    <div className="results">
      <div className="results-head">
        <span>{formatCount(order.length)} találat</span>
        <label>
          Rendezés:{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="score">fontosság</option>
            <option value="name">név (A–Z)</option>
          </select>
        </label>
      </div>
      <div className="results-scroll" ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {order.length === 0 ? (
          <p className="empty-state">Nincs a szűrőknek megfelelő látnivaló. Próbálj kevesebb szűrőt!</p>
        ) : (
          <ul style={{ height: order.length * ROW }}>{rows}</ul>
        )}
      </div>
    </div>
  )
}
