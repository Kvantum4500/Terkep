import type { PoiIndex } from '../data/types'
import type { Waypoint } from './types'

const R = 6371008.8

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Emelkedés és lejtés összege; a kis (zajszerű) ingadozást kiszűri. */
export function ascentDescent(elev: number[], threshold = 3): { ascent: number; descent: number } {
  let ascent = 0
  let descent = 0
  let ref = elev[0]
  for (let i = 1; i < elev.length; i++) {
    const d = elev[i] - ref
    if (d >= threshold) {
      ascent += d
      ref = elev[i]
    } else if (d <= -threshold) {
      descent -= d
      ref = elev[i]
    }
  }
  return { ascent: Math.round(ascent), descent: Math.round(descent) }
}

/**
 * Pont távolsága egy [lon, lat] vonalláncétól (méter) és a hozzá legközelebbi
 * hely aránya a vonal mentén (0..1). Helyi síkvetületben számol – rövid
 * (néhány száz km-es) útvonalakra bőven elég pontos.
 */
export function distanceToLine(lat: number, lon: number, line: [number, number][]): { d: number; along: number } {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320
  const ky = 110540
  let best = Infinity
  let bestAlong = 0
  let total = 0
  const segLen: number[] = []
  for (let i = 1; i < line.length; i++) {
    const dx = (line[i][0] - line[i - 1][0]) * kx
    const dy = (line[i][1] - line[i - 1][1]) * ky
    segLen.push(Math.hypot(dx, dy))
    total += segLen[i - 1]
  }
  let acc = 0
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - lon) * kx
    const ay = (line[i - 1][1] - lat) * ky
    const bx = (line[i][0] - lon) * kx
    const by = (line[i][1] - lat) * ky
    const vx = bx - ax
    const vy = by - ay
    const len2 = vx * vx + vy * vy
    const t = len2 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2)) : 0
    const d = Math.hypot(ax + t * vx, ay + t * vy)
    if (d < best) {
      best = d
      bestAlong = total ? (acc + t * segLen[i - 1]) / total : 0
    }
    acc += segLen[i - 1]
  }
  if (line.length === 1) best = haversineM(lat, lon, line[0][1], line[0][0])
  return { d: best, along: bestAlong }
}

export interface NearbyPoi {
  i: number
  d: number
  along: number
}

/** A (szűrt) látnivalók közül azok, amelyek legfeljebb `maxM` méterre vannak az útvonaltól. */
export function poisAlongRoute(
  index: PoiIndex,
  indices: Uint32Array,
  line: [number, number][],
  maxM = 300,
  limit = 60,
): NearbyPoi[] {
  if (line.length < 2) return []
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of line) {
    minLon = Math.min(minLon, lon)
    maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }
  const padLat = maxM / 110540
  const padLon = maxM / (Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180) * 111320)
  // hosszú útvonalnál ritkítjuk a vonalat (kb. 50 m-es lépésekre), hogy gyors maradjon
  const thin = thinLine(line, 50)
  const out: NearbyPoi[] = []
  for (const i of indices) {
    const lat = index.lat[i]
    const lon = index.lon[i]
    if (lat < minLat - padLat || lat > maxLat + padLat || lon < minLon - padLon || lon > maxLon + padLon) continue
    const { d, along } = distanceToLine(lat, lon, thin)
    if (d <= maxM) out.push({ i, d, along })
  }
  out.sort((a, b) => index.tier[a.i] - index.tier[b.i] || index.score[b.i] - index.score[a.i])
  return out.slice(0, limit).sort((a, b) => a.along - b.along)
}

function thinLine(line: [number, number][], minM: number): [number, number][] {
  const out: [number, number][] = [line[0]]
  for (let i = 1; i < line.length - 1; i++) {
    const last = out[out.length - 1]
    if (haversineM(last[1], last[0], line[i][1], line[i][0]) >= minM) out.push(line[i])
  }
  out.push(line[line.length - 1])
  return out
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** GPX 1.1 (nyomvonal + útpontok) – más túraappokba, órákra importálható. */
export function toGpx(name: string, line: [number, number][], points: Waypoint[]): string {
  const wpts = points
    .map((p) => `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${esc(p.name)}</name></wpt>`)
    .join('\n')
  const trkpts = line.map(([lon, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Magyarország látnivalói" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
${wpts}
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}
