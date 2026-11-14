import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

export type SheetState = 'peek' | 'half' | 'full'

const ORDER: SheetState[] = ['peek', 'half', 'full']

/**
 * Mobilon alsó, húzható panel (3 állás), asztali nézetben (>= 900 px) oldalpanel.
 * A húzást a fogantyún kezeljük, így a panel tartalma szabadon görgethető.
 */
export function Sheet({
  state,
  onState,
  header,
  children,
}: {
  state: SheetState
  onState: (s: SheetState) => void
  header: ReactNode
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const drag = useRef<{ y: number; h: number } | null>(null)
  const [dragH, setDragH] = useState<number | null>(null)

  const heightFor = useCallback((s: SheetState) => {
    const vh = window.innerHeight
    return s === 'peek' ? 132 : s === 'half' ? Math.round(vh * 0.5) : Math.round(vh * 0.92)
  }, [])

  useEffect(() => {
    const onResize = () => setDragH(null)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: ref.current?.getBoundingClientRect().height ?? heightFor(state) }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const h = Math.max(90, Math.min(window.innerHeight * 0.95, drag.current.h + (drag.current.y - e.clientY)))
    setDragH(h)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return
    const moved = Math.abs(e.clientY - drag.current.y)
    const h = dragH ?? drag.current.h
    drag.current = null
    setDragH(null)
    if (moved < 6) {
      // koppintás: következő állás
      onState(ORDER[(ORDER.indexOf(state) + 1) % ORDER.length])
      return
    }
    const nearest = ORDER.reduce((best, s) =>
      Math.abs(heightFor(s) - h) < Math.abs(heightFor(best) - h) ? s : best,
    )
    onState(nearest)
  }

  return (
    <aside
      ref={ref}
      className={`sheet sheet-${state}${dragH !== null ? ' dragging' : ''}`}
      style={dragH !== null ? { height: dragH } : undefined}
      data-testid="sheet"
    >
      <div
        className="sheet-handle"
        role="button"
        tabIndex={0}
        aria-label="Panel méretezése"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onState(ORDER[(ORDER.indexOf(state) + 1) % ORDER.length])
        }}
      >
        <span />
      </div>
      <div className="sheet-header">{header}</div>
      <div className="sheet-body">{children}</div>
    </aside>
  )
}
