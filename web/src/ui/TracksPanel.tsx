import { useMemo, useRef, useState } from 'react'
import { formatDuration, formatKm } from '../route/engine'
import { isNative, saveTextFile } from '../native/files'
import { useStore } from '../state/store'
import {
  discardRecording,
  finishRecording,
  importGpx,
  pauseRecording,
  removeTrack,
  resumeRecording,
  startRecording,
  trackLine,
  updateTrack,
} from '../track/controller'
import type { Track } from '../track/db'
import { trackStats } from '../track/geom'
import { trackToGpx } from '../track/gpx'

function download(name: string, text: string) {
  void saveTextFile(`${name.replace(/[^\p{L}\p{N} _.-]+/gu, '').trim() || 'tura'}.gpx`, text, 'application/gpx+xml')
}

/** Saját túrák: rögzítés, GPX-betöltés, lista, kézi igazítás. Minden csak a készüléken marad. */
export function TracksPanel({ onFit }: { onFit: (coords: [number, number][]) => void }) {
  const tracks = useStore((s) => s.tracks)
  const rec = useStore((s) => s.rec)
  const trackSel = useStore((s) => s.trackSel)
  const trackEdit = useStore((s) => s.trackEdit)
  const { setTrackSel, setTrackEdit } = useStore.getState()
  const [importError, setImportError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const live = useMemo(() => trackStats(rec.points), [rec.points])
  const editing = tracks.find((t) => t.id === trackEdit)

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setImportError(null)
    try {
      const t = await importGpx(await f.text(), f.name)
      setTrackSel(t.id)
      onFit(trackLine(t))
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'A fájl nem olvasható.')
    }
    if (file.current) file.current.value = ''
  }

  if (editing) return <TrackEditor track={editing} onDone={() => setTrackEdit(null)} />

  return (
    <section className="tracks" data-testid="tracks-panel" aria-label="Saját túrák">
      <div className="rec-box" data-testid="rec-box">
        {rec.status === 'off' && (
          <>
            <button type="button" className="btn rec" onClick={() => void startRecording()} data-testid="rec-start">
              ● Rögzítés indítása
            </button>
            <p className="hint">
              {rec.native || isNative()
                ? 'Az app a háttérben és lezárt képernyőnél is rögzít (értesítés jelzi).'
                : 'A böngészőben csak bekapcsolt képernyővel rögzít (a képernyő ébren marad). Az Android-appban a háttérben is.'}
            </p>
          </>
        )}
        {rec.status !== 'off' && (
          <>
            <p className="rec-stats" data-testid="rec-stats">
              {rec.status === 'on' ? <span className="rec-dot" aria-hidden="true" /> : null}
              {rec.status === 'on' ? 'Rögzítés' : 'Szünetel'} · {formatKm(live.km)} · {formatDuration(live.durationS)}
              {live.ascent !== undefined ? ` · ↑ ${live.ascent} m` : ''} · {rec.points.length} pont
            </p>
            <div className="actions">
              {rec.status === 'on' ? (
                <button type="button" className="btn secondary" onClick={() => void pauseRecording()} data-testid="rec-pause">
                  Szünet
                </button>
              ) : (
                <button type="button" className="btn secondary" onClick={() => void resumeRecording()} data-testid="rec-resume">
                  Folytatás
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const t = await finishRecording()
                  if (t) setTrackSel(t.id)
                }}
                data-testid="rec-finish"
              >
                Befejezés és mentés
              </button>
              {rec.status === 'paused' && (
                <button type="button" className="link-btn" onClick={() => void discardRecording()}>
                  Elvetés
                </button>
              )}
            </div>
          </>
        )}
        {rec.error && (
          <p className="notice" role="alert">
            {rec.error}
          </p>
        )}
      </div>

      <div className="actions">
        <button type="button" className="btn secondary" onClick={() => file.current?.click()} data-testid="gpx-import-btn">
          GPX betöltése
        </button>
        <input
          ref={file}
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          hidden
          onChange={(e) => void onFile(e.target.files?.[0])}
          data-testid="gpx-import"
        />
      </div>
      {importError && <p className="notice">{importError}</p>}

      <h3 className="tracks-title">Túráim ({tracks.length})</h3>
      {tracks.length === 0 && <p className="hint">Még nincs mentett túra. Rögzíts egyet, vagy tölts be GPX-et.</p>}
      <ul className="track-list">
        {tracks.map((t) => {
          const s = trackStats(t.points, trackLine(t))
          return (
            <li key={t.id} className={t.id === trackSel ? 'sel' : ''} data-testid="track-row">
              <button
                type="button"
                className="along-name"
                onClick={() => {
                  setTrackSel(t.id)
                  onFit(trackLine(t))
                }}
              >
                <span className="track-swatch" aria-hidden="true" />
                <span>
                  <span className="result-name">{t.name}</span>
                  <span className="result-sub">
                    {new Date(t.created).toLocaleDateString('hu-HU')} · {formatKm(s.km)}
                    {s.durationS ? ` · ${formatDuration(s.durationS)}` : ''}
                    {t.anchors.length ? ` · ${t.anchors.length} igazítás` : ''}
                    {t.source === 'gpx' ? ' · GPX' : ''}
                  </span>
                </span>
              </button>
              <div className="track-actions">
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={() => {
                    setTrackSel(t.id)
                    setTrackEdit(t.id)
                    onFit(trackLine(t))
                  }}
                  data-testid="track-edit"
                >
                  Igazítás
                </button>
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={() => download(t.name, trackToGpx(t.name, trackLine(t).map(([lon, lat]) => ({ lon, lat }))))}
                >
                  GPX
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`${t.name} törlése`}
                  onClick={() => {
                    if (window.confirm(`Törlöd: ${t.name}?`)) void removeTrack(t.id)
                  }}
                >
                  🗑
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="hint">A túrák csak ezen a készüléken tárolódnak.</p>
    </section>
  )
}

function TrackEditor({ track, onDone }: { track: Track; onDone: () => void }) {
  const [name, setName] = useState(track.name)
  const matched = track.snap && track.matchedKey !== undefined && track.matched
  return (
    <section className="tracks" data-testid="track-editor" aria-label="Nyomvonal igazítása">
      <h2 className="editor-title">Igazítás: {track.name}</h2>
      <label className="search">
        <span className="visually-hidden">Név</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== track.name && void updateTrack({ ...track, name: name.trim() })}
          data-testid="track-name"
        />
      </label>
      <ol className="howto">
        <li>Ahol a GPS elcsúszott, nyomj hosszan a vonalra (egérrel: jobb klikk): rögzítési pont jön létre.</li>
        <li>Húzd a pontot a helyes helyre – a vonal két szomszédos pont között simán követi.</li>
        <li>Egy pontra koppintva törölheted.</li>
      </ol>
      <label className="toggle">
        <input
          type="checkbox"
          checked={track.snap}
          onChange={(e) => void updateTrack({ ...track, snap: e.target.checked })}
          data-testid="track-snap"
        />
        <span>Igazítás a valószínű útra (úthálózat, jelzett turistaút)</span>
      </label>
      {track.snap && <p className="hint">{matched ? 'Ráillesztve.' : 'Ráillesztés folyamatban…'}</p>}
      <p className="hint" data-testid="anchor-count">
        Rögzítési pontok: {track.anchors.length}
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={onDone} data-testid="track-edit-done">
          Kész
        </button>
        {track.anchors.length > 0 && (
          <button type="button" className="btn secondary" onClick={() => void updateTrack({ ...track, anchors: [] })}>
            Eredeti visszaállítása
          </button>
        )}
      </div>
    </section>
  )
}
