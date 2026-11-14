import { useCallback, useEffect, useRef, useState } from 'react'
import { loadData } from './data/load'
import { parseHash, toHash } from './filters/urlState'
import { formatCount } from './filters/text'
import type { MapController } from './map/MapController'
import { type Basemap, useStore } from './state/store'
import { About } from './ui/About'
import { FilterPanel } from './ui/FilterPanel'
import { MapView } from './ui/MapView'
import { PoiCard } from './ui/PoiCard'
import { ResultList } from './ui/ResultList'
import { Sheet, type SheetState } from './ui/Sheet'
import { UpdateToast } from './ui/UpdateToast'

function initialBasemap(): Basemap {
  const q = new URLSearchParams(window.location.search).get('basemap')
  return q === 'none' || q === 'osm' || q === 'topo' ? q : 'topo'
}

export function App() {
  const data = useStore((s) => s.data)
  const error = useStore((s) => s.error)
  const selected = useStore((s) => s.selected)
  const tab = useStore((s) => s.tab)
  const result = useStore((s) => s.result)
  const basemap = useStore((s) => s.basemap)
  const trails = useStore((s) => s.trails)
  const { setData, setError, replaceFilters, select, setTab, setBasemap, setTrails, setAboutOpen } =
    useStore.getState()
  const [sheet, setSheet] = useState<SheetState>('peek')
  const mapCtl = useRef<MapController | null>(null)

  // adatok betöltése + kezdeti állapot a URL-ből
  useEffect(() => {
    setBasemap(initialBasemap())
    loadData()
      .then((d) => {
        const st = parseHash(window.location.hash, d.index.counties, d.index.cats)
        useStore.setState({ filters: st.filters })
        setData(d)
        if (st.selected && d.index.byId.has(st.selected)) select(st.selected)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [setBasemap, setData, setError, select])

  // állapot -> URL hash
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (!s.data || (s.filters === prev.filters && s.selected === prev.selected)) return
        const hash = toHash({ filters: s.filters, selected: s.selected })
        if (hash !== window.location.hash && !(hash === '' && window.location.hash === '')) {
          history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
        }
      }),
    [],
  )

  // URL hash -> állapot (vissza gomb, kézzel szerkesztett link)
  useEffect(() => {
    const onHash = () => {
      const d = useStore.getState().data
      if (!d) return
      const st = parseHash(window.location.hash, d.index.counties, d.index.cats)
      replaceFilters(st.filters)
      select(st.selected && d.index.byId.has(st.selected) ? st.selected : null)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [replaceFilters, select])

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

  useEffect(() => {
    if (selected) setSheet((s) => (s === 'peek' ? 'half' : s))
  }, [selected])

  const onController = useCallback((c: MapController | null) => {
    mapCtl.current = c
  }, [])

  useEffect(() => {
    // a panel átméretezése után a térkép is igazodjon
    const t = setTimeout(() => mapCtl.current?.resize(), 260)
    return () => clearTimeout(t)
  }, [sheet])

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

  const header = selected ? null : (
    <div className="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'filters'}
        className={tab === 'filters' ? 'on' : ''}
        onClick={() => setTab('filters')}
        data-testid="tab-filters"
      >
        Szűrők
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'list'}
        className={tab === 'list' ? 'on' : ''}
        onClick={() => {
          setTab('list')
          setSheet((s) => (s === 'peek' ? 'half' : s))
        }}
        data-testid="tab-list"
      >
        Lista <span className="tab-count">{formatCount(result.indices.length)}</span>
      </button>
    </div>
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={26} height={26} />
          <h1>Magyarország látnivalói</h1>
        </div>
        <div className="topbar-actions">
          <label className="basemap">
            <span className="visually-hidden">Alaptérkép</span>
            <select value={basemap} onChange={(e) => setBasemap(e.target.value as Basemap)} data-testid="basemap">
              <option value="topo">Turistatérkép</option>
              <option value="osm">OpenStreetMap</option>
              <option value="none">Alaptérkép nélkül</option>
            </select>
          </label>
          <label className="toggle compact" title="Jelzett turistautak">
            <input type="checkbox" checked={trails} onChange={(e) => setTrails(e.target.checked)} />
            <span>Turistautak</span>
          </label>
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
      <main className="main">
        <MapView onController={onController} />
        <Sheet state={sheet} onState={setSheet} header={header}>
          {selected ? (
            <PoiCard id={selected} onClose={() => select(null)} />
          ) : tab === 'filters' ? (
            <FilterPanel />
          ) : (
            <ResultList onPick={onPick} />
          )}
        </Sheet>
      </main>
      <About />
      <UpdateToast />
    </div>
  )
}
