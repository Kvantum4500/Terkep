import { useEffect } from 'react'
import { useStore } from '../state/store'
import { planRoute } from './engine'
import { planPoints } from './types'

/** Ha az útvonalpontok vagy a profil változik, újratervez (kis késleltetéssel, a régi kérést megszakítva). */
export function usePlanner(): void {
  useEffect(() => {
    let ctrl: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      const st = useStore.getState()
      const pts = planPoints(st.route.plan)
      ctrl?.abort()
      ctrl = null
      if (!pts) {
        st.setRouteResult({ alts: [], status: 'idle', error: null, active: 0 })
        return
      }
      if (!navigator.onLine) {
        st.setRouteResult({ alts: [], status: 'error', error: 'Az útvonaltervezéshez internetkapcsolat kell.' })
        return
      }
      const c = new AbortController()
      ctrl = c
      st.setRouteResult({ status: 'loading', error: null })
      planRoute(pts, st.route.profile, c.signal)
        .then((alts) => {
          if (!c.signal.aborted) useStore.getState().setRouteResult({ alts, active: 0, status: 'ok', error: null })
        })
        .catch((e: unknown) => {
          if (c.signal.aborted) return
          useStore.getState().setRouteResult({
            alts: [],
            status: 'error',
            error: e instanceof Error ? e.message : 'Az útvonal nem tervezhető.',
          })
        })
    }
    const unsub = useStore.subscribe((s, prev) => {
      if (s.route.plan !== prev.route.plan || s.route.profile !== prev.route.profile) {
        clearTimeout(timer)
        timer = setTimeout(run, 250)
      }
    })
    return () => {
      unsub()
      clearTimeout(timer)
      ctrl?.abort()
    }
  }, [])
}
