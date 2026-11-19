import { create } from 'zustand'
import type { AppData } from '../data/load'
import { applyFilters, DEFAULT_FILTERS, type FilterResult, type FilterState } from '../filters/filter'
import { DEFAULT_PREFS, type RoutePrefs } from '../route/engine'
import type { Track } from '../track/db'
import type { TrackPoint } from '../track/geom'
import type { Progress } from '../track/progress'
import type { TrailFilter } from '../trails/data'
import {
  addToPlan,
  EMPTY_PLAN,
  moveVia,
  type Profile,
  removeFromPlan,
  reversePlan,
  type Role,
  type RouteAlt,
  type RoutePlan,
  type Waypoint,
} from '../route/types'

export type Basemap = 'topo' | 'osm' | 'sat' | 'none'
export type SheetTab = 'filters' | 'list' | 'route' | 'tracks'

export interface RecState {
  status: 'off' | 'on' | 'paused'
  points: TrackPoint[]
  started: number | null
  error: string | null
  /** a natív (háttérben is rögzítő) app fut-e */
  native: boolean
}

export interface RouteState {
  plan: RoutePlan
  profile: Profile
  prefs: RoutePrefs
  alts: RouteAlt[]
  active: number
  status: 'idle' | 'loading' | 'ok' | 'error'
  error: string | null
}

const ROUTE0: RouteState = {
  plan: EMPTY_PLAN,
  profile: 'hike',
  prefs: DEFAULT_PREFS,
  alts: [],
  active: 0,
  status: 'idle',
  error: null,
}

interface State {
  data: AppData | null
  error: string | null
  filters: FilterState
  result: FilterResult | null
  selected: string | null
  tab: SheetTab
  basemap: Basemap
  trails: boolean
  aboutOpen: boolean
  /** oldalpanel-elrendezésben a panel nyitva van-e */
  panelOpen: boolean
  /** kompatibilis térképmegjelenítés (ha a térkép vibrál) */
  compatMap: boolean
  /** jelzett turistautak a térképen (üres színlista: kikapcsolva) */
  trailFilter: TrailFilter
  /** kiválasztott turistaút (pl. az Országos Kéktúra) */
  selectedTrail: string | null
  /** turistaút-kereső szövege (a kártya megnyitása után is megmarad) */
  trailQuery: string
  /** saját nyomvonalak (csak a készüléken) */
  tracks: Track[]
  /** kiemelt nyomvonal */
  trackSel: string | null
  /** szerkesztés (kézi igazítás) alatt álló nyomvonal */
  trackEdit: string | null
  rec: RecState
  /** a kiválasztott turistaút teljesítése a saját nyomvonalak alapján */
  trailProgress: Progress | null
  route: RouteState
  /** a következő térképkoppintás ezt a pontot állítja be */
  pickRole: Role | null
  setData: (data: AppData) => void
  setError: (msg: string) => void
  setFilters: (patch: Partial<FilterState>) => void
  replaceFilters: (f: FilterState) => void
  resetFilters: () => void
  select: (id: string | null) => void
  setTab: (tab: SheetTab) => void
  setBasemap: (b: Basemap) => void
  setTrails: (on: boolean) => void
  setAboutOpen: (open: boolean) => void
  setPanelOpen: (open: boolean) => void
  setCompatMap: (on: boolean) => void
  setTrailFilter: (patch: Partial<TrailFilter>) => void
  setSelectedTrail: (id: string | null) => void
  setTrailQuery: (q: string) => void
  setTracks: (t: Track[]) => void
  upsertTrack: (t: Track) => void
  removeTrackLocal: (id: string) => void
  setTrackSel: (id: string | null) => void
  setTrackEdit: (id: string | null) => void
  setRec: (patch: Partial<RecState>) => void
  setTrailProgress: (p: Progress | null) => void
  addWaypoint: (wp: Waypoint, role: Role) => void
  removeWaypoint: (role: Role, viaIndex?: number) => void
  moveWaypoint: (viaIndex: number, dir: -1 | 1) => void
  reverseRoute: () => void
  clearRoute: () => void
  setProfile: (p: Profile) => void
  setPrefs: (patch: Partial<RoutePrefs>) => void
  setRouteResult: (r: Partial<Pick<RouteState, 'alts' | 'status' | 'error' | 'active'>>) => void
  setPickRole: (r: Role | null) => void
}

function compute(data: AppData | null, filters: FilterState): FilterResult | null {
  return data ? applyFilters(data.index, filters) : null
}

export const useStore = create<State>((set, get) => {
  const setPlan = (plan: RoutePlan) => set({ route: { ...get().route, plan } })
  return {
    data: null,
    error: null,
    filters: DEFAULT_FILTERS,
    result: null,
    selected: null,
    tab: 'filters',
    basemap: 'topo',
    trails: true,
    aboutOpen: false,
    panelOpen: true,
    compatMap: false,
    trailFilter: { colors: [], shapes: [] },
    selectedTrail: null,
    trailQuery: '',
    tracks: [],
    trackSel: null,
    trackEdit: null,
    rec: { status: 'off', points: [], started: null, error: null, native: false },
    trailProgress: null,
    route: ROUTE0,
    pickRole: null,
    setData: (data) => set({ data, result: compute(data, get().filters) }),
    setError: (error) => set({ error }),
    setFilters: (patch) => {
      const filters = { ...get().filters, ...patch }
      set({ filters, result: compute(get().data, filters) })
    },
    replaceFilters: (filters) => set({ filters, result: compute(get().data, filters) }),
    resetFilters: () => set({ filters: DEFAULT_FILTERS, result: compute(get().data, DEFAULT_FILTERS) }),
    select: (selected) => set({ selected }),
    setTab: (tab) => set({ tab }),
    setBasemap: (basemap) => set({ basemap }),
    setTrails: (trails) => set({ trails }),
    setAboutOpen: (aboutOpen) => set({ aboutOpen }),
    setPanelOpen: (panelOpen) => set({ panelOpen }),
    setCompatMap: (compatMap) => set({ compatMap }),
    setTrailFilter: (patch) => set({ trailFilter: { ...get().trailFilter, ...patch } }),
    setSelectedTrail: (selectedTrail) => set({ selectedTrail }),
    setTrailQuery: (trailQuery) => set({ trailQuery }),
    setTracks: (tracks) => set({ tracks }),
    upsertTrack: (t) => {
      const others = get().tracks.filter((x) => x.id !== t.id)
      set({ tracks: [t, ...others].sort((a, b) => b.created - a.created) })
    },
    removeTrackLocal: (id) =>
      set({
        tracks: get().tracks.filter((x) => x.id !== id),
        trackSel: get().trackSel === id ? null : get().trackSel,
        trackEdit: get().trackEdit === id ? null : get().trackEdit,
      }),
    setTrackSel: (trackSel) => set({ trackSel }),
    setTrackEdit: (trackEdit) => set({ trackEdit }),
    setRec: (patch) => set({ rec: { ...get().rec, ...patch } }),
    setTrailProgress: (trailProgress) => set({ trailProgress }),
    addWaypoint: (wp, role) => setPlan(addToPlan(get().route.plan, wp, role)),
    removeWaypoint: (role, viaIndex) => setPlan(removeFromPlan(get().route.plan, role, viaIndex)),
    moveWaypoint: (i, dir) => setPlan(moveVia(get().route.plan, i, dir)),
    reverseRoute: () => setPlan(reversePlan(get().route.plan)),
    clearRoute: () => set({ route: { ...ROUTE0, profile: get().route.profile, prefs: get().route.prefs } }),
    setProfile: (profile) => set({ route: { ...get().route, profile } }),
    setPrefs: (patch) => set({ route: { ...get().route, prefs: { ...get().route.prefs, ...patch } } }),
    setRouteResult: (r) => set({ route: { ...get().route, ...r } }),
    setPickRole: (pickRole) => set({ pickRole }),
  }
})
