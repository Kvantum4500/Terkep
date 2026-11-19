import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const DIR = join(__dirname, '..', '..', '..', 'data', 'sample', 'trails')

beforeAll(() => {
  vi.stubGlobal('fetch', (url: string) => {
    const name = url.split('/').pop()!
    try {
      return Promise.resolve(new Response(readFileSync(join(DIR, name), 'utf8')))
    } catch {
      return Promise.resolve(new Response('', { status: 404 }))
    }
  })
})

describe('turistautak', () => {
  it('index, szakaszok, keresés (ékezetfüggetlen, a szülő elöl)', async () => {
    const { loadTrailIndex, searchTrails, trailIds } = await import('../../src/trails/data')
    const idx = (await loadTrailIndex())!
    expect(idx.trails.length).toBe(6)
    const kt = idx.byId.get('r1000')!
    expect(kt.ch).toEqual(['r1001', 'r1002'])
    expect(trailIds(idx, 'r1000')).toEqual(['r1000', 'r1001', 'r1002'])
    expect(searchTrails(idx, 'kektura').map((t) => t.id)).toEqual(['r1000'])
    // a szülő (szakasz nélküli, országos) előbb, mint a szakaszai
    expect(searchTrails(idx, 'minta kek')[0].id).toBe('r1000')
  })

  it('a szűrő: csak a kiválasztott szín és alak; a kiválasztott út mindig látszik', async () => {
    const { loadTrailIndex, trailFeatures } = await import('../../src/trails/data')
    const idx = (await loadTrailIndex())!
    const blue = await trailFeatures(idx, { colors: ['k'], shapes: [] }, [])
    expect(blue.features.map((f) => f.properties!.id).sort()).toEqual(['r1001', 'r1002'])
    expect(blue.features.every((f) => f.properties!.c === 'k')).toBe(true)
    const yellowCross = await trailFeatures(idx, { colors: ['s', 'z'], shapes: ['kereszt'] }, [])
    expect(yellowCross.features.map((f) => f.properties!.id)).toEqual(['r1003'])
    const none = await trailFeatures(idx, { colors: [], shapes: [] }, ['r1000', 'r1001', 'r1002'])
    expect(none.features.map((f) => f.properties!.id).sort()).toEqual(['r1001', 'r1002'])
    expect(none.features.every((f) => f.properties!.sel)).toBe(true)
    // a vonal dekódolva, [lon, lat] sorrendben
    const [lon, lat] = none.features[0].geometry.coordinates[0][0]
    expect(lon).toBeGreaterThan(18.8)
    expect(lat).toBeGreaterThan(47.7)
  })
})
