// Kategóriaikonok: színes kör fehér Maki-ikonnal, futásidőben vászonra rajzolva
// (nincs szükség külön sprite-buildre).

import type { Map as MlMap } from 'maplibre-gl'
import type { CategoryMeta } from '../data/types'

const svgs = import.meta.glob('./icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

export function iconSvg(name: string): string | undefined {
  return svgs[`./icons/${name}.svg`]
}

const SIZE = 26 // CSS-pixel
const RATIO = 2

function loadSvg(svg: string): Promise<HTMLImageElement> {
  const white = svg.replace('<svg ', '<svg fill="#ffffff" ')
  const url = URL.createObjectURL(new Blob([white], { type: 'image/svg+xml' }))
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}

async function drawIcon(svg: string | undefined, color: string): Promise<ImageData> {
  const px = SIZE * RATIO
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.arc(px / 2, px / 2, px / 2 - 2 * RATIO, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 1.5 * RATIO
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  if (svg) {
    try {
      const img = await loadSvg(svg)
      const s = px * 0.55
      ctx.drawImage(img, (px - s) / 2, (px - s) / 2, s, s)
    } catch {
      // ikon nélkül is használható a színes kör
    }
  }
  return ctx.getImageData(0, 0, px, px)
}

export async function addCategoryIcons(map: MlMap, categories: Record<string, CategoryMeta>): Promise<void> {
  await Promise.all(
    Object.entries(categories).map(async ([key, c]) => {
      const name = `cat-${key}`
      if (map.hasImage(name)) return
      const data = await drawIcon(iconSvg(c.icon), c.color)
      if (!map.hasImage(name)) map.addImage(name, data, { pixelRatio: RATIO })
    }),
  )
}
