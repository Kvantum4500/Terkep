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

describe('körpanoráma és Google-utcakép', () => {
  it('360°-os körpanoráma (széles, „360” a címben)', async () => {
    const { classifyPano, parseCommons } = await import('../../src/pano/find')
    expect(classifyPano(12000, 2000, 'File:Visegrád 360 körpanoráma.jpg')).toBe('cylinder')
    expect(classifyPano(12000, 2000, 'File:Széles kép.jpg')).toBeNull()
    expect(classifyPano(8000, 4000)).toBe('sphere')
    const p = parseCommons(
      {
        query: {
          pages: [
            {
              title: 'File:Vár 360 fok.jpg',
              coordinates: [{ lat: LAT, lon: LON }],
              imageinfo: [{ url: 'https://upload.wikimedia.org/c.jpg', width: 12000, height: 2000 }],
            },
            {
              title: 'File:Gömb.jpg',
              coordinates: [{ lat: LAT + 0.002, lon: LON }],
              imageinfo: [{ url: 'https://upload.wikimedia.org/g.jpg', width: 8000, height: 4000 }],
            },
          ],
        },
      },
      LAT,
      LON,
    )
    // a gömbpanoráma előre kerül, a körpanoráma utána, függőleges látószöggel
    expect(p.map((x) => x.kind)).toEqual(['sphere', 'cylinder'])
    expect(p[1].vaov).toBeCloseTo(60)
  })

  it('beágyazott Google-utcakép a látnivaló felé fordulva; kulcs nélkül nincs', async () => {
    const { googleEmbedUrl, googlePano, googleSearchPano } = await import('../../src/pano/find')
    const u = new URL(googleEmbedUrl('KEY', 47.7931, 18.9801, 33.4))
    expect(u.origin + u.pathname).toBe('https://www.google.com/maps/embed/v1/streetview')
    expect(u.searchParams.get('heading')).toBe('33')
    expect(u.searchParams.get('location')).toBe('47.793100,18.980100')
    expect(u.searchParams.get('language')).toBe('hu')
    expect(googlePano({ lat: 47.7931, lon: 18.9801, h: 33 }, LAT, LON, '')).toBeNull()
    const g = googlePano({ lat: 47.7931, lon: 18.9801, h: 33 }, LAT, LON, 'KEY')!
    expect(g.source).toBe('google')
    expect(g.distM).toBeGreaterThan(100)
    expect(new URL(googleSearchPano(LAT, LON, 'KEY')!.url!).searchParams.has('heading')).toBe(false)
  })

  it('Wikidata-gömbkép (P4640) adatai a Commonsról', async () => {
    const { commonsFilePano } = await import('../../src/pano/find')
    let asked = ''
    const p = await commonsFilePano('Visegrád 360.jpg', (u) => {
      asked = u
      return Promise.resolve(
        new Response(
          JSON.stringify({
            query: {
              pages: [
                {
                  title: 'File:Visegrád 360.jpg',
                  imageinfo: [
                    {
                      url: 'https://upload.wikimedia.org/v.jpg',
                      width: 6000,
                      height: 3000,
                      thumburl: 'https://upload.wikimedia.org/4096px-v.jpg',
                      extmetadata: { Artist: { value: '<b>Nagy</b> Béla' }, LicenseShortName: { value: 'CC0' } },
                    },
                  ],
                },
              ],
            },
          }),
        ),
      )
    })
    expect(new URL(asked).searchParams.get('titles')).toBe('File:Visegrád 360.jpg')
    expect(p!.url).toBe('https://upload.wikimedia.org/4096px-v.jpg')
    expect(p!.author).toBe('Nagy Béla')
    expect(p!.kind).toBe('sphere')
  })
})
