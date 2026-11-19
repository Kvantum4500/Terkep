interface ImportMetaEnv {
  /** Mapillary ügyféltoken (nyilvános, böngészőbe szánt); ha üres, a Mapillary-körképek kimaradnak. */
  readonly VITE_MAPILLARY_TOKEN?: string
  /** Google Maps Embed API böngészőkulcs (a Pages-címre korlátozva); ha üres, az utcakép külső linkként nyílik. */
  readonly VITE_GOOGLE_MAPS_EMBED_KEY?: string
  /** natív (Capacitor) build: nincs service worker */
  readonly VITE_NATIVE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'pannellum/build/pannellum.js'
