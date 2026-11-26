// Az adatformátum a pipeline (pipeline/terkep_pipeline) és a scripts/build-data.ts
// szerint. A jelzőbitek egyeznek a pipeline/terkep_pipeline/models.py értékeivel.

export const FLAG = {
  heritage: 1,
  image: 2,
  kektura: 4,
  showcave: 8,
  ruin: 16,
  approx: 32,
  sample: 64,
  /** Google-utcakép a közelben (a pipeline előre megnézte) */
  streetview: 128,
  /** nyílt gömbpanoráma (Wikidata P4640) */
  pano: 256,
} as const

export type Tier = 1 | 2 | 3

export interface CategoryMeta {
  label: string
  group: string
  icon: string
  color: string
}

export interface SourceMeta {
  label: string
  url: string
  license: string
  kind: 'open' | 'editorial' | 'registry'
}

export interface Meta {
  version: number
  generated: string
  sample: boolean
  boundaries: string
  counts: { total: number; by_tier: Record<string, number>; by_cat: Record<string, number> }
  groups: Record<string, { label: string; order: number }>
  categories: Record<string, CategoryMeta>
  counties: Record<string, { name: string; short: string }>
  sources: Record<string, SourceMeta>
}

/** A public/data/index.json nyers alakja (oszlopos). */
export interface RawIndex {
  v: number
  n: number
  cats: string[]
  counties: string[]
  settlements: string[]
  id: string[]
  name: string[]
  lat: number[]
  lon: number[]
  c: number[]
  m: number[]
  t: number[]
  f: number[]
  s: number[]
  sc: number[]
}

/** Dekódolt index típusos tömbökkel; a sorrend pontszám szerint csökkenő. */
export interface PoiIndex {
  n: number
  cats: string[]
  counties: string[]
  settlements: string[]
  id: string[]
  name: string[]
  /** ékezet nélküli, kisbetűs név + település a kereséshez */
  search: string[]
  lat: Float64Array
  lon: Float64Array
  cat: Uint8Array
  county: Uint8Array
  tier: Uint8Array
  flags: Uint16Array
  settlement: Int32Array
  score: Float32Array
  byId: Map<string, number>
}

export interface PoiDetail {
  sources: { s: string; ref: string }[]
  sub?: string
  desc?: string
  ele?: number
  img?: { file: string; artist?: string; license?: string; license_url?: string }
  alt?: string[]
  /** Google-utcakép: a felvétel helye és az irány a látnivaló felé */
  sv?: { lat: number; lon: number; h: number }
  /** nyílt gömbpanoráma (Commons-fájlnév) */
  pano?: string
  wikidata?: string
  osm?: string
  huwiki?: string
}
