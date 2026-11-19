import { useEffect } from 'react'
import { decodePolyline } from '../route/engine'
import { useStore } from '../state/store'
import { loadTrailGeo, loadTrailIndex, trailIds } from '../trails/data'
import { matchKey, trackLine } from './controller'
import { loadRecording, loadTracks, saveTrack, type Track } from './db'
import { applyAnchors, type LonLat } from './geom'
import { trailProgress } from './progress'
import { matchValhalla, snapToLines } from './snap'

/** A nyomvonal közelében futó jelzett turistautak vonalai (helyi ráillesztéshez). */
async function nearbyTrailLines(line: LonLat[]): Promise<LonLat[][]> {
  const idx = await loadTrailIndex()
  if (!idx || !line.length) return []
  const pad = 0.001
  const xs = line.map((p) => p[0])
  const ys = line.map((p) => p[1])
  const box = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
  const hits = idx.trails.filter((t) => t.b[0] <= box[2] && t.b[2] >= box[0] && t.b[1] <= box[3] && t.b[3] >= box[1])
  const out: LonLat[][] = []
  for (const c of new Set(hits.map((t) => t.c))) {
    const geo = await loadTrailGeo(c)
    for (const t of hits) if (t.c === c) for (const s of geo[t.id] ?? []) out.push(decodePolyline(s, 5))
  }
  return out
}

async function snap(t: Track, signal: AbortSignal): Promise<LonLat[]> {
  const corrected = applyAnchors(t.points, t.anchors)
  const viaValhalla = navigator.onLine
    ? await matchValhalla(
        corrected,
        t.anchors.map((a) => a.i),
        signal,
      )
    : null
  if (viaValhalla) return viaValhalla
  return snapToLines(corrected, await nearbyTrailLines(corrected), 25)
}

/**
 * Nyomvonalak: betöltés a készülékről, a ráillesztés frissítése (ha be van kapcsolva és
 * változott a bemenet), és a kiválasztott turistaút teljesítésének számítása.
 */
export function useTrackSync(): void {
  // betöltés; a félbemaradt rögzítés szünetelő állapotban folytatható
  useEffect(() => {
    void loadTracks().then((t) => useStore.getState().setTracks(t))
    void loadRecording().then((r) => {
      if (r && r.points.length && useStore.getState().rec.status === 'off') {
        useStore.getState().setRec({ status: 'paused', points: r.points, started: r.started })
      }
    })
  }, [])

  // ráillesztés: nyomvonalanként a legutóbbi bemenetre (kis késleltetéssel)
  useEffect(() => {
    const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; ctrl: AbortController }>()
    const check = () => {
      for (const t of useStore.getState().tracks) {
        const key = matchKey(t)
        if (!t.snap || t.matchedKey === key) continue
        const prev = pending.get(t.id)
        if (prev) {
          clearTimeout(prev.timer)
          prev.ctrl.abort()
        }
        const ctrl = new AbortController()
        const timer = setTimeout(async () => {
          const matched = await snap(t, ctrl.signal)
          if (ctrl.signal.aborted) return
          pending.delete(t.id)
          const cur = useStore.getState().tracks.find((x) => x.id === t.id)
          if (!cur || matchKey(cur) !== key) return
          const next = { ...cur, matched, matchedKey: key }
          useStore.getState().upsertTrack(next)
          void saveTrack(next)
        }, 600)
        pending.set(t.id, { timer, ctrl })
      }
    }
    check()
    const unsub = useStore.subscribe((s, p) => {
      if (s.tracks !== p.tracks) check()
    })
    return () => {
      unsub()
      for (const { timer, ctrl } of pending.values()) {
        clearTimeout(timer)
        ctrl.abort()
      }
    }
  }, [])

  // a kiválasztott turistaút teljesítése
  useEffect(() => {
    let gen = 0
    const run = async () => {
      const my = ++gen
      const st = useStore.getState()
      if (!st.selectedTrail || !st.tracks.length) {
        if (st.trailProgress) st.setTrailProgress(null)
        return
      }
      const idx = await loadTrailIndex()
      if (!idx) return
      const ids = trailIds(idx, st.selectedTrail)
      const lines: LonLat[][] = []
      for (const id of ids) {
        const t = idx.byId.get(id)
        if (!t) continue
        const geo = await loadTrailGeo(t.c)
        for (const s of geo[id] ?? []) lines.push(decodePolyline(s, 5))
      }
      const pr = trailProgress(
        lines,
        st.tracks.map((t) => trackLine(t)),
      )
      if (my === gen) useStore.getState().setTrailProgress(pr)
    }
    void run()
    return useStore.subscribe((s, p) => {
      if (s.selectedTrail !== p.selectedTrail || s.tracks !== p.tracks) void run()
    })
  }, [])
}
