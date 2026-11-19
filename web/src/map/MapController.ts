// A MapLibre-térkép imperatív vezérlője. A React-komponens csak létrehozza és
// adatot ad neki (látnivalók, kiválasztás, útvonal).

import {
  type GeoJSONSource,
  GeolocateControl,
  LngLatBounds,
  type LngLatBoundsLike,
  type MapGeoJSONFeature,
  type MapLayerMouseEvent,
  Map as MlMap,
  type MapMouseEvent,
  type MapTouchEvent,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// A MapLibre 6 háttérszála külön (önálló) modul: a Vite assetként adja ki,
// a service worker pedig előre gyorsítótárazza (offline működés).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Meta, PoiIndex } from '../data/types'
import type { Role, RouteAlt } from '../route/types'
import type { Basemap } from '../state/store'
import { addCategoryIcons } from './icons'
import { buildStyle, EMPTY } from './style'

setWorkerUrl(workerUrl)

export const HUNGARY_BOUNDS: LngLatBoundsLike = [
  [16.1, 45.73],
  [22.9, 48.59],
]

const POI_LAYERS = ['poi-t1', 'poi-t2', 'poi-t3', 'poi-dots']
const FEW_POIS = 400
const LONG_PRESS_MS = 550

export interface MapPoint {
  lat: number
  lon: number
  /** ha egy látnivalóra koppintott */
  poiId?: string
}

export interface MapView {
  center: [number, number]
  zoom: number
  bearing: number
}

export interface MapControllerOptions {
  container: HTMLElement
  meta: Meta
  basemap: Basemap
  trails: boolean
  /**
   * Kompatibilis megjelenítés: egyes (pl. Samsung/Mali) grafikus meghajtókon a térkép
   * mozgatás közben felvillan; a megőrzött rajzpuffer, a korlátozott felbontás és az
   * áttűnések kikapcsolása ezt megszünteti.
   */
  compat?: boolean
  /** újralétrehozáskor (pl. kompatibilis mód váltása) a korábbi nézet */
  view?: MapView
  onSelect: (id: string | null) => void
  /** térképről választás (útvonalpont) */
  onPick?: (p: MapPoint) => void
  /** hosszú nyomás / jobb klikk menüjéből választott útvonalpont */
  onMapPoint?: (role: Role, p: MapPoint) => void
  onSelectAlt?: (i: number) => void
  /** turistaút-vonalra koppintás */
  onSelectTrail?: (id: string) => void
}

export interface RoutePointMarker {
  lat: number
  lon: number
  label: string
  role: Role
}

const ROLE_COLOR: Record<Role, string> = { start: '#15803d', via: '#2563eb', end: '#b91c1c' }

export class MapController {
  readonly map: MlMap
  private meta: Meta
  private ready: Promise<void>
  private isReady = false
  private activeCounties = new Set<string>()
  private pickMode = false
  private popup: Popup | null = null
  private pressTimer: ReturnType<typeof setTimeout> | null = null
  private opts: MapControllerOptions

  constructor(opts: MapControllerOptions) {
    this.opts = opts
    this.meta = opts.meta
    const base = import.meta.env.BASE_URL
    const glyphs = new URL(`${base}fonts/{fontstack}/{range}.pbf`, window.location.href).href
      .replace('%7Bfontstack%7D', '{fontstack}')
      .replace('%7Brange%7D', '{range}')
    this.map = new MlMap({
      container: opts.container,
      style: buildStyle(glyphs),
      ...(opts.view
        ? { center: opts.view.center, zoom: opts.view.zoom, bearing: opts.view.bearing }
        : { bounds: HUNGARY_BOUNDS, fitBoundsOptions: { padding: 16 } }),
      // A tároló méretváltozását a MapLibre maga figyeli (trackResize); felesleges
      // újraméretezés a rajzfelületet kiüríti -> villanás.
      trackResize: true,
      // több csempe marad a memóriában: visszafelé mozgatva nem kell újratölteni
      maxTileCacheSize: 600,
      ...(opts.compat
        ? {
            fadeDuration: 0,
            pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
            canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false, powerPreference: 'default' },
          }
        : {}),
      maxBounds: [
        [13.5, 44.5],
        [25.5, 49.9],
      ],
      attributionControl: { compact: true },
      locale: {
        'NavigationControl.ZoomIn': 'Nagyítás',
        'NavigationControl.ZoomOut': 'Kicsinyítés',
        'NavigationControl.ResetBearing': 'Észak felé',
        'GeolocateControl.FindMyLocation': 'Saját helyem',
        'GeolocateControl.LocationNotAvailable': 'A hely nem érhető el',
        'ScaleControl.Meters': 'm',
        'ScaleControl.Kilometers': 'km',
      },
    })
    this.map.addControl(new NavigationControl({ showCompass: true }), 'top-right')
    this.map.addControl(
      new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
      'top-right',
    )
    this.map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')

    this.ready = new Promise((resolve) => {
      this.map.on('load', async () => {
        await addCategoryIcons(this.map, this.meta.categories)
        // Saját jelző: a map.isStyleLoaded() a forrásbetöltés alatt is hamis,
        // arra várni végtelen mikrotaszk-ciklust okozna.
        this.isReady = true
        this.setBasemap(opts.basemap)
        this.setTrails(opts.trails)
        resolve()
      })
    })
    // a hiányzó ikonokat (pl. stílusváltás után) újra legyártjuk
    this.map.on('styleimagemissing', () => void addCategoryIcons(this.map, this.meta.categories))

    for (const layer of POI_LAYERS) {
      this.map.on('click', layer, (e: MapLayerMouseEvent) => {
        if (this.pickMode) return // a térképkattintás kezeli
        const f = e.features?.[0]
        if (f) opts.onSelect(String(f.properties.id))
      })
      this.map.on('mouseenter', layer, () => {
        if (!this.pickMode) this.map.getCanvas().style.cursor = 'pointer'
      })
      this.map.on('mouseleave', layer, () => {
        if (!this.pickMode) this.map.getCanvas().style.cursor = ''
      })
    }
    this.map.on('click', 'route-alt', (e: MapLayerMouseEvent) => {
      if (this.pickMode) return
      const f = e.features?.[0]
      if (f) opts.onSelectAlt?.(Number(f.properties.i))
    })
    this.map.on('click', (e: MapMouseEvent) => {
      if (this.pickMode) {
        opts.onPick?.(this.pointAt(e))
        return
      }
      // turistaút-vonal (ha nem egy látnivalóra koppintott)
      if (!opts.onSelectTrail || !this.map.getLayer('trail-line')) return
      const r = 6
      const box: [[number, number], [number, number]] = [
        [e.point.x - r, e.point.y - r],
        [e.point.x + r, e.point.y + r],
      ]
      const poi = this.map.queryRenderedFeatures(box, { layers: POI_LAYERS.filter((l) => this.map.getLayer(l)) })
      if (poi.length) return
      const tr = this.map.queryRenderedFeatures(box, { layers: ['trail-line'] })
      if (tr[0]) opts.onSelectTrail(String(tr[0].properties.id))
    })

    // hosszú nyomás (érintés) és jobb klikk: útvonalpont-menü
    this.map.on('contextmenu', (e: MapMouseEvent) => this.openPointMenu(e))
    this.map.on('touchstart', (e: MapTouchEvent) => {
      this.cancelPress()
      if (e.originalEvent.touches.length !== 1) return
      const start = e.point
      this.pressTimer = setTimeout(() => {
        this.pressTimer = null
        this.openPointMenu(e)
      }, LONG_PRESS_MS)
      const move = (m: MapTouchEvent) => {
        if (Math.hypot(m.point.x - start.x, m.point.y - start.y) > 10) this.cancelPress()
      }
      this.map.once('touchmove', move)
    })
    this.map.on('touchend', () => this.cancelPress())
    this.map.on('movestart', () => this.cancelPress())
  }

  whenReady(): Promise<void> {
    return this.ready
  }

  private cancelPress(): void {
    if (this.pressTimer) clearTimeout(this.pressTimer)
    this.pressTimer = null
  }

  private pointAt(e: MapMouseEvent | MapTouchEvent): MapPoint {
    const feats: MapGeoJSONFeature[] = this.map.queryRenderedFeatures(e.point, {
      layers: POI_LAYERS.filter((l) => this.map.getLayer(l)),
    })
    const f = feats[0]
    if (f && f.geometry.type === 'Point') {
      const [lon, lat] = f.geometry.coordinates
      return { lat, lon, poiId: String(f.properties.id) }
    }
    return { lat: e.lngLat.lat, lon: e.lngLat.lng }
  }

  private openPointMenu(e: MapMouseEvent | MapTouchEvent): void {
    if (!this.opts.onMapPoint) return
    const p = this.pointAt(e)
    this.popup?.remove()
    const el = document.createElement('div')
    el.className = 'point-menu'
    el.setAttribute('data-testid', 'point-menu')
    const items: [Role, string][] = [
      ['start', 'Indulás innen'],
      ['via', 'Útba ejtem'],
      ['end', 'Útvonal ide'],
    ]
    for (const [role, label] of items) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.setAttribute('data-testid', `ctx-${role}`)
      b.addEventListener('click', () => {
        this.popup?.remove()
        this.opts.onMapPoint?.(role, p)
      })
      el.appendChild(b)
    }
    this.popup = new Popup({ closeButton: true, closeOnClick: true, offset: 8, maxWidth: '220px' })
      .setLngLat([p.lon, p.lat])
      .setDOMContent(el)
      .addTo(this.map)
  }

  async setCounties(fc: GeoJSON.FeatureCollection): Promise<void> {
    await this.ready
    const withIds = {
      ...fc,
      features: fc.features.map((f, i) => ({ ...f, id: i })),
    }
    ;(this.map.getSource('counties') as GeoJSONSource).setData(withIds)
    this.countyFeatureIds = new Map(withIds.features.map((f) => [String(f.properties?.code), f.id as number]))
    this.applyCountyState()
  }

  private countyFeatureIds = new Map<string, number>()

  private applyCountyState(): void {
    for (const [code, fid] of this.countyFeatureIds) {
      this.map.setFeatureState({ source: 'counties', id: fid }, { active: this.activeCounties.has(code) })
    }
  }

  /** A térkép széleitől hagyott hely; a jobb oldalon a nagyítógombok vannak. */
  private padding() {
    const c = this.map.getContainer()
    const p = Math.round(Math.max(8, Math.min(40, c.clientWidth * 0.06, c.clientHeight * 0.06)))
    return { top: p, bottom: p, left: p, right: p + (c.clientWidth > 320 ? 40 : 0) }
  }

  async setActiveCounties(codes: string[], fc: GeoJSON.FeatureCollection, fit: boolean): Promise<void> {
    await this.ready
    this.activeCounties = new Set(codes)
    this.applyCountyState()
    if (!fit) return
    if (codes.length === 0) {
      this.map.fitBounds(HUNGARY_BOUNDS, { padding: this.padding(), duration: 600 })
      return
    }
    const b = new LngLatBounds()
    for (const f of fc.features) {
      if (!codes.includes(String(f.properties?.code))) continue
      walkCoords(f.geometry, (lon, lat) => b.extend([lon, lat]))
    }
    if (!b.isEmpty()) this.map.fitBounds(b, { padding: this.padding(), duration: 600, maxZoom: 11 })
  }

  async setPois(index: PoiIndex, indices: Uint32Array): Promise<void> {
    await this.ready
    const cats = this.meta.categories
    const features: GeoJSON.Feature<GeoJSON.Point>[] = new Array(indices.length)
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k]
      const cat = index.cats[index.cat[i]]
      features[k] = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [index.lon[i], index.lat[i]] },
        properties: {
          id: index.id[i],
          name: index.name[i],
          cat,
          color: cats[cat]?.color ?? '#555',
          tier: index.tier[i],
          score: index.score[i],
        },
      }
    }
    ;(this.map.getSource('pois') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
    // Kevés találatnál (pl. „Pest + templom”) minden ikon már kis nagyításnál
    // látszódjon; sok pontnál a kevésbé fontosak csak közelebbről.
    const few = indices.length <= FEW_POIS
    this.map.setLayerZoomRange('poi-t2', few ? 0 : 9, 24)
    this.map.setLayerZoomRange('poi-t3', few ? 0 : 12, 24)
  }

  async setSelected(index: PoiIndex, id: string | null, fly: boolean): Promise<void> {
    await this.ready
    const src = this.map.getSource('selected') as GeoJSONSource
    const i = id ? index.byId.get(id) : undefined
    if (i === undefined) {
      src.setData(EMPTY)
      return
    }
    const coords: [number, number] = [index.lon[i], index.lat[i]]
    src.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} })
    // a térkép már csak a látható területet foglalja el -> egyszerűen középre visszük
    if (fly) this.map.flyTo({ center: coords, zoom: Math.max(this.map.getZoom(), 12.5), duration: 800 })
  }

  async setRoute(alts: RouteAlt[], active: number): Promise<void> {
    await this.ready
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = alts.map((a, i) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: a.coords },
      properties: { i, active: i === active },
    }))
    // az aktív legyen legfelül (a szürke változatok alatta)
    features.sort((a, b) => Number(a.properties?.active) - Number(b.properties?.active))
    ;(this.map.getSource('route') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
  }

  async setRoutePoints(points: RoutePointMarker[]): Promise<void> {
    await this.ready
    ;(this.map.getSource('route-pts') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { label: p.label, color: ROLE_COLOR[p.role] },
      })),
    })
  }

  async fitRoute(coords: [number, number][]): Promise<void> {
    await this.ready
    if (coords.length < 2) return
    const b = new LngLatBounds()
    for (const c of coords) b.extend(c)
    this.map.fitBounds(b, { padding: this.padding(), duration: 700, maxZoom: 15 })
  }

  async setTrailLines(fc: GeoJSON.FeatureCollection): Promise<void> {
    await this.ready
    ;(this.map.getSource('trail-lines') as GeoJSONSource).setData(fc)
  }

  async fitBox(b: [number, number, number, number]): Promise<void> {
    await this.ready
    this.map.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { padding: this.padding(), duration: 700, maxZoom: 15 },
    )
  }

  setPickMode(on: boolean): void {
    this.pickMode = on
    this.map.getCanvas().style.cursor = on ? 'crosshair' : ''
  }

  setBasemap(b: Basemap): void {
    if (!this.isReady) {
      void this.ready.then(() => this.setBasemap(b))
      return
    }
    const vis = (on: boolean) => (on ? 'visible' : 'none')
    this.map.setLayoutProperty('topo', 'visibility', vis(b === 'topo'))
    this.map.setLayoutProperty('osm', 'visibility', vis(b === 'osm'))
    this.map.setLayoutProperty('sat', 'visibility', vis(b === 'sat'))
    this.map.setLayoutProperty('sat-labels', 'visibility', vis(b === 'sat'))
  }

  setTrails(on: boolean): void {
    if (!this.isReady) {
      void this.ready.then(() => this.setTrails(on))
      return
    }
    this.map.setLayoutProperty('trails', 'visibility', on ? 'visible' : 'none')
  }

  resize(): void {
    this.map.resize()
  }

  getView(): MapView {
    const c = this.map.getCenter()
    return { center: [c.lng, c.lat], zoom: this.map.getZoom(), bearing: this.map.getBearing() }
  }

  destroy(): void {
    this.cancelPress()
    this.popup?.remove()
    this.map.remove()
  }
}

function walkCoords(g: GeoJSON.Geometry, fn: (lon: number, lat: number) => void): void {
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') fn(c[0] as number, c[1] as number)
    else if (Array.isArray(c)) c.forEach(visit)
  }
  if (g.type === 'GeometryCollection') g.geometries.forEach((x) => walkCoords(x, fn))
  else visit((g as GeoJSON.Polygon).coordinates)
}
