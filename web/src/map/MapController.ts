// A MapLibre-térkép imperatív vezérlője. A React-komponens csak létrehozza és
// adatot ad neki; a későbbi rétegek (útvonaltervező, nyomvonal) ide kerülnek.

import {
  type GeoJSONSource,
  GeolocateControl,
  LngLatBounds,
  type LngLatBoundsLike,
  Map as MlMap,
  type MapLayerMouseEvent,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// A MapLibre 6 háttérszála külön (önálló) modul: a Vite assetként adja ki,
// a service worker pedig előre gyorsítótárazza (offline működés).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Meta, PoiIndex } from '../data/types'
import type { Basemap } from '../state/store'
import { addCategoryIcons } from './icons'

setWorkerUrl(workerUrl)

export const HUNGARY_BOUNDS: LngLatBoundsLike = [
  [16.1, 45.73],
  [22.9, 48.59],
]

const POI_LAYERS = ['poi-t1', 'poi-t2', 'poi-t3', 'poi-dots']
const FEW_POIS = 400

const ATTR_OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> közreműködők'

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
      trails: {
        type: 'raster',
        tiles: ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Turistautak: © <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a> (CC BY-SA)',
      },
      counties: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      pois: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      selected: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#eef0e8' } },
      { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } },
      { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
      { id: 'trails', type: 'raster', source: 'trails', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } },
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
      'text-halo-width': 1.6,
    },
  }
}

export interface MapControllerOptions {
  container: HTMLElement
  meta: Meta
  basemap: Basemap
  trails: boolean
  onSelect: (id: string | null) => void
}

export class MapController {
  readonly map: MlMap
  private meta: Meta
  private ready: Promise<void>
  private isReady = false
  private activeCounties = new Set<string>()

  constructor(opts: MapControllerOptions) {
    this.meta = opts.meta
    const base = import.meta.env.BASE_URL
    const glyphs = new URL(`${base}fonts/{fontstack}/{range}.pbf`, window.location.href).href
      .replace('%7Bfontstack%7D', '{fontstack}')
      .replace('%7Brange%7D', '{range}')
    this.map = new MlMap({
      container: opts.container,
      style: style(glyphs),
      bounds: HUNGARY_BOUNDS,
      fitBoundsOptions: { padding: mapPadding() },
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
        const f = e.features?.[0]
        if (f) opts.onSelect(String(f.properties.id))
      })
      this.map.on('mouseenter', layer, () => (this.map.getCanvas().style.cursor = 'pointer'))
      this.map.on('mouseleave', layer, () => (this.map.getCanvas().style.cursor = ''))
    }
  }

  whenReady(): Promise<void> {
    return this.ready
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

  async setActiveCounties(codes: string[], fc: GeoJSON.FeatureCollection, fit: boolean): Promise<void> {
    await this.ready
    this.activeCounties = new Set(codes)
    this.applyCountyState()
    if (!fit) return
    if (codes.length === 0) {
      this.map.fitBounds(HUNGARY_BOUNDS, { padding: mapPadding(), duration: 600 })
      return
    }
    const b = new LngLatBounds()
    for (const f of fc.features) {
      if (!codes.includes(String(f.properties?.code))) continue
      walkCoords(f.geometry, (lon, lat) => b.extend([lon, lat]))
    }
    if (!b.isEmpty()) this.map.fitBounds(b, { padding: mapPadding(), duration: 600, maxZoom: 11 })
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
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    const coords: [number, number] = [index.lon[i], index.lat[i]]
    src.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} })
    if (fly) {
      // az eltolás (offset) nem marad meg a kamerán, ellentétben a paddinggel
      const p = mapPadding()
      const offset: [number, number] = [(p.left - p.right) / 2, (p.top - p.bottom) / 2]
      this.map.flyTo({ center: coords, zoom: Math.max(this.map.getZoom(), 12.5), duration: 800, offset })
    }
  }

  setBasemap(b: Basemap): void {
    if (!this.isReady) {
      void this.ready.then(() => this.setBasemap(b))
      return
    }
    this.map.setLayoutProperty('topo', 'visibility', b === 'topo' ? 'visible' : 'none')
    this.map.setLayoutProperty('osm', 'visibility', b === 'osm' ? 'visible' : 'none')
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

  destroy(): void {
    this.map.remove()
  }
}

/** A panel által takart sáv (asztalon bal oldali panel, mobilon az alsó panel). */
function mapPadding() {
  return window.innerWidth >= 900
    ? { top: 30, bottom: 30, left: 420, right: 60 }
    : { top: 20, bottom: 150, left: 16, right: 16 }
}

function walkCoords(g: GeoJSON.Geometry, fn: (lon: number, lat: number) => void): void {
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') fn(c[0] as number, c[1] as number)
    else if (Array.isArray(c)) c.forEach(visit)
  }
  if (g.type === 'GeometryCollection') g.geometries.forEach((x) => walkCoords(x, fn))
  else visit((g as GeoJSON.Polygon).coordinates)
}
