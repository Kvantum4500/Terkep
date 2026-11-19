// A térkép stílusa (források és rétegek) – külön modulban, hogy egységteszt
// ellenőrizhesse a stílusspecifikáció szerint (egy hibás kifejezés az egész térképet
// betöltetlenül hagyná).

import type { StyleSpecification } from 'maplibre-gl'

const ATTR_OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> közreműködők'
const ATTR_ESRI = 'Műhold: © Esri, Maxar, Earthstar Geographics, GIS User Community'
export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const RASTER_PAINT = { 'raster-fade-duration': 0 }

export function buildStyle(glyphs: string): StyleSpecification {
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
      'trail-lines': { type: 'geojson', data: EMPTY },
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
        id: 'trail-casing',
        type: 'line',
        source: 'trail-lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#ffffff',
          // a zoom-interpoláció csak a legkülső kifejezés lehet
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, ['case', ['get', 'sel'], 8, 3.5], 14, ['case', ['get', 'sel'], 11, 6.5]],
        },
      },
      {
        id: 'trail-line',
        type: 'line',
        source: 'trail-lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, ['case', ['get', 'sel'], 4.5, 1.8], 14, ['case', ['get', 'sel'], 7, 3.5]],
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
