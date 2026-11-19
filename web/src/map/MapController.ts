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
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// A MapLibre 6 háttérszála külön (önálló) modul: a Vite assetként adja ki,
// a service worker pedig előre gyorsítótárazza (offline működés).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Meta, PoiIndex } from '../data/types'
import type { Role, RouteAlt } from '../route/types'
import type { Basemap } from '../state/store'
import { addCategoryIcons } from './icons'

setWorkerUrl(workerUrl)

export const HUNGARY_BOUNDS: LngLatBoundsLike = [
  [16.1, 45.73],
  [22.9, 48.59],
]

const POI_LAYERS = ['poi-t1', 'poi-t2', 'poi-t3', 'poi-dots']
const FEW_POIS = 400
const LONG_PRESS_MS = 550

const ATTR_OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> közreműködők'
const ATTR_ESRI = 'Műhold: © Esri, Maxar, Earthstar Geographics, GIS User Community'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const RASTER_PAINT = { 'raster-fade-duration': 0 }

function style(glyphs: string): StyleSpecification {
  return {
    version: 8,
    glyphs,
    sources: {
      topo: {
        type: 'raster',
        tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: `${ATTR_OSM}, SRTM | Térképstílus: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC BY-SA)`,
      },
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: ATTR_OSM,
      },
      sat: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: ATTR_ESRI,
      },
      'sat-labels': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
      },
      trails: {
        type: 'raster',
        tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Turistautak: © <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a> (CC BY-SA)',
      },
      counties: { type: 'geojson', data: EMPTY },
      pois: { type: 'geojson', data: EMPTY },
      selected: { type: 'geojson', data: EMPTY },
      route: { type: 'geojson', data: EMPTY },
      'route-pts': { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#eef0e8' } },
      { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' }, paint: RASTER_PAINT },
      { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' }, paint: RASTER_PAINT },
      { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' }, paint: RASTER_PAINT },
      { id: 'sat-labels', type: 'raster', source: 'sat-labels', layout: { visibility: 'none' }, paint: RASTER_PAINT },
      { id: 'trails', type: 'raster', source: 'trails', layout: { visibility: 'none' }, paint: { ...RASTER_PAINT, 'raster-opacity': 0.85 } },
      {
        id: 'county-fill',
        type: 'fill',
        source: 'counties',
        paint: {
          'fill-color': '#1d4ed8',
          'fill-opacity': ['case', ['boolean', ['feature-state', 'active'], false], 0.06, 0],
        },
      },
      {
        id: 'county-line',
        type: 'line',
        source: 'counties',
        paint: {
          'line-color': ['case', ['boolean', ['feature-state', 'active'], false], '#1d4ed8', '#5b6470'],
          'line-width': ['case', ['boolean', ['feature-state', 'active'], false], 2.2, 0.9],
          'line-opacity': 0.8,
          'line-dasharray': [3, 1.5],
        },
      },
      {
        id: 'route-alt',
        type: 'line',
        source: 'route',
        filter: ['!', ['get', 'active']],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#64748b', 'line-width': 5, 'line-opacity': 0.75 },
      },
      {
        id: 'route-casing',
        type: 'line',
        source: 'route',
        filter: ['get', 'active'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 9 },
      },
      {
        id: 'route-line',
        type: 'line',
        source: 'route',
        filter: ['get', 'active'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#2563eb', 'line-width': 5.5 },
      },
      {
        id: 'poi-dots',
        type: 'circle',
        source: 'pois',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 2.2, 12, 4],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 0.8,
        },
      },
      symbolLayer('poi-t3', 3, 12, 14, 0.72),
      symbolLayer('poi-t2', 2, 9, 11.5, 0.86),
      symbolLayer('poi-t1', 1, 0, 8, 1),
      {
        id: 'route-pt-circle',
        type: 'circle',
        source: 'route-pts',
        paint: {
          'circle-radius': 11,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5,
        },
      },
      {
        id: 'route-pt-label',
        type: 'symbol',
        source: 'route-pts',
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Medium'],
          'text-size': 12,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff' },
      },
      {
        id: 'selected-ring',
        type: 'circle',
        source: 'selected',
        paint: {
          'circle-radius': 19,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': '#111827',
          'circle-stroke-width': 3,
        },
      },
    ],
  }
}

function symbolLayer(
  id: string,
  tier: number,
  minzoom: number,
  labelZoom: number,
  size: number,
): StyleSpecification['layers'][number] {
  return {
    id,
    type: 'symbol',
    source: 'pois',
    minzoom,
    filter: ['==', ['get', 'tier'], tier],
    layout: {
      'icon-image': ['concat', 'cat-', ['get', 'cat']],
      'icon-size': size,
      'icon-allow-overlap': false,
      'icon-padding': 1,
      'symbol-sort-key': ['-', 0, ['get', 'score']],
      'text-field': ['step', ['zoom'], '', labelZoom, ['get', 'name']],
      'text-font': ['Noto Sans Medium'],
      'text-size': tier === 1 ? 12.5 : 11.5,
      'text-offset': [0, 1.25],
      'text-anchor': 'top',
      'text-max-width': 9,
      'text-optional': true,
    },
    paint: {
      'text-color': '#1f2937',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.8,
    },
  }
}

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
      style: style(glyphs),
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
      if (!this.pickMode) return
      opts.onPick?.(this.pointAt(e))
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
