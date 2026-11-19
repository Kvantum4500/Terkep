// A saját nyomvonalak tárolása a készüléken (IndexedDB). Sosem kerül szerverre vagy a repóba.

import type { Anchor, LonLat, TrackPoint } from './geom'

export interface Track {
  id: string
  name: string
  created: number
  source: 'gps' | 'gpx'
  points: TrackPoint[]
  anchors: Anchor[]
  /** igazítás a valószínű útra */
  snap: boolean
  /** a ráillesztett vonal (gyorsítótár) és hogy milyen bemenetből készült */
  matched?: LonLat[] | null
  matchedKey?: string
}

const DB = 'terkep'
const STORE = 'tracks'
const REC = 'recording'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(REC)) db.createObjectStore(REC)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadTracks(): Promise<Track[]> {
  try {
    const all = await tx<Track[]>(STORE, 'readonly', (s) => s.getAll() as IDBRequest<Track[]>)
    return all.sort((a, b) => b.created - a.created)
  } catch {
    return []
  }
}

export async function saveTrack(t: Track): Promise<void> {
  await tx(STORE, 'readwrite', (s) => s.put(t))
}

export async function deleteTrack(id: string): Promise<void> {
  await tx(STORE, 'readwrite', (s) => s.delete(id))
}

/** A folyamatban lévő rögzítés mentése (újratöltés vagy összeomlás után folytatható). */
export async function saveRecording(r: { points: TrackPoint[]; started: number } | null): Promise<void> {
  try {
    await tx<unknown>(REC, 'readwrite', (s) => (r ? s.put(r, 'current') : s.delete('current')) as IDBRequest<unknown>)
  } catch {
    /* privát mód: nincs tárolás */
  }
}

export async function loadRecording(): Promise<{ points: TrackPoint[]; started: number } | null> {
  try {
    return ((await tx(REC, 'readonly', (s) => s.get('current'))) as { points: TrackPoint[]; started: number }) ?? null
  } catch {
    return null
  }
}

export function newId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
