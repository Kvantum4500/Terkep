import { fold } from '../filters/text'
import type { PoiIndex, RawIndex } from './types'

export function decodeIndex(raw: RawIndex): PoiIndex {
  if (raw.v !== 1) throw new Error(`Ismeretlen adatverzió: ${raw.v}`)
  const n = raw.n
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  const search: string[] = new Array(n)
  const byId = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    lat[i] = raw.lat[i] / 1e5
    lon[i] = raw.lon[i] / 1e5
    const settlement = raw.s[i] >= 0 ? raw.settlements[raw.s[i]] : ''
    search[i] = fold(`${raw.name[i]} ${settlement}`)
    byId.set(raw.id[i], i)
  }
  return {
    n,
    cats: raw.cats,
    counties: raw.counties,
    settlements: raw.settlements,
    id: raw.id,
    name: raw.name,
    search,
    lat,
    lon,
    cat: Uint8Array.from(raw.c),
    county: Uint8Array.from(raw.m),
    tier: Uint8Array.from(raw.t),
    flags: Uint16Array.from(raw.f),
    settlement: Int32Array.from(raw.s),
    score: Float32Array.from(raw.sc, (v) => v / 10),
    byId,
  }
}

export function settlementOf(index: PoiIndex, i: number): string | null {
  const s = index.settlement[i]
  return s >= 0 ? index.settlements[s] : null
}
