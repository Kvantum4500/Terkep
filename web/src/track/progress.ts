// Turistaút teljesítése a saját nyomvonalak alapján: az utat 25 m-enként mintavételezzük,
// és egy minta teljesített, ha bármelyik nyomvonal 40 m-en belül halad el mellette.

import { haversineM } from '../route/geo'
import type { LonLat } from './geom'

export interface Progress {
  totalKm: number
  doneKm: number
  pct: number
  /** a teljesített részek (a térképre) */
  done: LonLat[][]
}

/** Rács a nyomvonalpontokhoz: kb. `cellM` méteres cellák, gyors szomszédkereséshez. */
class PointGrid {
  private cells = new Map<string, LonLat[]>()
  private dLat: number
  private dLon: number

  constructor(points: Iterable<LonLat>, cellM: number, refLat: number) {
    this.dLat = cellM / 110540
    this.dLon = cellM / (Math.cos((refLat * Math.PI) / 180) * 111320)
    for (const p of points) {
      const k = this.key(p[0], p[1])
      let c = this.cells.get(k)
      if (!c) this.cells.set(k, (c = []))
      c.push(p)
    }
  }

  private key(lon: number, lat: number): string {
    return `${Math.floor(lon / this.dLon)}:${Math.floor(lat / this.dLat)}`
  }

  near(lon: number, lat: number, maxM: number): boolean {
    const cx = Math.floor(lon / this.dLon)
    const cy = Math.floor(lat / this.dLat)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const p of this.cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (haversineM(lat, lon, p[1], p[0]) <= maxM) return true
        }
      }
    }
    return false
  }
}

/** Sűrítés: a nyomvonalpontok legfeljebb `stepM` méterre legyenek egymástól (a rács ezt igényli). */
function densify(line: LonLat[], stepM: number): LonLat[] {
  const out: LonLat[] = []
  for (let k = 0; k < line.length; k++) {
    if (k > 0) {
      const [lon1, lat1] = line[k - 1]
      const [lon2, lat2] = line[k]
      const d = haversineM(lat1, lon1, lat2, lon2)
      const n = Math.floor(d / stepM)
      for (let j = 1; j <= n; j++) {
        const f = j / (n + 1)
        out.push([lon1 + f * (lon2 - lon1), lat1 + f * (lat2 - lat1)])
      }
    }
    out.push(line[k])
  }
  return out
}

export function trailProgress(trail: LonLat[][], tracks: LonLat[][], sampleM = 25, tolM = 40): Progress {
  const all = trail.flat()
  if (!all.length) return { totalKm: 0, doneKm: 0, pct: 0, done: [] }
  const refLat = all.reduce((s, p) => s + p[1], 0) / all.length
  const grid = new PointGrid(
    tracks.flatMap((t) => densify(t, tolM / 2)),
    tolM,
    refLat,
  )
  let total = 0
  let doneM = 0
  const done: LonLat[][] = []
  for (const line of trail) {
    let run: LonLat[] | null = null
    for (let k = 1; k < line.length; k++) {
      const [lon1, lat1] = line[k - 1]
      const [lon2, lat2] = line[k]
      const seg = haversineM(lat1, lon1, lat2, lon2)
      const n = Math.max(1, Math.ceil(seg / sampleM))
      for (let j = 0; j < n; j++) {
        const f0 = j / n
        const f1 = (j + 1) / n
        const a: LonLat = [lon1 + f0 * (lon2 - lon1), lat1 + f0 * (lat2 - lat1)]
        const b: LonLat = [lon1 + f1 * (lon2 - lon1), lat1 + f1 * (lat2 - lat1)]
        const mid: LonLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        const len = seg / n
        total += len
        if (grid.near(mid[0], mid[1], tolM)) {
          doneM += len
          if (!run) {
            run = [a]
            done.push(run)
          }
          run.push(b)
        } else {
          run = null
        }
      }
    }
  }
  return {
    totalKm: total / 1000,
    doneKm: doneM / 1000,
    pct: total ? Math.round((1000 * doneM) / total) / 10 : 0,
    done,
  }
}
