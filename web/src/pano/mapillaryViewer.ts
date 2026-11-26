// Lustán betöltött modul: a MapillaryJS (MIT) csak a Mapillary-körkép megnyitásakor töltődik le.
import { Viewer } from 'mapillary-js'
import 'mapillary-js/dist/mapillary.css'

export function openMapillary(el: HTMLElement, imageId: string, token: string): { destroy: () => void } {
  const v = new Viewer({ accessToken: token, container: el, imageId, component: { cover: false } })
  return { destroy: () => v.remove() }
}
