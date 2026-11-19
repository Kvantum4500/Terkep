import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'

describe('térképstílus', () => {
  it('érvényes (hibás kifejezésnél az egész térkép nem töltődne be)', async () => {
    const { buildStyle } = await import('../../src/map/style')
    const errors = validateStyleMin(buildStyle('https://example.org/fonts/{fontstack}/{range}.pbf'))
    expect(errors.map((e) => e.message)).toEqual([])
  })
})

it('a validátor elkapja a hibás zoom-kifejezést (ez rontotta el egyszer a térképet)', async () => {
  const { buildStyle } = await import('../../src/map/style')
  const style = buildStyle('https://example.org/fonts/{fontstack}/{range}.pbf')
  const bad = {
    ...style,
    layers: style.layers.map((l) =>
      l.id === 'trail-line'
        ? { ...l, paint: { 'line-width': ['case', ['get', 'sel'], 6, ['interpolate', ['linear'], ['zoom'], 8, 1.8, 14, 3.5]] } }
        : l,
    ),
  }
  expect(validateStyleMin(bad as typeof style).some((e) => /zoom/.test(e.message))).toBe(true)
})
