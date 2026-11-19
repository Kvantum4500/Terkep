import { useEffect, useRef } from 'react'
import { MapController, type MapView as MapViewState, type RoutePointMarker } from '../map/MapController'
import { pointWaypoint, routeTo } from '../state/actions'
import { useStore } from '../state/store'

const ROLE_HINT = { start: 'az indulási pontot', via: 'a köztes pontot', end: 'a célt' } as const

export function MapView({ onController }: { onController: (c: MapController | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const ctl = useRef<MapController | null>(null)
  const data = useStore((s) => s.data)!
  const result = useStore((s) => s.result)
  const counties = useStore((s) => s.filters.counties)
  const selected = useStore((s) => s.selected)
  const basemap = useStore((s) => s.basemap)
  const trails = useStore((s) => s.trails)
  const select = useStore((s) => s.select)
  const plan = useStore((s) => s.route.plan)
  const alts = useStore((s) => s.route.alts)
  const active = useStore((s) => s.route.active)
  const pickRole = useStore((s) => s.pickRole)
  const panelOpen = useStore((s) => s.panelOpen)
  const compat = useStore((s) => s.compatMap)
  const firstCounties = useRef(true)
  const lastView = useRef<MapViewState | undefined>(undefined)

  useEffect(() => {
    if (!ref.current) return
    const st = useStore.getState()
    const c = new MapController({
      container: ref.current,
      meta: data.meta,
      basemap: st.basemap,
      trails: st.trails && st.basemap !== 'none',
      compat,
      view: lastView.current,
      onSelect: (id) => select(id),
      onPick: (p) => {
        const s = useStore.getState()
        if (!s.pickRole) return
        s.addWaypoint(pointWaypoint(p.lat, p.lon, p.poiId), s.pickRole)
        s.setPickRole(null)
      },
      onMapPoint: (role, p) => routeTo(pointWaypoint(p.lat, p.lon, p.poiId), role),
      onSelectAlt: (i) => useStore.getState().setRouteResult({ active: i }),
    })
    ctl.current = c
    onController(c)
    void c.setCounties(data.counties)
    // újralétrehozás után (kompatibilis mód) minden réteg visszakerül
    if (lastView.current) {
      const s2 = useStore.getState()
      if (s2.result) void c.setPois(data.index, s2.result.indices)
      void c.setActiveCounties(s2.filters.counties, data.counties, false)
      void c.setSelected(data.index, s2.selected, false)
      void c.setRoute(s2.route.alts, s2.route.active)
    }
    ;(window as unknown as { __terkepMap?: unknown }).__terkepMap = c.map
    return () => {
      lastView.current = c.getView()
      onController(null)
      c.destroy()
      ctl.current = null
    }
  }, [data, select, onController, compat])

  useEffect(() => {
    if (ctl.current && result) void ctl.current.setPois(data.index, result.indices)
  }, [result, data])

  useEffect(() => {
    // az első (URL-ből jövő) beállításnál is ráközelítünk, ha van vármegye-szűrő
    const fit = !firstCounties.current || counties.length > 0
    firstCounties.current = false
    void ctl.current?.setActiveCounties(counties, data.counties, fit)
  }, [counties, data])

  useEffect(() => {
    void ctl.current?.setSelected(data.index, selected, true)
  }, [selected, data])

  useEffect(() => ctl.current?.setBasemap(basemap), [basemap])
  useEffect(() => ctl.current?.setTrails(trails && basemap !== 'none'), [trails, basemap])

  useEffect(() => {
    const pts: RoutePointMarker[] = []
    if (plan.start) pts.push({ ...plan.start, label: 'I', role: 'start' })
    plan.vias.forEach((v, i) => pts.push({ ...v, label: String(i + 1), role: 'via' }))
    if (plan.end) pts.push({ ...plan.end, label: 'C', role: 'end' })
    void ctl.current?.setRoutePoints(pts)
  }, [plan, compat])

  useEffect(() => {
    void ctl.current?.setRoute(alts, active)
  }, [alts, active])

  // új útvonalnál a térkép az egészet mutassa
  useEffect(() => {
    if (alts[0]) void ctl.current?.fitRoute(alts[0].coords)
  }, [alts])

  useEffect(() => ctl.current?.setPickMode(pickRole !== null), [pickRole])

  return (
    <div className="map-wrap">
      <div ref={ref} className="map" data-testid="map" role="region" aria-label="Térkép" />
      {pickRole && (
        <div className="pick-hint" role="status" data-testid="pick-hint">
          Koppints a térképre (vagy egy látnivalóra) {ROLE_HINT[pickRole]} kijelöléséhez.
          <button type="button" className="link-btn" onClick={() => useStore.getState().setPickRole(null)}>
            Mégse
          </button>
        </div>
      )}
      {!panelOpen && (
        <button
          type="button"
          className="panel-show"
          onClick={() => useStore.getState().setPanelOpen(true)}
          aria-label="Panel megjelenítése"
          data-testid="panel-show"
        >
          ☰ Panel
        </button>
      )}
    </div>
  )
}
