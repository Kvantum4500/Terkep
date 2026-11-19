// Lustán betöltött modul: a Pannellum (MIT) csak a körkép megnyitásakor töltődik le.
import 'pannellum/build/pannellum.js'
import 'pannellum/build/pannellum.css'

interface PannellumViewer {
  destroy(): void
}

declare global {
  interface Window {
    pannellum: { viewer: (el: HTMLElement, config: Record<string, unknown>) => PannellumViewer }
  }
}

/** Gömbpanoráma, vagy (`vaov` megadásával) 360°-os körpanoráma, amely csak vízszintesen forog. */
export function openPannellum(el: HTMLElement, url: string, opts: { vaov?: number } = {}): { destroy: () => void } {
  const v = window.pannellum.viewer(el, {
    type: 'equirectangular',
    panorama: url,
    ...(opts.vaov ? { haov: 360, vaov: opts.vaov, vOffset: 0, minPitch: -opts.vaov / 2, maxPitch: opts.vaov / 2 } : {}),
    autoLoad: true,
    crossOrigin: 'anonymous',
    showZoomCtrl: true,
    showFullscreenCtrl: false,
    compass: false,
    hfov: 100,
    strings: {
      loadButtonLabel: 'Koppints a<br>betöltéshez',
      loadingLabel: 'Betöltés…',
      bylineLabel: 'készítette: %s',
      noPanoramaError: 'Nincs megadva körkép.',
      fileAccessError: 'A körkép nem tölthető be.',
      malformedURLError: 'Hibás a körkép hivatkozása.',
      iOS8WebGLError: 'Ezen az eszközön a körkép nem jeleníthető meg.',
      genericWebGLError: 'A böngésző nem támogatja a WebGL-t, a körkép nem jeleníthető meg.',
      textureSizeError: 'A kép túl nagy ehhez az eszközhöz (%s px; legfeljebb %s px).',
      unknownError: 'Ismeretlen hiba a körkép betöltésekor.',
    },
  })
  return { destroy: () => v.destroy() }
}
