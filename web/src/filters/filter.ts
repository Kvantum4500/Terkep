// Tiszta (mellékhatás nélküli) szűrőlogika – vitesttel tesztelve.

import { FLAG, type PoiIndex, type Tier } from '../data/types'
import { fold } from './text'

export interface FilterState {
  /** vármegyekódok; üres = mind */
  counties: string[]
  /** kategóriakulcsok; üres = mind */
  cats: string[]
  /** szintek; üres = mind */
  tiers: Tier[]
  /** szabad szöveges keresés (név, település) */
  q: string
  /** csak látogatható barlangok / Kéktúra-pecsételőhelyek / műemlékek */
  showcave: boolean
  kektura: boolean
  heritage: boolean
  /** csak 360°-os képpel (Google-utcakép vagy nyílt gömbpanoráma) */
  pano: boolean
}

export const DEFAULT_FILTERS: FilterState = {
  counties: [],
  cats: [],
  tiers: [1, 2],
  q: '',
  showcave: false,
  kektura: false,
  heritage: false,
  pano: false,
}

export interface FilterResult {
  /** a szűrőnek megfelelő sorok indexei, pontszám szerint csökkenő sorrendben */
  indices: Uint32Array
  /** darabszám vármegyénként, a vármegye-szűrőt figyelmen kívül hagyva */
  countyCounts: Record<string, number>
  /** darabszám kategóriánként, a kategória-szűrőt figyelmen kívül hagyva */
  catCounts: Record<string, number>
  /** darabszám szintenként, a szint-szűrőt figyelmen kívül hagyva */
  tierCounts: Record<Tier, number>
}

/** Bitmaszk egy halmazhoz az index kulcslistája szerint (üres halmaz = minden). */
function maskFor(keys: string[], selected: string[]): Uint8Array {
  const m = new Uint8Array(keys.length)
  if (selected.length === 0) {
    m.fill(1)
    return m
  }
  const set = new Set(selected)
  keys.forEach((k, i) => {
    if (set.has(k)) m[i] = 1
  })
  return m
}

export function applyFilters(index: PoiIndex, f: FilterState): FilterResult {
  const countyMask = maskFor(index.counties, f.counties)
  const catMask = maskFor(index.cats, f.cats)
  const tierSet = new Set<number>(f.tiers.length ? f.tiers : [1, 2, 3])
  const terms = fold(f.q).split(' ').filter(Boolean)
  let flagMask = 0
  if (f.showcave) flagMask |= FLAG.showcave
  if (f.kektura) flagMask |= FLAG.kektura
  if (f.heritage) flagMask |= FLAG.heritage

  const countyCountsArr = new Uint32Array(index.counties.length)
  const catCountsArr = new Uint32Array(index.cats.length)
  const tierCountsArr = new Uint32Array(4)
  const out = new Uint32Array(index.n)
  let k = 0

  const panoMask = FLAG.streetview | FLAG.pano
  for (let i = 0; i < index.n; i++) {
    if (flagMask && (index.flags[i] & flagMask) !== flagMask) continue
    if (f.pano && !(index.flags[i] & panoMask)) continue
    if (terms.length) {
      const hay = index.search[i]
      let ok = true
      for (const t of terms) {
        if (!hay.includes(t)) {
          ok = false
          break
        }
      }
      if (!ok) continue
    }
    const inCounty = countyMask[index.county[i]] === 1
    const inCat = catMask[index.cat[i]] === 1
    const inTier = tierSet.has(index.tier[i])
    if (inCat && inTier) countyCountsArr[index.county[i]]++
    if (inCounty && inTier) catCountsArr[index.cat[i]]++
    if (inCounty && inCat) tierCountsArr[index.tier[i]]++
    if (inCounty && inCat && inTier) out[k++] = i
  }

  const countyCounts: Record<string, number> = {}
  index.counties.forEach((c, i) => (countyCounts[c] = countyCountsArr[i]))
  const catCounts: Record<string, number> = {}
  index.cats.forEach((c, i) => (catCounts[c] = catCountsArr[i]))
  return {
    indices: out.slice(0, k),
    countyCounts,
    catCounts,
    tierCounts: { 1: tierCountsArr[1], 2: tierCountsArr[2], 3: tierCountsArr[3] },
  }
}

export function isDefault(f: FilterState): boolean {
  return JSON.stringify(f) === JSON.stringify(DEFAULT_FILTERS)
}

export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
