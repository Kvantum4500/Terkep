import { describe, expect, it } from 'vitest'
import {
  decodePolyline,
  formatDuration,
  formatKm,
  googleDirectionsUrl,
  osrmUrl,
  parseOsrm,
  parseValhalla,
  planRoute,
  VALHALLA_URL,
  valhallaRequest,
  valhallaUrl,
} from '../../src/route/engine'
import { ascentDescent, distanceToLine, haversineM, poisAlongRoute, toGpx } from '../../src/route/geo'
import { addToPlan, EMPTY_PLAN, moveVia, planPoints, reversePlan, type Waypoint } from '../../src/route/types'
import { sampleIndex } from './fixtures'

/** Valhalla-féle polyline-kódoló (csak a teszthez). */
function encode(coords: [number, number][], precision = 6): string {
  const f = 10 ** precision
  let out = ''
  let plat = 0
  let plon = 0
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1
    while (x >= 0x20) {
      out += String.fromCharCode((0x20 | (x & 0x1f)) + 63)
      x >>= 5
    }
    out += String.fromCharCode(x + 63)
  }
  for (const [lon, lat] of coords) {
    const ilat = Math.round(lat * f)
    const ilon = Math.round(lon * f)
    enc(ilat - plat)
    enc(ilon - plon)
    plat = ilat
    plon = ilon
  }
  return out
}

const A: Waypoint = { lat: 47.502, lon: 19.0344, name: 'Mátyás-templom' }
const B: Waypoint = { lat: 47.7942, lon: 18.9811, name: 'Visegrádi fellegvár' }
const V: Waypoint = { lat: 47.6, lon: 19.0, name: 'Köztes' }

describe('polyline', () => {
  it('dekódolja a Google-példát (5 jegy)', () => {
    const c = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)
    expect(c).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ])
  })

  it('oda-vissza a Valhalla 6 jegyes formátumával', () => {
    const line: [number, number][] = [
      [19.0344, 47.502],
      [19.018612, 47.533612],
      [18.9811, 47.7942],
    ]
    expect(decodePolyline(encode(line), 6)).toEqual(line)
  })
})

describe('Valhalla-kérés', () => {
  it('túraprofil: ösvények előnyben, nehezebb terep, magyar útleírás, alternatívák', () => {
    const r = valhallaRequest([A, B], 'hike') as {
      costing: string
      costing_options: { pedestrian: Record<string, number> }
      alternates: number
      directions_options: { language: string }
      elevation_interval: number
      locations: { lat: number; lon: number }[]
    }
    expect(r.costing).toBe('pedestrian')
    expect(r.costing_options.pedestrian.use_tracks).toBe(1)
    expect(r.costing_options.pedestrian.max_hiking_difficulty).toBe(3)
    expect(r.alternates).toBe(2)
    expect(r.directions_options.language).toBe('hu-HU')
    expect(r.elevation_interval).toBe(30)
    expect(r.locations).toHaveLength(2)
  })

  it('köztes ponttal nincs alternatíva; kerékpár és autó profil', () => {
    expect((valhallaRequest([A, V, B], 'bike') as { alternates: number; costing: string }).alternates).toBe(0)
    expect((valhallaRequest([A, B], 'bike') as { costing: string }).costing).toBe('bicycle')
    expect((valhallaRequest([A, B], 'car') as { costing: string }).costing).toBe('auto')
  })

  it('GET-kérés (nincs CORS-előkérés)', () => {
    const u = valhallaUrl([A, B], 'hike')
    expect(u.startsWith(`${VALHALLA_URL}?json=`)).toBe(true)
    expect(JSON.parse(decodeURIComponent(u.split('json=')[1])).costing).toBe('pedestrian')
  })
})

describe('Valhalla-válasz', () => {
  const leg1: [number, number][] = [
    [19.0344, 47.502],
    [19.03, 47.55],
  ]
  const leg2: [number, number][] = [
    [19.03, 47.55],
    [18.9811, 47.7942],
  ]
  const trip = (km: number) => ({
    legs: [
      { shape: encode(leg1), maneuvers: [{ instruction: 'Indulj északra.', length: 5.2 }], elevation: [100, 110, 130] },
      { shape: encode(leg2), maneuvers: [{ instruction: 'Megérkeztél.', length: 0 }], elevation: [130, 120, 300] },
    ],
    summary: { length: km, time: 3600 * 5 },
  })

  it('összefűzi a lábakat, lépések és szintemelkedés', () => {
    const [main, alt] = parseValhalla({ trip: trip(31.5), alternates: [{ trip: trip(33) }] })
    expect(main.coords).toEqual([...leg1, leg2[1]])
    expect(main.distanceKm).toBe(31.5)
    expect(main.steps.map((s) => s.text)).toEqual(['Indulj északra.', 'Megérkeztél.'])
    expect(main.ascent).toBe(210)
    expect(main.descent).toBe(10)
    expect(main.engine).toBe('valhalla')
    expect(alt.distanceKm).toBe(33)
  })

  it('magasság nélkül nincs emelkedő', () => {
    const t = trip(10)
    t.legs.forEach((l) => delete (l as { elevation?: number[] }).elevation)
    expect(parseValhalla({ trip: t })[0].ascent).toBeUndefined()
  })
})

describe('OSRM-tartalék', () => {
  it('URL és válasz', () => {
    expect(osrmUrl([A, B], 'hike')).toMatch(
      /^https:\/\/routing\.openstreetmap\.de\/routed-foot\/route\/v1\/driving\/19\.0344,47\.502;18\.9811,47\.7942\?.*alternatives=true/,
    )
    expect(osrmUrl([A, V, B], 'bike')).toContain('routed-bike')
    const alts = parseOsrm({
      code: 'Ok',
      routes: [
        {
          geometry: { coordinates: [[19, 47], [19.1, 47.1]] },
          distance: 12345,
          duration: 7200,
          legs: [
            {
              steps: [
                { name: 'Fő utca', distance: 100, maneuver: { type: 'depart' } },
                { name: '', distance: 5000, maneuver: { type: 'turn', modifier: 'left' } },
              ],
            },
          ],
        },
      ],
    })
    expect(alts[0].distanceKm).toBeCloseTo(12.345)
    expect(alts[0].steps.map((s) => s.text)).toEqual(['Indulj el (Fő utca)', 'Fordulj balra'])
    expect(alts[0].engine).toBe('osrm')
    expect(() => parseOsrm({ code: 'NoRoute' })).toThrow()
  })
})

describe('planRoute', () => {
  const okValhalla = { trip: { legs: [{ shape: encode([[19, 47], [19.1, 47.1]]) }], summary: { length: 14, time: 3000 } } }
  const okOsrm = { code: 'Ok', routes: [{ geometry: { coordinates: [[19, 47], [19.1, 47.1]] }, distance: 15000, duration: 3100, legs: [{ steps: [] }] }] }
  const respond = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }))

  it('Valhallával tervez', async () => {
    const calls: string[] = []
    const alts = await planRoute([A, B], 'hike', undefined, (u) => {
      calls.push(u)
      return respond(200, okValhalla)
    })
    expect(alts[0].engine).toBe('valhalla')
    expect(calls).toHaveLength(1)
  })

  it('Valhalla-hiba vagy hálózati hiba esetén az OSRM-mel', async () => {
    const a = await planRoute([A, B], 'bike', undefined, (u) =>
      u.startsWith(VALHALLA_URL) ? respond(503, {}) : respond(200, okOsrm),
    )
    expect(a[0].engine).toBe('osrm')
    const b = await planRoute([A, B], 'bike', undefined, (u) =>
      u.startsWith(VALHALLA_URL) ? Promise.reject(new TypeError('Failed to fetch')) : respond(200, okOsrm),
    )
    expect(b[0].engine).toBe('osrm')
  })

  it('ha egyik sem megy, érthető hibát ad', async () => {
    await expect(planRoute([A, B], 'car', undefined, () => respond(502, {}))).rejects.toThrow(/nem érhető el/)
    await expect(planRoute([A], 'car')).rejects.toThrow()
  })
})

describe('segédfüggvények', () => {
  it('formázás', () => {
    expect(formatDuration(45 * 60)).toBe('45 perc')
    expect(formatDuration(3 * 3600 + 10 * 60)).toBe('3 óra 10 perc')
    expect(formatDuration(2 * 3600)).toBe('2 óra')
    expect(formatKm(4.25)).toMatch(/^4[,.]3 km$/)
    expect(formatKm(31.6)).toBe('32 km')
  })

  it('Google-útvonal köztes pontokkal és móddal', () => {
    const u = new URL(googleDirectionsUrl([A, V, B], 'hike'))
    expect(u.searchParams.get('travelmode')).toBe('walking')
    expect(u.searchParams.get('origin')).toBe('47.502,19.0344')
    expect(u.searchParams.get('waypoints')).toBe('47.6,19')
  })

  it('távolság és szintemelkedés', () => {
    // Budapest (Mátyás-templom) – Visegrád légvonalban kb. 33 km
    expect(haversineM(A.lat, A.lon, B.lat, B.lon) / 1000).toBeGreaterThan(30)
    expect(haversineM(A.lat, A.lon, B.lat, B.lon) / 1000).toBeLessThan(36)
    // a 3 m alatti ingadozás zaj
    expect(ascentDescent([100, 101, 100, 102, 150, 140, 141, 120])).toEqual({ ascent: 50, descent: 30 })
  })

  it('pont–vonal távolság és helyzet a vonalon', () => {
    const line: [number, number][] = [
      [19.0, 47.5],
      [19.1, 47.5],
    ]
    const mid = distanceToLine(47.501, 19.05, line)
    expect(mid.d).toBeGreaterThan(100)
    expect(mid.d).toBeLessThan(120)
    expect(mid.along).toBeCloseTo(0.5, 2)
    expect(distanceToLine(47.5, 18.9, line).along).toBe(0)
  })

  it('látnivalók az út mentén, haladási sorrendben, a szűrt halmazból', () => {
    const ix = sampleIndex()
    const all = Uint32Array.from({ length: ix.n }, (_, i) => i)
    // Mátyás-templom -> Pál-völgyi-barlang
    const line: [number, number][] = [
      [19.0344, 47.502],
      [19.0186, 47.5336],
    ]
    const near = poisAlongRoute(ix, all, line, 300)
    expect(near.map((n) => ix.id[n.i])).toEqual(['Q2', 'n5'])
    // ha a szűrő kizárja a templomot, nem jelenik meg
    const onlyCaves = Uint32Array.from([...all].filter((i) => ix.cats[ix.cat[i]] === 'barlang'))
    expect(poisAlongRoute(ix, onlyCaves, line, 300).map((n) => ix.id[n.i])).toEqual(['n5'])
  })

  it('GPX: nyomvonal, útpontok, escape', () => {
    const g = toGpx('Út <1> & "2"', [[19, 47], [19.1, 47.1]], [{ ...A, name: 'A & B' }])
    expect(g).toContain('<gpx version="1.1"')
    expect(g.match(/<trkpt /g)).toHaveLength(2)
    expect(g).toContain('<name>A &amp; B</name>')
    expect(g).toContain('Út &lt;1&gt; &amp; &quot;2&quot;')
  })
})

describe('útvonalterv', () => {
  it('köztes pont cél nélkül célnak számít; sorrend, megfordítás', () => {
    let p = addToPlan(EMPTY_PLAN, V, 'via')
    expect(p.end).toBe(V)
    expect(planPoints(p)).toBeNull()
    p = addToPlan(p, A, 'start')
    p = addToPlan(p, B, 'via')
    p = addToPlan(p, { ...B, name: 'B2' }, 'via')
    expect(planPoints(p)!.map((w) => w.name)).toEqual(['Mátyás-templom', 'Visegrádi fellegvár', 'B2', 'Köztes'])
    p = moveVia(p, 1, -1)
    expect(p.vias.map((w) => w.name)).toEqual(['B2', 'Visegrádi fellegvár'])
    expect(moveVia(p, 0, -1)).toBe(p)
    const r = reversePlan(p)
    expect(r.start).toBe(V)
    expect(r.end).toBe(A)
    expect(r.vias.map((w) => w.name)).toEqual(['Visegrádi fellegvár', 'B2'])
  })
})
