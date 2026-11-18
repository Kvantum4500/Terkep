export type Profile = 'hike' | 'bike' | 'car'

export const PROFILE_LABEL: Record<Profile, string> = {
  hike: 'Túra',
  bike: 'Kerékpár',
  car: 'Autó',
}

export interface Waypoint {
  lat: number
  lon: number
  name: string
  /** ha egy látnivaló a pont */
  poiId?: string
  /** a saját (GPS) hely */
  me?: boolean
}

export type Role = 'start' | 'via' | 'end'

export interface RouteStep {
  text: string
  km: number
}

export interface RouteAlt {
  /** [lon, lat] párok */
  coords: [number, number][]
  distanceKm: number
  durationS: number
  ascent?: number
  descent?: number
  steps: RouteStep[]
  engine: 'valhalla' | 'osrm'
}

export interface RoutePlan {
  start: Waypoint | null
  vias: Waypoint[]
  end: Waypoint | null
}

export const EMPTY_PLAN: RoutePlan = { start: null, vias: [], end: null }

/** A tervezéshez kellő pontok sorrendben (indulás, köztes pontok, cél). */
export function planPoints(p: RoutePlan): Waypoint[] | null {
  if (!p.start || !p.end) return null
  return [p.start, ...p.vias, p.end]
}

export function addToPlan(p: RoutePlan, wp: Waypoint, role: Role): RoutePlan {
  if (role === 'start') return { ...p, start: wp }
  if (role === 'end') return { ...p, end: wp }
  // köztes pont: ha még nincs cél, ez lesz a cél
  if (!p.end) return { ...p, end: wp }
  return { ...p, vias: [...p.vias, wp] }
}

export function removeFromPlan(p: RoutePlan, role: Role, viaIndex = 0): RoutePlan {
  if (role === 'start') return { ...p, start: null }
  if (role === 'end') return { ...p, end: null }
  return { ...p, vias: p.vias.filter((_, i) => i !== viaIndex) }
}

export function moveVia(p: RoutePlan, i: number, dir: -1 | 1): RoutePlan {
  const j = i + dir
  if (j < 0 || j >= p.vias.length) return p
  const vias = [...p.vias]
  ;[vias[i], vias[j]] = [vias[j], vias[i]]
  return { ...p, vias }
}

export function reversePlan(p: RoutePlan): RoutePlan {
  return { start: p.end, vias: [...p.vias].reverse(), end: p.start }
}
