// Natív (Android, Capacitor) rögzítő: a háttér-helymeghatározó bővítmény előtérszolgáltatással
// és értesítéssel fut, így lezárt képernyőnél és háttérben is rögzít.

import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'
import { registerPlugin } from '@capacitor/core'
import type { Recorder } from './recorder'

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

export function nativeRecorder(): Recorder {
  let id: string | null = null
  return {
    native: true,
    async start(onPoint, onError) {
      id = await BackgroundGeolocation.addWatcher(
        {
          backgroundTitle: 'Túra rögzítése',
          backgroundMessage: 'A Látnivalók rögzíti a nyomvonalat.',
          requestPermissions: true,
          stale: false,
          distanceFilter: 5,
        },
        (loc, err) => {
          if (err) {
            onError(
              err.code === 'NOT_AUTHORIZED'
                ? 'A helymeghatározás nincs engedélyezve (Beállítások → Alkalmazások → Látnivalók → Engedélyek).'
                : 'A hely most nem érhető el.',
            )
            return
          }
          if (!loc) return
          onPoint({
            lat: loc.latitude,
            lon: loc.longitude,
            acc: loc.accuracy,
            ele: loc.altitude,
            t: loc.time ?? Date.now(),
          })
        },
      )
    },
    async stop() {
      if (id) await BackgroundGeolocation.removeWatcher({ id })
      id = null
    },
  }
}
