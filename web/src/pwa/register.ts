// Service worker regisztráció (offline működés) + „új verzió” értesítés.

import { registerSW } from 'virtual:pwa-register'

type Listener = (update: () => void) => void

let onNeedRefresh: Listener | null = null
let pending: (() => void) | null = null

export function onUpdateAvailable(fn: Listener): void {
  onNeedRefresh = fn
  if (pending) fn(pending)
}

export function setupPwa(): void {
  if (!('serviceWorker' in navigator)) return
  // Capacitorba csomagolva (később) nincs szükség service workerre
  if ((window as unknown as { Capacitor?: unknown }).Capacitor) return
  const updateSW = registerSW({
    onNeedRefresh() {
      const apply = () => void updateSW(true)
      pending = apply
      onNeedRefresh?.(apply)
    },
  })
  // tartós tárolás kérése, hogy a böngésző ne törölje az offline adatot
  void navigator.storage?.persist?.()
}
