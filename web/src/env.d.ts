interface ImportMetaEnv {
  /** Mapillary ügyféltoken (nyilvános, böngészőbe szánt); ha üres, a Mapillary-körképek kimaradnak. */
  readonly VITE_MAPILLARY_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'pannellum/build/pannellum.js'
