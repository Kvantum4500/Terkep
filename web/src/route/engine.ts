// Útvonaltervezés nyílt, kulcs nélküli szolgáltatásokkal (OSM-adat):
//  1. FOSSGIS Valhalla – túra/kerékpár/autó profil, alternatívák, magasság;
//  2. tartalék: FOSSGIS OSRM, ha a Valhalla nem érhető el.
// Mindkettőt az openstreetmap.org útvonaltervezője is a böngészőből hívja.

import { ascentDescent } from './geo'
import type { CarPref, Profile, RoadPref, RouteAlt, RouteStep, Waypoint } from './types'

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route'
export const OSRM_URL = 'https://routing.openstreetmap.de'

export const ENGINE_CREDIT = {
  valhalla: 'Útvonal: Valhalla – FOSSGIS e.V. (openstreetmap.de), adatok © OpenStreetMap közreműködők',
  osrm: 'Útvonal: OSRM – FOSSGIS e.V. (openstreetmap.de), adatok © OpenStreetMap közreműködők',
} as const

export interface RoutePrefs {
  road: RoadPref
  car: CarPref
}

export const DEFAULT_PREFS: RoutePrefs = { road: 'quiet', car: 'fast' }

const HIKE: Record<RoadPref, Record<string, unknown>> = {
  // a gyalogútnak szánt (autóval nem járható) utak sokkal olcsóbbak -> a közút csak végszükségből
  avoid: {
    walkway_factor: 0.35,
    sidewalk_factor: 1.4,
    alley_factor: 2,
    driveway_factor: 5,
    service_factor: 1.6,
    use_living_streets: 0.1,
    use_tracks: 1,
  },
  quiet: { walkway_factor: 0.7, use_living_streets: 0.6, use_tracks: 1 },
  any: { walkway_factor: 1, use_tracks: 0.5 },
  shortest: { shortest: true },
}

const BIKE: Record<RoadPref, Record<string, unknown>> = {
  avoid: { bicycle_type: 'Mountain', use_roads: 0, avoid_bad_surfaces: 0, use_living_streets: 0.2 },
  quiet: { bicycle_type: 'Hybrid', use_roads: 0.2, avoid_bad_surfaces: 0.3 },
  any: { bicycle_type: 'Hybrid', use_roads: 0.6, avoid_bad_surfaces: 0.5 },
  shortest: { bicycle_type: 'Hybrid', shortest: true },
}

const CAR: Record<CarPref, Record<string, unknown>> = {
  fast: {},
  nohighway: { use_highways: 0, use_tolls: 0 },
  shortest: { shortest: true },
}

/** Valhalla-profilok: túrán az ösvények és földutak előnyben, nehezebb terep is mehet. */
export function valhallaCosting(
  profile: Profile,
  prefs: RoutePrefs = DEFAULT_PREFS,
): { costing: string; costing_options: Record<string, unknown> } {
  switch (profile) {
    case 'hike':
      return {
        costing: 'pedestrian',
        costing_options: { pedestrian: { max_hiking_difficulty: 3, use_hills: 0.5, ...HIKE[prefs.road] } },
      }
    case 'bike':
      return { costing: 'bicycle', costing_options: { bicycle: { use_hills: 0.4, ...BIKE[prefs.road] } } }
    default:
      return { costing: 'auto', costing_options: { auto: { ...CAR[prefs.car] } } }
  }
}

export function valhallaRequest(points: Waypoint[], profile: Profile, prefs?: RoutePrefs): Record<string, unknown> {
  return {
    locations: points.map((p) => ({ lat: round6(p.lat), lon: round6(p.lon), type: 'break' })),
    ...valhallaCosting(profile, prefs),
    directions_options: { language: 'hu-HU', units: 'kilometers' },
    // alternatívát a Valhalla csak két pont között ad
    alternates: points.length === 2 ? 2 : 0,
    elevation_interval: 30,
  }
}

export function valhallaUrl(points: Waypoint[], profile: Profile, prefs?: RoutePrefs): string {
  // GET (nem POST JSON): így nincs CORS-előkérés
  return `${VALHALLA_URL}?json=${encodeURIComponent(JSON.stringify(valhallaRequest(points, profile, prefs)))}`
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6

/** Google/Valhalla-féle kódolt vonallánc -> [lon, lat] párok. */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision
  const out: [number, number][] = []
  let index = 0
  let lat = 0
  let lon = 0
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0
      let shift = 0
      let b: number
      do {
        b = str.charCodeAt(index++) - 63
        result |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lon += delta
    }
    out.push([lon / factor, lat / factor])
  }
  return out
}

interface ValhallaTrip {
  legs: {
    shape: string
    maneuvers?: { instruction: string; length: number }[]
    elevation?: number[]
  }[]
  summary: { length: number; time: number }
}

export function parseValhallaTrip(trip: ValhallaTrip): RouteAlt {
  const coords: [number, number][] = []
  const steps: RouteStep[] = []
  const elevation: number[] = []
  for (const leg of trip.legs) {
    const pts = decodePolyline(leg.shape, 6)
    // a lábak találkozópontja ne duplázódjon
    coords.push(...(coords.length ? pts.slice(1) : pts))
    for (const m of leg.maneuvers ?? []) steps.push({ text: m.instruction, km: m.length })
    if (leg.elevation) elevation.push(...leg.elevation)
  }
  const ad = elevation.length > 1 ? ascentDescent(elevation) : null
  return {
    coords,
    distanceKm: trip.summary.length,
    durationS: trip.summary.time,
    ascent: ad?.ascent,
    descent: ad?.descent,
    steps,
    engine: 'valhalla',
  }
}

export function parseValhalla(json: { trip?: ValhallaTrip; alternates?: { trip: ValhallaTrip }[] }): RouteAlt[] {
  if (!json.trip) throw new Error('A tervező nem adott útvonalat.')
  return [json.trip, ...(json.alternates ?? []).map((a) => a.trip)].map(parseValhallaTrip)
}

const OSRM_PROFILE: Record<Profile, string> = { hike: 'routed-foot', bike: 'routed-bike', car: 'routed-car' }

export function osrmUrl(points: Waypoint[], profile: Profile): string {
  const coords = points.map((p) => `${round6(p.lon)},${round6(p.lat)}`).join(';')
  return `${OSRM_URL}/${OSRM_PROFILE[profile]}/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=${
    points.length === 2 ? 'true' : 'false'
  }&steps=true`
}

interface OsrmStep {
  name: string
  distance: number
  maneuver: { type: string; modifier?: string }
}

const MODIFIER: Record<string, string> = {
  left: 'Fordulj balra',
  right: 'Fordulj jobbra',
  'slight left': 'Tarts enyhén balra',
  'slight right': 'Tarts enyhén jobbra',
  'sharp left': 'Fordulj élesen balra',
  'sharp right': 'Fordulj élesen jobbra',
  straight: 'Haladj egyenesen',
  uturn: 'Fordulj vissza',
}

function osrmStepText(s: OsrmStep): string {
  const on = s.name ? ` (${s.name})` : ''
  if (s.maneuver.type === 'depart') return `Indulj el${on}`
  if (s.maneuver.type === 'arrive') return 'Megérkeztél'
  return `${MODIFIER[s.maneuver.modifier ?? 'straight'] ?? 'Haladj tovább'}${on}`
}

export function parseOsrm(json: {
  code: string
  routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number; legs: { steps: OsrmStep[] }[] }[]
}): RouteAlt[] {
  if (json.code !== 'Ok' || !json.routes?.length) throw new Error('A tervező nem talált útvonalat.')
  return json.routes.map((r) => ({
    coords: r.geometry.coordinates,
    distanceKm: r.distance / 1000,
    durationS: r.duration,
    steps: r.legs.flatMap((l) => l.steps.map((s) => ({ text: osrmStepText(s), km: s.distance / 1000 }))),
    engine: 'osrm' as const,
  }))
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** Útvonal a pontokon át; a Valhalla hibájánál az OSRM-mel próbálkozik. */
export async function planRoute(
  points: Waypoint[],
  profile: Profile,
  signal?: AbortSignal,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
  prefs?: RoutePrefs,
): Promise<RouteAlt[]> {
  if (points.length < 2) throw new Error('Legalább két pont kell.')
  try {
    const res = await fetchFn(valhallaUrl(points, profile, prefs), { signal })
    if (res.ok) return parseValhalla(await res.json())
    // 400: nincs útvonal (pl. elérhetetlen pont) – ezt az OSRM-mel is megpróbáljuk
  } catch (e) {
    if (signal?.aborted) throw e
  }
  const res = await fetchFn(osrmUrl(points, profile), { signal })
  if (!res.ok) throw new Error(`Az útvonaltervező nem érhető el (${res.status}).`)
  return parseOsrm(await res.json())
}

export function formatDuration(s: number): string {
  const min = Math.round(s / 60)
  if (min < 60) return `${min} perc`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} óra ${m} perc` : `${h} óra`
}

export function formatKm(km: number): string {
  return km < 10
    ? `${km.toLocaleString('hu-HU', { maximumFractionDigits: 1 })} km`
    : `${Math.round(km).toLocaleString('hu-HU')} km`
}

/** Google Térkép útvonal (külső app) ugyanezekkel a pontokkal. */
export function googleDirectionsUrl(points: Waypoint[], profile: Profile): string {
  const fmt = (p: Waypoint) => `${round6(p.lat)},${round6(p.lon)}`
  const mode = profile === 'hike' ? 'walking' : profile === 'bike' ? 'bicycling' : 'driving'
  const q = new URLSearchParams({
    api: '1',
    origin: fmt(points[0]),
    destination: fmt(points[points.length - 1]),
    travelmode: mode,
  })
  if (points.length > 2) q.set('waypoints', points.slice(1, -1).map(fmt).join('|'))
  return `https://www.google.com/maps/dir/?${q.toString()}`
}

export const TRACE_ATTRIBUTES_URL = 'https://valhalla1.openstreetmap.de/trace_attributes'

/** Polyline-kódolás (Valhalla: 6 jegy). */
export function encodePolyline(coords: [number, number][], precision = 6): string {
  const f = 10 ** precision
  let out = ''
  let plat = 0
  let plon = 0
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1
    while (x >= 0x20) {
      out += String.fromCharCode((0x20 | (x & 0x1f)) + 63)
      x >>= 5
    }
    out += String.fromCharCode(x + 63)
  }
  for (const [lon, lat] of coords) {
    const ilat = Math.round(lat * f)
    const ilon = Math.round(lon * f)
    enc(ilat - plat)
    enc(ilon - plon)
    plat = ilat
    plon = ilon
  }
  return out
}

export interface RoadShare {
  totalKm: number
  /** közút (bármilyen gépjárművel járható út) */
  roadKm: number
  /** ebből forgalmas (autópálya, autóút, fő- és mellékút) */
  busyKm: number
}

const BUSY = new Set(['motorway', 'trunk', 'primary', 'secondary'])
const ROAD_USES = new Set(['road', 'living_street', 'service_road', 'driveway', 'alley', 'parking_aisle', 'drive_through'])

export function summarizeEdges(edges: { use?: string; road_class?: string; length?: number }[]): RoadShare {
  let totalKm = 0
  let roadKm = 0
  let busyKm = 0
  for (const e of edges) {
    const km = e.length ?? 0
    totalKm += km
    if (e.use && ROAD_USES.has(e.use)) {
      roadKm += km
      if (e.road_class && BUSY.has(e.road_class)) busyKm += km
    }
  }
  return { totalKm, roadKm, busyKm }
}

/** Mennyi az útvonalból a közút (Valhalla trace_attributes). Hibánál null – ez csak kiegészítő adat. */
export async function roadShare(
  coords: [number, number][],
  profile: Profile,
  signal?: AbortSignal,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
): Promise<RoadShare | null> {
  const body = {
    encoded_polyline: encodePolyline(coords),
    costing: valhallaCosting(profile).costing,
    shape_match: 'edge_walk',
    filters: { attributes: ['edge.use', 'edge.road_class', 'edge.length'], action: 'include' },
  }
  try {
    // text/plain: „egyszerű” kérés, nincs CORS-előkérés
    const res = await fetchFn(TRACE_ATTRIBUTES_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      signal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { edges?: { use?: string; road_class?: string; length?: number }[] }
    return json.edges?.length ? summarizeEdges(json.edges) : null
  } catch {
    return null
  }
}
