import { create } from 'zustand'
import type { AppData } from '../data/load'
import { applyFilters, DEFAULT_FILTERS, type FilterResult, type FilterState } from '../filters/filter'

export type Basemap = 'topo' | 'osm' | 'none'
export type SheetTab = 'filters' | 'list'

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
}

function compute(data: AppData | null, filters: FilterState): FilterResult | null {
  return data ? applyFilters(data.index, filters) : null
}

export const useStore = create<State>((set, get) => ({
  data: null,
  error: null,
  filters: DEFAULT_FILTERS,
  result: null,
  selected: null,
  tab: 'filters',
  basemap: 'topo',
  trails: true,
  aboutOpen: false,
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
}))
