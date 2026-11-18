import { describe, expect, it } from 'vitest'
import {
  commonsQueryUrl,
  findPanos,
  googleStreetViewUrl,
  isEquirect,
  mapillaryQueryUrl,
  parseCommons,
  parseMapillary,
} from '../../src/pano/find'

const LAT = 47.7942
const LON = 18.9811

describe('gömbpanoráma felismerése', () => {
  it('2:1 és elég nagy', () => {
    expect(isEquirect(8000, 4000)).toBe(true)
    expect(isEquirect(4096, 2048)).toBe(true)
    expect(isEquirect(4000, 3000)).toBe(false)
    expect(isEquirect(1600, 800)).toBe(false)
    expect(isEquirect(0, 0)).toBe(false)
  })

  it('kisebb kép csak 360°-os kategóriával', () => {
    expect(isEquirect(2400, 1200)).toBe(false)
    expect(isEquirect(2400, 1200, ['Category:360° panoramas of Hungary'])).toBe(true)
    expect(isEquirect(2400, 1200, ['Category:Castles in Hungary'])).toBe(false)
  })
})

describe('Commons', () => {
  it('lekérdezés: koordináta, File névtér, CORS', () => {
    const u = new URL(commonsQueryUrl(LAT, LON))
    expect(u.searchParams.get('ggscoord')).toBe(`${LAT}|${LON}`)
    expect(u.searchParams.get('ggsnamespace')).toBe('6')
    expect(u.searchParams.get('origin')).toBe('*')
  })

  it('csak a gömbpanorámákat adja, távolság szerint; nagy képnél a 4096 px-es változat', () => {
    const json = {
      query: {
        pages: [
          {
            title: 'File:Visegrád fellegvár 360.jpg',
            coordinates: [{ lat: LAT + 0.001, lon: LON }],
            categories: [{ title: 'Category:360° panoramas' }],
            imageinfo: [
              {
                url: 'https://upload.wikimedia.org/o.jpg',
                thumburl: 'https://upload.wikimedia.org/4096px-o.jpg',
                width: 10000,
                height: 5000,
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Visegr%C3%A1d.jpg',
                extmetadata: {
                  Artist: { value: '<a href="//x">Kiss <b>Anna</b></a>' },
                  LicenseShortName: { value: 'CC BY-SA 4.0' },
                  LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
                },
              },
            ],
          },
          {
            title: 'File:Közeli.jpg',
            coordinates: [{ lat: LAT, lon: LON + 0.0001 }],
            imageinfo: [{ url: 'https://upload.wikimedia.org/k.jpg', width: 4000, height: 2000 }],
          },
          {
            title: 'File:Normál fotó.jpg',
            coordinates: [{ lat: LAT, lon: LON }],
            imageinfo: [{ url: 'https://upload.wikimedia.org/n.jpg', width: 4000, height: 3000 }],
          },
          { title: 'File:Koordináta nélkül.jpg', imageinfo: [{ url: 'x', width: 8000, height: 4000 }] },
        ],
      },
    }
    const p = parseCommons(json, LAT, LON)
    expect(p.map((x) => x.title)).toEqual(['Közeli', 'Visegrád fellegvár 360'])
    expect(p[0].url).toBe('https://upload.wikimedia.org/k.jpg')
    expect(p[1].url).toBe('https://upload.wikimedia.org/4096px-o.jpg')
    expect(p[1].author).toBe('Kiss Anna')
    expect(p[1].license).toBe('CC BY-SA 4.0')
    expect(p[1].distM).toBeGreaterThan(100)
    expect(p[1].distM).toBeLessThan(120)
  })
})

describe('Mapillary', () => {
  it('lekérdezés: csak 360°-os képek, a hely körüli dobozban', () => {
    const u = new URL(mapillaryQueryUrl(LAT, LON, 'MLY|tok'))
    expect(u.searchParams.get('is_pano')).toBe('true')
    const [w, s, e, n] = u.searchParams.get('bbox')!.split(',').map(Number)
    expect(w).toBeLessThan(LON)
    expect(e).toBeGreaterThan(LON)
    expect(s).toBeLessThan(LAT)
    expect(n).toBeGreaterThan(LAT)
  })

  it('a legközelebbiek elöl, legfeljebb 5', () => {
    const data = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      computed_geometry: { coordinates: [LON + 0.0001 * (8 - i), LAT] as [number, number] },
      captured_at: Date.UTC(2023, 5, 1),
    }))
    const p = parseMapillary({ data }, LAT, LON)
    expect(p).toHaveLength(5)
    expect(p[0].id).toBe('7')
    expect(p[0].title).toBe('Mapillary utcakép (2023)')
    expect(p[0].license).toBe('CC BY-SA 4.0')
  })
})

describe('findPanos', () => {
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  const commonsBody = {
    query: {
      pages: [
        {
          title: 'File:P.jpg',
          coordinates: [{ lat: LAT, lon: LON }],
          imageinfo: [{ url: 'https://upload.wikimedia.org/p.jpg', width: 4000, height: 2000 }],
        },
      ],
    },
  }

  it('token nélkül csak a Commonst kérdezi', async () => {
    const calls: string[] = []
    const p = await findPanos(LAT, LON, (u) => {
      calls.push(u)
      return ok(commonsBody)
    }, '')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('commons.wikimedia.org')
    expect(p).toHaveLength(1)
  })

  it('hálózati hiba nem „nincs felvétel”, hanem hiba', async () => {
    await expect(findPanos(LAT, LON, () => Promise.reject(new TypeError('offline')), '')).rejects.toThrow()
  })

  it('tokennel a Mapillary elöl, és az egyik forrás hibája nem akadályozza a másikat', async () => {
    const p = await findPanos(
      LAT,
      LON,
      (u) =>
        u.includes('graph.mapillary.com')
          ? ok({ data: [{ id: 'm1', computed_geometry: { coordinates: [LON, LAT] } }] })
          : Promise.reject(new TypeError('commons down')),
      'MLY|tok',
    )
    expect(p.map((x) => x.source)).toEqual(['mapillary'])
  })
})

it('Google utcakép link (külső app)', () => {
  expect(googleStreetViewUrl(LAT, LON)).toBe(
    'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=47.794200,18.981100',
  )
})
