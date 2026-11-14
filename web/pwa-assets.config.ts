import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Ikonok generálása a favicon.svg-ből: npm run icons
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: { ...minimal2023Preset, maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#166534' } } },
  images: ['public/favicon.svg'],
})
