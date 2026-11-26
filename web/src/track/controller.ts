// Rögzítés és nyomvonal-műveletek (a store és a készülékes tárolás között).

import { useStore } from '../state/store'
import { deleteTrack, newId, saveRecording, saveTrack, type Track } from './db'
import { applyAnchors, type LonLat, nearestIndex } from './geom'
import { parseGpx } from './gpx'
import { acceptFix, createRecorder, fixToPoint, type Recorder } from './recorder'

let recorder: Recorder | null = null

/** A megjelenítendő vonal: ráillesztve (ha be van kapcsolva és kész), különben a kézzel igazított. */
export function trackLine(t: Track): LonLat[] {
  if (t.snap && t.matched && t.matchedKey === matchKey(t)) return t.matched
  return applyAnchors(t.points, t.anchors)
}

/** A ráillesztés bemenetének kulcsa: ha változik (új rögzítési pont), újra kell illeszteni. */
export function matchKey(t: Track): string {
  return JSON.stringify([t.points.length, t.anchors.map((a) => [a.i, a.lon.toFixed(6), a.lat.toFixed(6)])])
}

function defaultName(ts: number): string {
  return `Túra ${new Date(ts).toLocaleString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
}

async function begin(): Promise<void> {
  const st = useStore.getState()
  recorder = await createRecorder()
  st.setRec({ status: 'on', error: null, native: recorder.native })
  await recorder.start(
    (f) => {
      const s = useStore.getState()
      if (s.rec.status !== 'on') return
      const last = s.rec.points[s.rec.points.length - 1]
      if (!acceptFix(last, f)) return
      const points = [...s.rec.points, fixToPoint(f)]
      s.setRec({ points })
      // időnként a készülékre is (újratöltés, összeomlás után folytatható)
      if (points.length % 10 === 0) void saveRecording({ points, started: s.rec.started ?? Date.now() })
    },
    (msg) => useStore.getState().setRec({ error: msg }),
  )
}

export async function startRecording(): Promise<void> {
  useStore.getState().setRec({ points: [], started: Date.now() })
  await begin()
}

export async function pauseRecording(): Promise<void> {
  await recorder?.stop()
  recorder = null
  const s = useStore.getState()
  s.setRec({ status: 'paused' })
  await saveRecording({ points: s.rec.points, started: s.rec.started ?? Date.now() })
}

export async function resumeRecording(): Promise<void> {
  await begin()
}

export async function finishRecording(name?: string): Promise<Track | null> {
  await recorder?.stop()
  recorder = null
  const s = useStore.getState()
  const pts = s.rec.points
  s.setRec({ status: 'off', points: [], started: null, error: null })
  await saveRecording(null)
  if (pts.length < 2) return null
  const t: Track = {
    id: newId(),
    name: name || defaultName(s.rec.started ?? pts[0].t ?? Date.now()),
    created: Date.now(),
    source: 'gps',
    points: pts,
    anchors: [],
    snap: true,
  }
  await saveTrack(t)
  useStore.getState().upsertTrack(t)
  return t
}

export async function discardRecording(): Promise<void> {
  await recorder?.stop()
  recorder = null
  useStore.getState().setRec({ status: 'off', points: [], started: null, error: null })
  await saveRecording(null)
}

export async function importGpx(text: string, fileName: string): Promise<Track> {
  const g = parseGpx(text)
  if (g.points.length < 2) throw new Error('A fájlban nincs nyomvonal.')
  const t: Track = {
    id: newId(),
    name: g.name || fileName.replace(/\.gpx$/i, ''),
    created: Date.now(),
    source: 'gpx',
    points: g.points,
    anchors: [],
    snap: true,
  }
  await saveTrack(t)
  useStore.getState().upsertTrack(t)
  return t
}

export async function updateTrack(t: Track): Promise<void> {
  useStore.getState().upsertTrack(t)
  await saveTrack(t)
}

export async function removeTrack(id: string): Promise<void> {
  useStore.getState().removeTrackLocal(id)
  await deleteTrack(id)
}

/** Hosszú nyomás a vonalon: rögzítési pont a legközelebbi nyomvonalpontnál (még elmozdítás nélkül). */
export async function addAnchorNear(id: string, lon: number, lat: number): Promise<void> {
  const t = useStore.getState().tracks.find((x) => x.id === id)
  if (!t) return
  const corrected = applyAnchors(t.points, t.anchors)
  const { i } = nearestIndex(corrected, lon, lat)
  if (i < 0 || t.anchors.some((a) => a.i === i)) return
  await updateTrack({ ...t, anchors: [...t.anchors, { i, lon: corrected[i][0], lat: corrected[i][1] }].sort((a, b) => a.i - b.i) })
}

export async function moveAnchor(id: string, i: number, lon: number, lat: number): Promise<void> {
  const t = useStore.getState().tracks.find((x) => x.id === id)
  if (!t) return
  await updateTrack({ ...t, anchors: t.anchors.map((a) => (a.i === i ? { i, lon, lat } : a)) })
}

export async function removeAnchor(id: string, i: number): Promise<void> {
  const t = useStore.getState().tracks.find((x) => x.id === id)
  if (!t) return
  await updateTrack({ ...t, anchors: t.anchors.filter((a) => a.i !== i) })
}
