import { iconSvg } from '../map/icons'
import type { CategoryMeta } from '../data/types'

export function CategoryIcon({ cat, size = 22 }: { cat: CategoryMeta; size?: number }) {
  const svg = iconSvg(cat.icon) ?? ''
  return (
    <span
      className="cat-icon"
      aria-hidden="true"
      style={{ background: cat.color, width: size, height: size }}
      // saját, a repóban lévő SVG-k (Maki, CC0 és saját rajz) – nem külső tartalom
      dangerouslySetInnerHTML={{ __html: svg.replace(/<\?xml[^>]*>/, '').replace('<svg ', '<svg fill="#fff" ') }}
    />
  )
}
