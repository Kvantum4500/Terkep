// Saját nyomvonalak geometriája: kézi igazítás (rögzítési pontok, „rubber-sheeting”),
// statisztika, legközelebbi pont. Tiszta függvények – vitesttel tesztelve.

import { ascentDescent, haversineM } from '../route/geo'

export interface TrackPoint {
  lon: number
  lat: number
  /** magasság (m), ha a GPS megadja */
  ele?: number
  /** időbélyeg (ms) */
  t?: number
}

/**
 * Rögzítési pont: a nyers nyomvonal `i`-edik pontja a (lon, lat) helyre kerül.
 * A két szomszédos rögzítési pont (vagy a nyomvonal vége) közötti szakasz a
 * távolsággal arányosan, simán követi az elmozdítást.
 */
export interface Anchor {
  i: number
  lon: number
  lat: number
}

export type LonLat = [number, number]

/** Halmozott távolság (m) a nyomvonal mentén. */
export function cumulative(pts: { lon: number; lat: number }[]): number[] {
  const out = new Array<number>(pts.length)
  let acc = 0
  for (let k = 0; k < pts.length; k++) {
    if (k > 0) acc += haversineM(pts[k - 1].lat, pts[k - 1].lon, pts[k].lat, pts[k].lon)
    out[k] = acc
  }
  return out
}

/**
 * A rögzítési pontok szerint igazított nyomvonal. A végpontok helyben maradnak
 * (hacsak rájuk nem tettek rögzítési pontot); két rögzítési pont között az
 * elmozdulás a megtett úttal arányosan változik.
 */
export function applyAnchors(pts: TrackPoint[], anchors: Anchor[]): LonLat[] {
  if (pts.length === 0) return []
  const n = pts.length
  // elmozdulás a kulcspontokban: a végek 0, ha nincs rajtuk rögzítés
  const keys = new Map<number, LonLat>()
  keys.set(0, [0, 0])
  keys.set(n - 1, [0, 0])
  for (const a of anchors) {
    if (a.i < 0 || a.i >= n) continue
    keys.set(a.i, [a.lon - pts[a.i].lon, a.lat - pts[a.i].lat])
  }
  const idx = [...keys.keys()].sort((x, y) => x - y)
  const cum = cumulative(pts)
  const out: LonLat[] = new Array(n)
  for (let s = 0; s < idx.length - 1; s++) {
    const a = idx[s]
    const b = idx[s + 1]
    const da = keys.get(a)!
    const db = keys.get(b)!
    const span = cum[b] - cum[a]
    for (let k = a; k <= b; k++) {
      const w = span > 0 ? (cum[k] - cum[a]) / span : k === b ? 1 : 0
      out[k] = [pts[k].lon + da[0] + w * (db[0] - da[0]), pts[k].lat + da[1] + w * (db[1] - da[1])]
    }
  }
  if (n === 1) out[0] = [pts[0].lon + keys.get(0)![0], pts[0].lat + keys.get(0)![1]]
  return out
}

/** A vonal legközelebbi pontjának indexe és távolsága (m). */
export function nearestIndex(line: LonLat[], lon: number, lat: number): { i: number; d: number } {
  let best = -1
  let bestD = Infinity
  for (let k = 0; k < line.length; k++) {
    const d = haversineM(lat, lon, line[k][1], line[k][0])
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  return { i: best, d: bestD }
}

export interface TrackStats {
  km: number
  durationS: number
  ascent?: number
  descent?: number
}

export function trackStats(pts: TrackPoint[], line?: LonLat[]): TrackStats {
  const coords = line ?? pts.map((p) => [p.lon, p.lat] as LonLat)
  let m = 0
  for (let k = 1; k < coords.length; k++) m += haversineM(coords[k - 1][1], coords[k - 1][0], coords[k][1], coords[k][0])
  const times = pts.map((p) => p.t).filter((t): t is number => t !== undefined)
  const durationS = times.length > 1 ? (times[times.length - 1] - times[0]) / 1000 : 0
  const eles = pts.map((p) => p.ele).filter((e): e is number => e !== undefined && Number.isFinite(e))
  // a GPS-magasság zajos: 5 m-es küszöbbel összegzünk
  const ad = eles.length > 1 ? ascentDescent(eles, 5) : undefined
  return { km: m / 1000, durationS, ascent: ad?.ascent, descent: ad?.descent }
}

/** Ritkítás legalább `minM` méteres lépésközre (a végpontok megmaradnak). */
export function thin(line: LonLat[], minM: number): LonLat[] {
  if (line.length <= 2) return line.slice()
  const out: LonLat[] = [line[0]]
  for (let k = 1; k < line.length - 1; k++) {
    const last = out[out.length - 1]
    if (haversineM(last[1], last[0], line[k][1], line[k][0]) >= minM) out.push(line[k])
  }
  out.push(line[line.length - 1])
  return out
}
