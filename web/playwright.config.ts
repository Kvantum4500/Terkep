import { defineConfig, devices } from '@playwright/test'

// E2E: a buildelt appot (`vite preview`) teszteljük /Terkep/ alútvonalon, ahogy a
// GitHub Pages is kiszolgálja. A térkép WebGL-t használ -> szoftveres renderelés.
const PORT = 4173
const BASE = process.env.BASE_PATH ?? '/Terkep/'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'mobil', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'asztali', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort --base ${BASE}`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
