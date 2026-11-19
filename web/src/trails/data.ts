// Jelzett turistautak (OSM route=hiking) – a pipeline kimenete: data/trails/index.json és
// színenként egy-egy vonalfájl (5 jegyű polyline). Lustán töltődnek, csak amikor kell.

import { decodePolyline } from '../route/engine'

export type MarkColor = 'k' | 'p' | 's' | 'z' | 'x'
export type MarkShape = 'sav' | 'kereszt' | 'haromszog' | 'negyzet' | 'kor' | 'barlang' | 'rom' | 'egyeb'

export const MARK_COLORS: MarkColor[] = ['k', 'p', 's', 'z', 'x']
export const MARK_SHAPES: MarkShape[] = ['sav', 'kereszt', 'haromszog', 'negyzet', 'kor', 'barlang', 'rom', 'egyeb']

export const COLOR_LABEL: Record<MarkColor, string> = { k: 'kék', p: 'piros', s: 'sárga', z: 'zöld', x: 'egyéb' }
export const SHAPE_LABEL: Record<MarkShape, string> = {
  sav: 'sáv',
  kereszt: 'kereszt',
  haromszog: 'háromszög',
  negyzet: 'négyzet',
  kor: 'kör',
  barlang: 'barlang',
  rom: 'rom',
  egyeb: 'egyéb',
}
export const COLOR_HEX: Record<MarkColor, string> = {
  k: '#1d4ed8',
  p: '#dc2626',
  s: '#d4a106',
  z: '#16a34a',
  x: '#475569',
}
export const NETWORK_LABEL: Record<string, string> = {
  iwn: 'nemzetközi',
  nwn: 'országos',
  rwn: 'regionális',
  lwn: 'helyi',
}

export interface TrailEntry {
  id: string
  /** név */
  n: string
  ref?: string
  c: MarkColor
  s: MarkShape
  net: string
  km: number
  /** [minLon, minLat, maxLon, maxLat] */
  b: [number, number, number, number]
  /** szülő (pl. az Országos Kéktúra) */
  p?: string
  /** gyerekek (szakaszok) */
  ch?: string[]
}

export interface TrailIndex {
  trails: TrailEntry[]
  byId: Map<string, TrailEntry>
}

export type TrailGeo = Record<string, string[]>

const base = import.meta.env.BASE_URL
let indexPromise: Promise<TrailIndex | null> | null = null
const geoCache = new Map<MarkColor, Promise<TrailGeo>>()

/** null: nincs turistaút-adat (pl. még nem futott az adatfrissítés). */
export function loadTrailIndex(): Promise<TrailIndex | null> {
  if (!indexPromise) {
    indexPromise = fetch(`${base}data/trails/index.json`)
      .then(async (r) => {
        if (!r.ok) return null
        const raw = (await r.json()) as { trails: TrailEntry[] }
        return { trails: raw.trails, byId: new Map(raw.trails.map((t) => [t.id, t])) }
      })
      .catch(() => {
        indexPromise = null
        return null
      })
  }
  return indexPromise
}

export function loadTrailGeo(color: MarkColor): Promise<TrailGeo> {
  let p = geoCache.get(color)
  if (!p) {
    p = fetch(`${base}data/trails/${color}.json`).then((r) => (r.ok ? (r.json() as Promise<TrailGeo>) : {}))
    p.catch(() => geoCache.delete(color))
    geoCache.set(color, p)
  }
  return p
}

/** Az út és (szülő esetén) a szakaszai azonosítói. */
export function trailIds(idx: TrailIndex, id: string): string[] {
  const out: string[] = []
  const visit = (x: string, depth: number) => {
    if (out.includes(x) || depth > 4) return
    out.push(x)
    for (const c of idx.byId.get(x)?.ch ?? []) visit(c, depth + 1)
  }
  visit(id, 0)
  return out
}

export interface TrailFilter {
  colors: MarkColor[]
  /** üres: minden alak */
  shapes: MarkShape[]
}

/** A megjelenítendő vonalak GeoJSON-ként: a szűrőnek megfelelők és a kiválasztott út. */
export async function trailFeatures(
  idx: TrailIndex,
  filter: TrailFilter,
  selectedIds: string[],
): Promise<GeoJSON.FeatureCollection<GeoJSON.MultiLineString>> {
  const colors = new Set<MarkColor>(filter.colors)
  for (const id of selectedIds) {
    const t = idx.byId.get(id)
    if (t) colors.add(t.c)
  }
  const sel = new Set(selectedIds)
  const features: GeoJSON.Feature<GeoJSON.MultiLineString>[] = []
  for (const c of colors) {
    const geo = await loadTrailGeo(c)
    for (const [id, lines] of Object.entries(geo)) {
      const t = idx.byId.get(id)
      if (!t) continue
      const shown =
        sel.has(id) || (filter.colors.includes(t.c) && (filter.shapes.length === 0 || filter.shapes.includes(t.s)))
      if (!shown) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: lines.map((l) => decodePolyline(l, 5)) },
        properties: { id, c: t.c, s: t.s, color: COLOR_HEX[t.c], sel: sel.has(id) },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** Kereső: név vagy ref szerint (ékezet- és kisbetűfüggetlen), a hosszabb, nagyobb hálózatú utak elöl. */
export function searchTrails(idx: TrailIndex, q: string, limit = 12): TrailEntry[] {
  const fold = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
  const terms = fold(q).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const rank: Record<string, number> = { iwn: 0, nwn: 1, rwn: 2, lwn: 3 }
  return idx.trails
    .filter((t) => {
      const hay = fold(`${t.n} ${t.ref ?? ''}`)
      return terms.every((x) => hay.includes(x))
    })
    .sort((a, b) => (rank[a.net] ?? 4) - (rank[b.net] ?? 4) || Number(!!a.p) - Number(!!b.p) || b.km - a.km)
    .slice(0, limit)
}
