import { decodeIndex } from './decode'
import type { Meta, PoiDetail, PoiIndex, RawIndex } from './types'

const base = import.meta.env.BASE_URL

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}data/${path}`)
  if (!res.ok) throw new Error(`Nem tölthető be: ${path} (${res.status})`)
  return (await res.json()) as T
}

export interface AppData {
  meta: Meta
  index: PoiIndex
  counties: GeoJSON.FeatureCollection
}

export async function loadData(): Promise<AppData> {
  const [meta, raw, counties] = await Promise.all([
    getJson<Meta>('meta.json'),
    getJson<RawIndex>('index.json'),
    getJson<GeoJSON.FeatureCollection>('megyek.geojson'),
  ])
  return { meta, index: decodeIndex(raw), counties }
}

const detailCache = new Map<string, Promise<Record<string, PoiDetail>>>()

export function loadCountyDetails(code: string): Promise<Record<string, PoiDetail>> {
  let p = detailCache.get(code)
  if (!p) {
    p = getJson<Record<string, PoiDetail>>(`details/${code}.json`)
    p.catch(() => detailCache.delete(code))
    detailCache.set(code, p)
  }
  return p
}
