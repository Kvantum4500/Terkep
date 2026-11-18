import { create } from 'zustand'
import type { AppData } from '../data/load'
import { applyFilters, DEFAULT_FILTERS, type FilterResult, type FilterState } from '../filters/filter'
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
export type SheetTab = 'filters' | 'list' | 'route'

export interface RouteState {
  plan: RoutePlan
  profile: Profile
  alts: RouteAlt[]
  active: number
  status: 'idle' | 'loading' | 'ok' | 'error'
  error: string | null
}

const ROUTE0: RouteState = { plan: EMPTY_PLAN, profile: 'hike', alts: [], active: 0, status: 'idle', error: null }

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
  addWaypoint: (wp: Waypoint, role: Role) => void
  removeWaypoint: (role: Role, viaIndex?: number) => void
  moveWaypoint: (viaIndex: number, dir: -1 | 1) => void
  reverseRoute: () => void
  clearRoute: () => void
  setProfile: (p: Profile) => void
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
    addWaypoint: (wp, role) => setPlan(addToPlan(get().route.plan, wp, role)),
    removeWaypoint: (role, viaIndex) => setPlan(removeFromPlan(get().route.plan, role, viaIndex)),
    moveWaypoint: (i, dir) => setPlan(moveVia(get().route.plan, i, dir)),
    reverseRoute: () => setPlan(reversePlan(get().route.plan)),
    clearRoute: () => set({ route: { ...ROUTE0, profile: get().route.profile } }),
    setProfile: (profile) => set({ route: { ...get().route, profile } }),
    setRouteResult: (r) => set({ route: { ...get().route, ...r } }),
    setPickRole: (pickRole) => set({ pickRole }),
  }
})
