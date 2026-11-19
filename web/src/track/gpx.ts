// GPX beolvasása (más appokból: Samsung Health, Strava, Garmin…) és kiírása.
// Szándékosan DOM nélkül (reguláris kifejezésekkel), így tesztben és bármely
// környezetben működik; a trkpt, rtept és – végső esetben – wpt pontokat olvassa.

import type { TrackPoint } from './geom'

const POINT = /<(trkpt|rtept|wpt)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g
const ATTR = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`)
const TAG = (name: string) => new RegExp(`<(?:\\w+:)?${name}>\\s*([^<]+?)\\s*</(?:\\w+:)?${name}>`)

export interface ParsedGpx {
  name?: string
  points: TrackPoint[]
}

export function parseGpx(text: string): ParsedGpx {
  const byKind: Record<string, TrackPoint[]> = { trkpt: [], rtept: [], wpt: [] }
  for (const m of text.matchAll(POINT)) {
    const lat = Number(ATTR('lat').exec(m[2])?.[1])
    const lon = Number(ATTR('lon').exec(m[2])?.[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const body = m[4] ?? ''
    const ele = Number(TAG('ele').exec(body)?.[1])
    const time = TAG('time').exec(body)?.[1]
    const t = time ? Date.parse(time) : NaN
    byKind[m[1]].push({
      lon,
      lat,
      ...(Number.isFinite(ele) ? { ele } : {}),
      ...(Number.isFinite(t) ? { t } : {}),
    })
  }
  const points = byKind.trkpt.length ? byKind.trkpt : byKind.rtept.length ? byKind.rtept : byKind.wpt
  const name = /<trk>[\s\S]*?<name>\s*([^<]+?)\s*<\/name>/.exec(text)?.[1] ?? /<name>\s*([^<]+?)\s*<\/name>/.exec(text)?.[1]
  return { name: name ? decodeXml(name) : undefined, points }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Nyomvonal GPX 1.1-ként (időbélyeggel és magassággal, ha van). */
export function trackToGpx(name: string, pts: { lon: number; lat: number; ele?: number; t?: number }[]): string {
  const trkpts = pts
    .map((p) => {
      const inner = [
        p.ele !== undefined ? `<ele>${p.ele.toFixed(1)}</ele>` : '',
        p.t !== undefined ? `<time>${new Date(p.t).toISOString()}</time>` : '',
      ].join('')
      return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${inner}</trkpt>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Magyarország látnivalói" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}
