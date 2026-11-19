// „Igazítás a valószínű útra”: a (kézzel igazított) nyomvonal ráillesztése az úthálózatra.
//  1. online: Valhalla trace_route (térképi illesztés gyalogos profillal; a rögzítési
//     pontok kötelező átmenőpontok);
//  2. offline vagy hiba esetén: a 25 m-en belüli jelzett turistaútra vetítés.

import { decodePolyline } from '../route/engine'
import { haversineM } from '../route/geo'
import { type LonLat, thin } from './geom'

export const TRACE_ROUTE_URL = 'https://valhalla1.openstreetmap.de/trace_route'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export function traceRouteBody(line: LonLat[], anchorIdx: number[] = []): Record<string, unknown> {
  // kb. 10 m-es ritkítás; a rögzítési pontok megmaradnak és kötelezők („break”)
  const keep = new Set(anchorIdx)
  const pts: { lat: number; lon: number; type?: string }[] = []
  let last: LonLat | null = null
  line.forEach((p, k) => {
    const isEnd = k === 0 || k === line.length - 1
    if (isEnd || keep.has(k) || !last || haversineM(last[1], last[0], p[1], p[0]) >= 10) {
      pts.push({
        lat: Math.round(p[1] * 1e6) / 1e6,
        lon: Math.round(p[0] * 1e6) / 1e6,
        ...(isEnd || keep.has(k) ? { type: 'break' } : { type: 'via' }),
      })
      last = p
    }
  })
  return {
    shape: pts,
    costing: 'pedestrian',
    costing_options: { pedestrian: { max_hiking_difficulty: 6, use_tracks: 1 } },
    shape_match: 'map_snap',
    trace_options: { search_radius: 40, gps_accuracy: 12 },
    directions_options: { units: 'kilometers' },
  }
}

/** Valhalla-illesztés; hibánál null (a hívó a helyi ráillesztést használja). */
export async function matchValhalla(
  line: LonLat[],
  anchorIdx: number[] = [],
  signal?: AbortSignal,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
): Promise<LonLat[] | null> {
  if (line.length < 2) return null
  try {
    const res = await fetchFn(TRACE_ROUTE_URL, {
      method: 'POST',
      body: JSON.stringify(traceRouteBody(line, anchorIdx)),
      // „egyszerű” kérés: nincs CORS-előkérés
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      signal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { trip?: { legs?: { shape: string }[] } }
    const out: LonLat[] = []
    for (const leg of json.trip?.legs ?? []) {
      const pts = decodePolyline(leg.shape, 6)
      out.push(...(out.length ? pts.slice(1) : pts))
    }
    return out.length >= 2 ? out : null
  } catch {
    return null
  }
}

/** Helyi ráillesztés: minden pont a legközelebbi vonalszakaszra vetül, ha `maxM`-en belül van. */
export function snapToLines(line: LonLat[], lines: LonLat[][], maxM = 25): LonLat[] {
  if (!lines.length) return line.slice()
  const refLat = line.reduce((s, p) => s + p[1], 0) / Math.max(1, line.length)
  const kx = Math.cos((refLat * Math.PI) / 180) * 111320
  const ky = 110540
  // szakaszok rácsba (kb. 100 m-es cellák)
  const cell = 100
  const grid = new Map<string, [LonLat, LonLat][]>()
  const key = (x: number, y: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`
  for (const l of lines) {
    for (let k = 1; k < l.length; k++) {
      const a = l[k - 1]
      const b = l[k]
      const x0 = Math.min(a[0], b[0]) * kx
      const x1 = Math.max(a[0], b[0]) * kx
      const y0 = Math.min(a[1], b[1]) * ky
      const y1 = Math.max(a[1], b[1]) * ky
      for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++) {
        for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++) {
          const kk = `${x}:${y}`
          let c = grid.get(kk)
          if (!c) grid.set(kk, (c = []))
          c.push([a, b])
        }
      }
    }
  }
  return line.map((p) => {
    const px = p[0] * kx
    const py = p[1] * ky
    let best: LonLat | null = null
    let bestD = maxM
    const [cx, cy] = key(px, py).split(':').map(Number)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [a, b] of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const ax = a[0] * kx
          const ay = a[1] * ky
          const vx = b[0] * kx - ax
          const vy = b[1] * ky - ay
          const len2 = vx * vx + vy * vy
          const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0
          const qx = ax + t * vx
          const qy = ay + t * vy
          const d = Math.hypot(px - qx, py - qy)
          if (d <= bestD) {
            bestD = d
            best = [qx / kx, qy / ky]
          }
        }
      }
    }
    return best ?? p
  })
}

export { thin }
