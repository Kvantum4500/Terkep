import { COLOR_HEX, COLOR_LABEL, type MarkColor, type MarkShape, SHAPE_LABEL } from '../trails/data'

/** Magyar turistajelzés kicsiben: fehér alapon a színes jel (sáv, kereszt, háromszög…). */
export function MarkIcon({ c, s, size = 22 }: { c: MarkColor; s: MarkShape; size?: number }) {
  const col = COLOR_HEX[c]
  const label = `${COLOR_LABEL[c]} ${SHAPE_LABEL[s]}`
  return (
    <svg
      className="mark-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      data-mark={`${c}-${s}`}
    >
      <title>{label}</title>
      <rect x="1" y="1" width="22" height="22" rx="3" fill="#fff" stroke="#9ca3af" strokeWidth="1" />
      {s === 'sav' && <rect x="2" y="8.5" width="20" height="7" fill={col} />}
      {s === 'kereszt' && (
        <>
          <rect x="9.5" y="4" width="5" height="16" fill={col} />
          <rect x="4" y="9.5" width="16" height="5" fill={col} />
        </>
      )}
      {s === 'haromszog' && <path d="M12 4 L20.5 19 L3.5 19 Z" fill={col} />}
      {s === 'negyzet' && <rect x="5.5" y="5.5" width="13" height="13" fill={col} />}
      {s === 'kor' && <circle cx="12" cy="12" r="6.8" fill={col} />}
      {s === 'barlang' && <path d="M5 19 V11 a7 7 0 0 1 14 0 V19 h-4 v-7 a3 3 0 0 0 -6 0 v7 Z" fill={col} />}
      {s === 'rom' && <path d="M6 4 h5 v11 h7 v5 H6 Z" fill={col} />}
      {s === 'egyeb' && (
        <text x="12" y="17" textAnchor="middle" fontSize="13" fontWeight="700" fill={col}>
          ?
        </text>
      )}
    </svg>
  )
}
