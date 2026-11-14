import { useEffect, useRef } from 'react'
import { MapController } from '../map/MapController'
import { useStore } from '../state/store'

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
  const firstCounties = useRef(true)

  useEffect(() => {
    if (!ref.current) return
    const st = useStore.getState()
    const c = new MapController({
      container: ref.current,
      meta: data.meta,
      basemap: st.basemap,
      trails: st.trails && st.basemap !== 'none',
      onSelect: (id) => select(id),
    })
    ctl.current = c
    onController(c)
    void c.setCounties(data.counties)
    ;(window as unknown as { __terkepMap?: unknown }).__terkepMap = c.map
    return () => {
      onController(null)
      c.destroy()
      ctl.current = null
    }
  }, [data, select, onController])

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

  return <div ref={ref} className="map" data-testid="map" role="region" aria-label="Térkép" />
}
