// GPS-rögzítés. Böngészőben: watchPosition + képernyő ébren tartása (Wake Lock) – lezárt
// képernyőnél a böngésző leállítja. A natív Android-appban (Capacitor) a háttérben is
// rögzítő bővítmény fut (lásd nativeRecorder.ts), ugyanezzel a felülettel.

import { haversineM } from '../route/geo'
import type { TrackPoint } from './geom'

export interface Fix {
  lat: number
  lon: number
  /** pontosság (m) */
  acc?: number
  ele?: number | null
  t: number
}

export interface Recorder {
  readonly native: boolean
  start(onPoint: (f: Fix) => void, onError: (msg: string) => void): Promise<void>
  stop(): Promise<void>
}

/** Pontszűrés: a pontatlan (> maxAcc m) és a túl közeli (< minM m) pontok kimaradnak. */
export function acceptFix(prev: TrackPoint | undefined, f: Fix, minM = 5, maxAcc = 40): boolean {
  if (f.acc !== undefined && f.acc > maxAcc) return false
  if (!prev) return true
  return haversineM(prev.lat, prev.lon, f.lat, f.lon) >= minM
}

export function fixToPoint(f: Fix): TrackPoint {
  return { lon: f.lon, lat: f.lat, t: f.t, ...(f.ele !== undefined && f.ele !== null ? { ele: f.ele } : {}) }
}

interface WakeLockSentinelLike {
  release(): Promise<void>
}

export function webRecorder(): Recorder {
  let watch: number | null = null
  let lock: WakeLockSentinelLike | null = null
  const onVisible = async () => {
    // a Wake Lock a lap elrejtésekor elenged; visszatéréskor újrakérjük
    if (document.visibilityState === 'visible' && watch !== null) lock = await requestLock()
  }
  return {
    native: false,
    async start(onPoint, onError) {
      if (!navigator.geolocation) {
        onError('A böngésző nem adja meg a helyet.')
        return
      }
      lock = await requestLock()
      document.addEventListener('visibilitychange', onVisible)
      watch = navigator.geolocation.watchPosition(
        (pos) =>
          onPoint({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            acc: pos.coords.accuracy,
            ele: pos.coords.altitude,
            t: pos.timestamp || Date.now(),
          }),
        (err) =>
          onError(
            err.code === err.PERMISSION_DENIED
              ? 'A helymeghatározás nincs engedélyezve.'
              : 'A hely most nem érhető el (gyenge GPS-jel?).',
          ),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      )
    },
    async stop() {
      if (watch !== null) navigator.geolocation.clearWatch(watch)
      watch = null
      document.removeEventListener('visibilitychange', onVisible)
      await lock?.release().catch(() => {})
      lock = null
    },
  }
}

async function requestLock(): Promise<WakeLockSentinelLike | null> {
  const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock
  try {
    return wl ? await wl.request('screen') : null
  } catch {
    return null
  }
}

/** A futtatókörnyezethez illő rögzítő: natív appban a háttér-bővítmény, különben a böngésző. */
export async function createRecorder(): Promise<Recorder> {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (cap?.isNativePlatform?.()) {
    const m = await import('./nativeRecorder')
    return m.nativeRecorder()
  }
  return webRecorder()
}
