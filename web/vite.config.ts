import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages: https://kvantum4500.github.io/Terkep/  -> BASE_PATH=/Terkep/ (CI-ben)
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: base,
        name: 'Magyarország látnivalói',
        short_name: 'Látnivalók',
        description: 'Várak, barlangok, kilátók, templomok és természeti értékek vármegyénként, szűrhető térképen.',
        lang: 'hu',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        theme_color: '#166534',
        background_color: '#f6f7f4',
        categories: ['travel', 'navigation', 'sports'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // az app, az adatok és a betűk előre gyorsítótárba kerülnek -> túrán offline is megy
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,json,geojson,pbf}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // térképcsempék: csak a megnézettek, előtöltés nincs (OSM-csempehasználati szabály)
            urlPattern: ({ url }) =>
              ['tile.opentopomap.org', 'tile.openstreetmap.org', 'tile.waymarkedtrails.org'].includes(url.hostname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'tiles',
              expiration: { maxEntries: 3000, maxAgeSeconds: 30 * 24 * 3600, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'commons.wikimedia.org' || url.hostname === 'upload.wikimedia.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'photos',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 24 * 3600, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
})
