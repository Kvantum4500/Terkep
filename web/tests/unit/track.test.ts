import { describe, expect, it } from 'vitest'
import { haversineM } from '../../src/route/geo'
import { applyAnchors, cumulative, nearestIndex, thin, trackStats, type TrackPoint } from '../../src/track/geom'
import { parseGpx, trackToGpx } from '../../src/track/gpx'
import { trailProgress } from '../../src/track/progress'
import { acceptFix } from '../../src/track/recorder'
import { matchValhalla, snapToLines, traceRouteBody, TRACE_ROUTE_URL } from '../../src/track/snap'

/** Észak felé haladó egyenes, 11 pont, kb. 111 m-es lépésekkel. */
const straight: TrackPoint[] = Array.from({ length: 11 }, (_, k) => ({ lon: 19, lat: 47 + k * 0.001, t: k * 60_000 }))

describe('kézi igazítás (rögzítési pontok)', () => {
  it('rögzítési pont nélkül változatlan', () => {
    expect(applyAnchors(straight, [])).toEqual(straight.map((p) => [p.lon, p.lat]))
  })

  it('a rögzítési pont a megadott helyre kerül, a végek helyben maradnak, közte arányos az elmozdulás', () => {
    const out = applyAnchors(straight, [{ i: 5, lon: 19.002, lat: 47.005 }])
    expect(out[5]).toEqual([19.002, 47.005])
    expect(out[0]).toEqual([19, 47])
    expect(out[10][0]).toBeCloseTo(19, 10)
    // félúton a fele
    expect(out[2][0]).toBeCloseTo(19 + 0.002 * (2 / 5), 9)
    expect(out[8][0]).toBeCloseTo(19 + 0.002 * (2 / 5), 9)
  })

  it('két rögzítési pont között a kettő elmozdulása keveredik; a szakaszon kívül nem hat', () => {
    const out = applyAnchors(straight, [
      { i: 2, lon: 19.001, lat: 47.002 },
      { i: 4, lon: 19.003, lat: 47.004 },
    ])
    expect(out[3][0]).toBeCloseTo(19.002, 9)
    expect(out[2]).toEqual([19.001, 47.002])
    expect(out[4]).toEqual([19.003, 47.004])
    expect(out[0]).toEqual([19, 47])
  })

  it('a végpontra tett rögzítés a véget is elviszi', () => {
    const out = applyAnchors(straight, [{ i: 0, lon: 18.999, lat: 47 }])
    expect(out[0]).toEqual([18.999, 47])
    expect(out[10][0]).toBeCloseTo(19, 10)
  })

  it('legközelebbi pont, halmozott táv, ritkítás, statisztika', () => {
    const line = straight.map((p) => [p.lon, p.lat] as [number, number])
    expect(nearestIndex(line, 19.0003, 47.0042).i).toBe(4)
    const cum = cumulative(straight)
    expect(cum[10]).toBeGreaterThan(1100)
    expect(cum[10]).toBeLessThan(1120)
    expect(thin(line, 250).length).toBe(5)
    const s = trackStats([...straight.slice(0, 3).map((p, k) => ({ ...p, ele: [100, 110, 130][k] }))])
    expect(s.km).toBeCloseTo(0.222, 2)
    expect(s.durationS).toBe(120)
    expect(s.ascent).toBe(30)
  })
})

describe('teljesítés', () => {
  const trail: [number, number][][] = [straight.map((p) => [p.lon, p.lat])]

  it('a túra fele teljesítve (a nyomvonal 20 m-re párhuzamosan halad)', () => {
    const half: [number, number][][] = [straight.slice(0, 6).map((p) => [p.lon + 0.00026, p.lat])]
    const pr = trailProgress(trail, half)
    expect(pr.totalKm).toBeCloseTo(1.112, 2)
    expect(pr.pct).toBeGreaterThan(45)
    expect(pr.pct).toBeLessThan(56)
    expect(pr.done.length).toBe(1)
  })

  it('messze (100 m) haladó nyomvonal nem számít, a ritka pontok közét is figyeli', () => {
    expect(trailProgress(trail, [straight.map((p) => [p.lon + 0.0013, p.lat])]).pct).toBe(0)
    // csak a két végpont, közte egyenes: a teljes út teljesítve
    const sparse: [number, number][][] = [[[19, 47], [19, 47.01]]]
    expect(trailProgress(trail, sparse).pct).toBe(100)
  })
})

describe('GPX', () => {
  it('beolvasás: trkpt magassággal és idővel, névtérrel; oda-vissza', () => {
    const gpx = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:ns3="x">
      <trk><name>Pilis &amp; Visegrád</name><trkseg>
        <trkpt lat="47.7" lon="19.0"><ele>300.5</ele><time>2026-05-01T08:00:00Z</time></trkpt>
        <trkpt lon='19.001' lat='47.701'><ele>310</ele><time>2026-05-01T08:01:00Z</time><extensions><ns3:hr>120</ns3:hr></extensions></trkpt>
        <trkpt lat="47.702" lon="19.002"/>
      </trkseg></trk></gpx>`
    const g = parseGpx(gpx)
    expect(g.name).toBe('Pilis & Visegrád')
    expect(g.points).toHaveLength(3)
    expect(g.points[1]).toEqual({ lon: 19.001, lat: 47.701, ele: 310, t: Date.parse('2026-05-01T08:01:00Z') })
    expect(g.points[2].ele).toBeUndefined()
    const back = parseGpx(trackToGpx('Út <1>', g.points))
    expect(back.name).toBe('Út <1>')
    expect(back.points.map((p) => [p.lon, p.lat])).toEqual(g.points.map((p) => [p.lon, p.lat]))
  })

  it('útvonalpontokat (rtept) is olvas, ha nincs trkpt', () => {
    const g = parseGpx('<gpx><rte><rtept lat="47.1" lon="19.1"/><rtept lat="47.2" lon="19.2"/></rte></gpx>')
    expect(g.points).toHaveLength(2)
  })
})

describe('ráillesztés', () => {
  it('helyben: a 25 m-en belüli vonalra vetít, a távolabbi pont marad', () => {
    const path: [number, number][][] = [[[19, 47], [19, 47.01]]]
    const out = snapToLines(
      [
        [19.0002, 47.002],
        [19.001, 47.005],
      ],
      path,
    )
    expect(out[0][0]).toBeCloseTo(19, 6)
    expect(out[0][1]).toBeCloseTo(47.002, 6)
    expect(out[1]).toEqual([19.001, 47.005]) // kb. 76 m-re van
  })

  it('Valhalla trace_route: ritkítás, a rögzítési pontok kötelezők; hibánál null', async () => {
    const line: [number, number][] = straight.map((p) => [p.lon, p.lat])
    const body = traceRouteBody(line, [4]) as { shape: { type: string }[]; shape_match: string; costing: string }
    expect(body.shape_match).toBe('map_snap')
    expect(body.costing).toBe('pedestrian')
    expect(body.shape[0].type).toBe('break')
    expect(body.shape[4].type).toBe('break')
    expect(body.shape[3].type).toBe('via')
    expect(await matchValhalla(line, [], undefined, () => Promise.reject(new TypeError('offline')))).toBeNull()
    let url = ''
    const res = await matchValhalla(line, [], undefined, (u) => {
      url = u
      return Promise.resolve(new Response(JSON.stringify({ trip: { legs: [{ shape: '_ibE_seK_seK_seK' }] } })))
    })
    expect(url).toBe(TRACE_ROUTE_URL)
    expect(res).toHaveLength(2)
  })
})

it('GPS-pontszűrés: a pontatlan és a túl közeli pont kimarad', () => {
  const p = { lon: 19, lat: 47 }
  expect(acceptFix(undefined, { lat: 47, lon: 19, acc: 10, t: 0 })).toBe(true)
  expect(acceptFix(undefined, { lat: 47, lon: 19, acc: 80, t: 0 })).toBe(false)
  expect(acceptFix(p, { lat: 47.00002, lon: 19, acc: 5, t: 0 })).toBe(false) // kb. 2 m
  expect(acceptFix(p, { lat: 47.0001, lon: 19, acc: 5, t: 0 })).toBe(true) // kb. 11 m
  expect(haversineM(47, 19, 47.0001, 19)).toBeGreaterThan(10)
})
