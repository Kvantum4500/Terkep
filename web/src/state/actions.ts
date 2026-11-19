// Felhasználói műveletek, amelyek a böngésző-előzményeket is kezelik: a kártya és az
// útvonal-nézet saját bejegyzést kap, így Androidon a Vissza gomb ezeket zárja be,
// és nem lép ki az appból.

import type { Role, Waypoint } from '../route/types'
import { type SheetTab, useStore } from './store'

export type Layer = 'card' | 'route' | 'trail'

export function currentLayer(): Layer | null {
  return ((history.state as { terkep?: Layer } | null)?.terkep ?? null) as Layer | null
}

export function pushLayer(layer: Layer, url = window.location.href, extra: Record<string, unknown> = {}): void {
  history.pushState({ terkep: layer, ...extra }, '', url)
}

interface TrailState {
  terkep: 'trail'
  id: string
  /** hány egymás utáni turistaút-bejegyzés van (a bezárás ennyit lép vissza) */
  depth: number
}

function trailState(): TrailState | null {
  const st = history.state as TrailState | null
  return st?.terkep === 'trail' ? st : null
}

export function replaceLayer(layer: Layer | null, url = window.location.href): void {
  history.replaceState(layer ? { terkep: layer } : null, '', url)
}

/** A kártya bezárása: ha saját előzmény-bejegyzése van, visszalépünk (mint a Vissza gomb). */
export function closeCard(): void {
  if (currentLayer() === 'card') history.back()
  else useStore.getState().select(null)
}

export function openRouteTab(): void {
  const st = useStore.getState()
  const layer = currentLayer()
  if (layer === 'card') replaceLayer('route')
  else if (layer !== 'route') pushLayer('route')
  st.select(null)
  st.setTab('route')
  if (!st.panelOpen) st.setPanelOpen(true)
}

/** Fülváltás: az útvonal-nézetből kilépve a saját előzmény-bejegyzését is lezárjuk. */
export function switchTab(tab: SheetTab): void {
  if (tab === 'route') {
    openRouteTab()
    return
  }
  useStore.getState().setTab(tab)
  if (currentLayer() === 'route') history.back()
}

/** A Vissza gomb (popstate) után a nézet igazítása az előzmény-bejegyzéshez. */
export function onHistoryLayer(): void {
  const st = useStore.getState()
  const layer = currentLayer()
  if (layer !== 'route' && layer !== 'card' && st.tab === 'route') st.setTab('filters')
  // turistaút-bejegyzés: annak az útnak a kártyája (pl. szakaszból vissza a szülőhöz);
  // alatta lévő bejegyzésre visszalépve a kártya bezárul
  const ts = trailState()
  if (ts) {
    if (st.selectedTrail !== ts.id) st.setSelectedTrail(ts.id)
  } else if (layer !== 'card' && st.selectedTrail) st.setSelectedTrail(null)
}

/** Turistaút kiválasztása (saját előzmény-bejegyzéssel: a Vissza gomb bezárja). */
export function openTrail(id: string): void {
  const st = useStore.getState()
  const layer = currentLayer()
  const ts = trailState()
  if (layer === 'card') {
    // a látnivaló-kártya helyére (a Vissza az előző nézetbe visz)
    history.replaceState({ terkep: 'trail', id, depth: 1 } satisfies TrailState, '', window.location.href)
  } else if (!ts || ts.id !== id) {
    // szakaszról szakaszra: minden út saját bejegyzést kap, a Vissza az előzőhöz lép
    pushLayer('trail', window.location.href, { id, depth: ts ? ts.depth + 1 : 1 })
  }
  st.select(null)
  st.setSelectedTrail(id)
  if (!st.panelOpen) st.setPanelOpen(true)
}

/** A turistaút-kártya bezárása (az összes egymás utáni turistaút-bejegyzésen át). */
export function closeTrail(): void {
  const ts = trailState()
  if (ts) history.go(-ts.depth)
  else useStore.getState().setSelectedTrail(null)
}

export function locateMe(): Promise<Waypoint> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('A böngésző nem adja meg a helyet.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'Saját helyem', me: true }),
      () => reject(new Error('A saját hely nem érhető el (engedélyezd a helymeghatározást).')),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  })
}

/** Útvonalpont hozzáadása és az útvonal-nézet megnyitása. Célnál, ha nincs még
 *  indulás, a saját helyről indulunk (ha a böngésző megadja). */
export function routeTo(wp: Waypoint, role: Role): void {
  const st = useStore.getState()
  st.addWaypoint(wp, role)
  openRouteTab()
  if (role !== 'start' && !useStore.getState().route.plan.start) {
    locateMe()
      .then((me) => {
        if (!useStore.getState().route.plan.start) useStore.getState().addWaypoint(me, 'start')
      })
      .catch(() => {
        /* az útvonalpanel jelzi, hogy indulási pont kell */
      })
  }
}

export function poiWaypoint(id: string): Waypoint | null {
  const d = useStore.getState().data
  const i = d?.index.byId.get(id)
  if (!d || i === undefined) return null
  return { lat: d.index.lat[i], lon: d.index.lon[i], name: d.index.name[i], poiId: id }
}

export function pointWaypoint(lat: number, lon: number, poiId?: string): Waypoint {
  if (poiId) {
    const w = poiWaypoint(poiId)
    if (w) return w
  }
  const f = (x: number) => x.toLocaleString('hu-HU', { maximumFractionDigits: 4, minimumFractionDigits: 4 })
  return { lat, lon, name: `Térképi pont (${f(lat)}; ${f(lon)})` }
}
