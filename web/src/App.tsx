import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { loadData } from './data/load'
import { formatCount } from './filters/text'
import { parseHash, toHash } from './filters/urlState'
import type { MapController } from './map/MapController'
import { usePlanner } from './route/usePlanner'
import { useTrackSync } from './track/useTrackSync'
import { closeCard, currentLayer, onHistoryLayer, pushLayer, switchTab } from './state/actions'
import { loadTrailIndex } from './trails/data'
import { type Basemap, useStore } from './state/store'
import { About } from './ui/About'
import { FilterPanel } from './ui/FilterPanel'
import { LayersMenu } from './ui/LayersMenu'
import { MapView } from './ui/MapView'
import { PoiCard } from './ui/PoiCard'
import { ResultList } from './ui/ResultList'
import { RoutePanel } from './ui/RoutePanel'
import { SHEET_HEIGHT, Sheet, type SheetState } from './ui/Sheet'
import { TracksPanel } from './ui/TracksPanel'
import { TrailCard } from './ui/TrailCard'
import { UpdateToast } from './ui/UpdateToast'

const BASEMAPS: Basemap[] = ['topo', 'osm', 'sat', 'none']
const BASEMAP_KEY = 'terkep.basemap'
const COMPAT_KEY = 'terkep.compat'

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function initialBasemap(): Basemap {
  const q = new URLSearchParams(window.location.search).get('basemap') as Basemap | null
  if (q && BASEMAPS.includes(q)) return q
  try {
    const saved = localStorage.getItem(BASEMAP_KEY) as Basemap | null
    if (saved && BASEMAPS.includes(saved)) return saved
  } catch {
    /* privát mód: nincs tárolás */
  }
  return 'topo'
}

export function App() {
  const data = useStore((s) => s.data)
  const error = useStore((s) => s.error)
  const selected = useStore((s) => s.selected)
  const selectedTrail = useStore((s) => s.selectedTrail)
  const tab = useStore((s) => s.tab)
  const result = useStore((s) => s.result)
  const panelOpen = useStore((s) => s.panelOpen)
  const pickRole = useStore((s) => s.pickRole)
  const hasRoute = useStore((s) => !!(s.route.plan.start || s.route.plan.end))
  const recording = useStore((s) => s.rec.status === 'on')
  const { setData, setError, replaceFilters, select, setBasemap, setAboutOpen, setPanelOpen } = useStore.getState()
  const [sheet, setSheet] = useState<SheetState>('peek')
  const [dragH, setDragH] = useState<number | null>(null)
  const mapCtl = useRef<MapController | null>(null)

  usePlanner()
  useTrackSync()

  // adatok betöltése + kezdeti állapot a URL-ből
  useEffect(() => {
    setBasemap(initialBasemap())
    useStore.setState({ compatMap: new URLSearchParams(window.location.search).has('compat') || readFlag(COMPAT_KEY) })
    loadData()
      .then((d) => {
        const st = parseHash(window.location.hash, d.index.counties, d.index.cats)
        useStore.setState({ filters: st.filters })
        setData(d)
        if (st.selected && d.index.byId.has(st.selected)) select(st.selected)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [setBasemap, setData, setError, select])

  // az alaptérkép-választás megmarad (csak ezen a készüléken)
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.basemap === prev.basemap && s.compatMap === prev.compatMap) return
        try {
          localStorage.setItem(BASEMAP_KEY, s.basemap)
          localStorage.setItem(COMPAT_KEY, s.compatMap ? '1' : '0')
        } catch {
          /* privát mód */
        }
      }),
    [],
  )

  // állapot -> URL hash. A kártya megnyitása saját előzmény-bejegyzést kap (Vissza = bezárás).
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (!s.data || (s.filters === prev.filters && s.selected === prev.selected)) return
        const hash = toHash({ filters: s.filters, selected: s.selected })
        const url = `${window.location.pathname}${window.location.search}${hash}`
        if (s.selected && !prev.selected && currentLayer() !== 'card') {
          pushLayer('card', url)
        } else if (hash !== window.location.hash && !(hash === '' && window.location.hash === '')) {
          history.replaceState(history.state, '', url)
        }
      }),
    [],
  )

  // URL hash / előzmények -> állapot (Vissza gomb, kézzel szerkesztett link)
  useEffect(() => {
    const onHash = () => {
      const st = useStore.getState()
      const d = st.data
      if (!d) return
      const parsed = parseHash(window.location.hash, d.index.counties, d.index.cats)
      if (toHash({ filters: st.filters, selected: null }) !== toHash({ filters: parsed.filters, selected: null })) {
        replaceFilters(parsed.filters)
      }
      const sel = parsed.selected && d.index.byId.has(parsed.selected) ? parsed.selected : null
      if (sel !== st.selected) select(sel)
    }
    const onPop = () => {
      onHash()
      onHistoryLayer()
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('popstate', onPop)
    }
  }, [replaceFilters, select])

  // Esc: kártya bezárása
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const st = useStore.getState()
      if (st.pickRole) st.setPickRole(null)
      else if (st.selected && !st.aboutOpen) closeCard()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // tesztkampó (Playwright): a látható találatok adatai
  useEffect(() => {
    ;(window as unknown as { __terkep: unknown }).__terkep = {
      state: () => useStore.getState(),
      visible: () => {
        const s = useStore.getState()
        if (!s.data || !s.result) return []
        const ix = s.data.index
        return Array.from(s.result.indices, (i) => ({
          id: ix.id[i],
          name: ix.name[i],
          cat: ix.cats[ix.cat[i]],
          county: ix.counties[ix.county[i]],
          tier: ix.tier[i],
        }))
      },
    }
  }, [])

  const onPick = useCallback(
    (id: string) => {
      select(id)
      setSheet((s) => (s === 'peek' ? 'half' : s))
    },
    [select],
  )

  // a kártya / útvonal megnyitásakor a panel legalább félig nyíljon ki
  useEffect(() => {
    if (selected || selectedTrail || tab === 'route') setSheet((s) => (s === 'peek' ? 'half' : s))
  }, [selected, selectedTrail, tab])

  // térképről választáskor a panel összecsukódik (több hely a térképnek), utána visszanyílik
  const prevPick = useRef(pickRole)
  useEffect(() => {
    if (pickRole && !prevPick.current) setSheet('peek')
    if (!pickRole && prevPick.current) setSheet((s) => (s === 'peek' ? 'half' : s))
    prevPick.current = pickRole
  }, [pickRole])

  const onController = useCallback((c: MapController | null) => {
    mapCtl.current = c
  }, [])

  if (error) {
    return (
      <div className="fatal" role="alert">
        <h1>Hiba történt</h1>
        <p>{error}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Újratöltés
        </button>
      </div>
    )
  }
  if (!data || !result) {
    return (
      <div className="loading" role="status">
        <div className="spinner" />
        <p>Látnivalók betöltése…</p>
      </div>
    )
  }

  const tabBtn = (t: 'filters' | 'list' | 'route' | 'tracks', label: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      className={tab === t ? 'on' : ''}
      onClick={() => {
        switchTab(t)
        setSheet((s) => (s === 'peek' ? 'half' : s))
      }}
      data-testid={`tab-${t}`}
    >
      {label}
    </button>
  )

  const header = selected || selectedTrail ? null : (
    <div className="tabs" role="tablist">
      {tabBtn('filters', 'Szűrők')}
      {tabBtn(
        'list',
        <>
          Lista <span className="tab-count">{formatCount(result.indices.length)}</span>
        </>,
      )}
      {tabBtn('route', <>Útvonal{hasRoute && <span className="tab-dot" aria-label="(van útvonal)" />}</>)}
      {tabBtn('tracks', <>Túrák{recording && <span className="tab-dot rec" aria-label="(rögzítés)" />}</>)}
    </div>
  )

  const mainStyle = { '--sheet-h': dragH !== null ? `${dragH}px` : SHEET_HEIGHT[sheet] } as CSSProperties

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={26} height={26} />
          <h1>Magyarország látnivalói</h1>
        </div>
        <div className="topbar-actions">
          <LayersMenu />
          <button type="button" className="icon-btn" onClick={() => setAboutOpen(true)} aria-label="Az adatokról">
            ⓘ
          </button>
        </div>
      </header>
      {data.meta.sample && (
        <div className="banner" data-testid="sample-banner">
          Mintaadat: {formatCount(data.meta.counts.total)} ismert látnivaló, közelítő helyekkel. A teljes adatbázis az
          első adatfrissítés után jelenik meg.
        </div>
      )}
      <main
        className={`main${dragH !== null ? ' dragging' : ''}${panelOpen ? '' : ' panel-closed'}`}
        style={mainStyle}
        data-testid="main"
      >
        <MapView onController={onController} />
        <Sheet state={sheet} onState={setSheet} onDrag={setDragH} header={header} onHidePanel={() => setPanelOpen(false)}>
          {selected ? (
            <PoiCard id={selected} onClose={closeCard} />
          ) : selectedTrail ? (
            <TrailCard
              id={selectedTrail}
              onFit={() =>
                void loadTrailIndex().then((idx) => {
                  const t = idx?.byId.get(selectedTrail)
                  if (t) void mapCtl.current?.fitBox(t.b)
                })
              }
            />
          ) : tab === 'filters' ? (
            <FilterPanel />
          ) : tab === 'list' ? (
            <ResultList onPick={onPick} />
          ) : tab === 'tracks' ? (
            <TracksPanel onFit={(c) => void mapCtl.current?.fitLine(c)} />
          ) : (
            <RoutePanel onPick={onPick} />
          )}
        </Sheet>
      </main>
      <About />
      <UpdateToast />
    </div>
  )
}
