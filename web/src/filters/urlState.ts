// A szűrők és a kiválasztott pont a URL hash-ében élnek, így a link megosztható
// és újratöltés után is megmarad. Példa: #m=PE,BU&k=templom&s=1,2&q=bazilika&p=Q123

import type { Tier } from '../data/types'
import { DEFAULT_FILTERS, type FilterState } from './filter'

export interface UrlState {
  filters: FilterState
  selected: string | null
}

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : [])

export function parseHash(hash: string, validCounties: string[], validCats: string[]): UrlState {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const counties = list(params.get('m')).filter((c) => validCounties.includes(c))
  const cats = list(params.get('k')).filter((c) => validCats.includes(c))
  const tiersRaw = params.get('s')
  const tiers =
    tiersRaw === null
      ? DEFAULT_FILTERS.tiers
      : (list(tiersRaw)
          .map(Number)
          .filter((t) => t === 1 || t === 2 || t === 3) as Tier[])
  const flags = list(params.get('j'))
  return {
    filters: {
      counties,
      cats,
      tiers,
      q: params.get('q') ?? '',
      showcave: flags.includes('barlang'),
      kektura: flags.includes('kektura'),
      heritage: flags.includes('muemlek'),
      pano: flags.includes('360'),
    },
    selected: params.get('p'),
  }
}

export function toHash(state: UrlState): string {
  const p = new URLSearchParams()
  const f = state.filters
  if (f.counties.length) p.set('m', [...f.counties].sort().join(','))
  if (f.cats.length) p.set('k', [...f.cats].sort().join(','))
  const tiers = [...f.tiers].sort()
  if (tiers.join(',') !== DEFAULT_FILTERS.tiers.join(',')) p.set('s', tiers.join(','))
  if (f.q.trim()) p.set('q', f.q.trim())
  const flags = [f.showcave && 'barlang', f.kektura && 'kektura', f.heritage && 'muemlek', f.pano && '360'].filter(
    Boolean,
  )
  if (flags.length) p.set('j', flags.join(','))
  if (state.selected) p.set('p', state.selected)
  const s = p.toString().replace(/%2C/g, ',')
  return s ? `#${s}` : ''
}
