import { type ReactNode, useRef } from 'react'

export type SheetState = 'peek' | 'half' | 'full'

const ORDER: SheetState[] = ['peek', 'half', 'full']

/** Álló nézetben a panel magassága (a térkép a maradékot kapja, mindig legalább 40%-ot). */
export const SHEET_HEIGHT: Record<SheetState, string> = { peek: '120px', half: '45%', full: '60%' }
const MAX_FRACTION = 0.6
const MIN_PX = 90

function px(s: SheetState, total: number): number {
  return s === 'peek' ? 120 : s === 'half' ? total * 0.45 : total * MAX_FRACTION
}

/**
 * A panel: álló nézetben a térkép ALATT (húzható elválasztóval), oldalpanel-elrendezésben
 * (asztal, fekvő telefon) a térkép MELLETT. A térképet sosem takarja: az elrendezést a
 * `.main` rács adja (styles.css), a térkép mindig a maradék helyet kapja.
 */
export function Sheet({
  state,
  onState,
  onDrag,
  header,
  onHidePanel,
  children,
}: {
  state: SheetState
  onState: (s: SheetState) => void
  /** húzás közben a panel magassága px-ben (null: vége) */
  onDrag: (h: number | null) => void
  header: ReactNode
  onHidePanel: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const drag = useRef<{ y: number; h: number; total: number; last: number } | null>(null)

  const total = () => ref.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight

  const onPointerDown = (e: React.PointerEvent) => {
    const h = ref.current?.getBoundingClientRect().height ?? 120
    drag.current = { y: e.clientY, h, total: total(), last: h }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const h = Math.max(MIN_PX, Math.min(d.total * MAX_FRACTION, d.h + (d.y - e.clientY)))
    d.last = h
    onDrag(h)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    onDrag(null)
    if (Math.abs(e.clientY - d.y) < 6) {
      // koppintás: következő állás
      onState(ORDER[(ORDER.indexOf(state) + 1) % ORDER.length])
      return
    }
    const nearest = ORDER.reduce((best, s) =>
      Math.abs(px(s, d.total) - d.last) < Math.abs(px(best, d.total) - d.last) ? s : best,
    )
    onState(nearest)
  }

  return (
    <aside ref={ref} className={`sheet sheet-${state}`} data-testid="sheet" aria-label="Panel">
      <div
        className="sheet-handle"
        role="button"
        tabIndex={0}
        aria-label="Panel méretezése"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null
          onDrag(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onState(ORDER[(ORDER.indexOf(state) + 1) % ORDER.length])
        }}
      >
        <span />
      </div>
      {/* kártyanézetben nincs fejléc (a kártyának saját bezárása van) -> több hely a tartalomnak */}
      {header && (
        <div className="sheet-header">
          <div className="sheet-header-main">{header}</div>
          <button type="button" className="icon-btn panel-hide" onClick={onHidePanel} aria-label="Panel elrejtése" title="Panel elrejtése">
            «
          </button>
        </div>
      )}
      <div className="sheet-body">{children}</div>
    </aside>
  )
}
