import { expect, type Page, test } from '@playwright/test'

// Elrendezés (a térkép sosem takart), műhold nézet, útvonaltervezés, 360°-os körkép,
// Vissza gomb. A külső szolgáltatások (Valhalla, Commons, Esri) hálózati
// kéréseit mockoljuk; a service worker ki van kapcsolva, hogy a mock minden kérést lásson.
test.use({ serviceWorkers: 'block' })

const MATYAS = { lat: 47.502, lon: 19.0344 }
const VISEGRAD = { lat: 47.7942, lon: 18.9811 }

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

const LINE: [number, number][] = [
  [MATYAS.lon, MATYAS.lat],
  [19.02, 47.6],
  [VISEGRAD.lon, VISEGRAD.lat],
]

const valhallaBody = (km: number) => ({
  trip: {
    legs: [
      {
        shape: encode(LINE),
        maneuvers: [
          { instruction: 'Indulj észak felé.', length: km - 1 },
          { instruction: 'Megérkeztél: Visegrádi fellegvár.', length: 0 },
        ],
        elevation: [110, 180, 160, 330],
      },
    ],
    summary: { length: km, time: km * 720 },
  },
})

async function mockServices(page: Page) {
  const valhallaCalls: string[] = []
  await page.route('https://valhalla1.openstreetmap.de/route?**', (route) => {
    valhallaCalls.push(route.request().url())
    return route.fulfill({
      json: { ...valhallaBody(36.4), alternates: [{ trip: valhallaBody(39.1).trip }] },
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  })
  // útfelület-összetétel: 36,4 km-ből 2,4 km közút, ebből 0,4 km forgalmas
  await page.route('https://valhalla1.openstreetmap.de/trace_attributes', (route) =>
    route.fulfill({
      json: {
        edges: [
          { use: 'path', length: 30 },
          { use: 'track', length: 4 },
          { use: 'road', road_class: 'residential', length: 2 },
          { use: 'road', road_class: 'secondary', length: 0.4 },
        ],
      },
      headers: { 'Access-Control-Allow-Origin': '*' },
    }),
  )
  // beágyazott Google-utcakép (a tesztbuildben kamu kulccsal)
  await page.route('https://www.google.com/maps/embed/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>utcakép</title><p>Google utcakép (teszt)</p>' }),
  )
  await page.route(/server\.arcgisonline\.com|tile\.(opentopomap|openstreetmap|waymarkedtrails)\.org/, (r) => r.abort())
  return valhallaCalls
}

async function open(page: Page, hash = '') {
  await page.goto(`./?basemap=none${hash}`)
  await expect(page.getByTestId('result-count')).toBeVisible()
}

async function openCard(page: Page, query: string) {
  await page.getByTestId('search').fill(query)
  await page.getByTestId('tab-list').click()
  await page.getByTestId('result-row').first().locator('button').click()
  await expect(page.getByTestId('poi-card')).toBeVisible()
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function layout(page: Page) {
  const map = (await page.getByTestId('map').boundingBox()) as Box
  const sheet = (await page.getByTestId('sheet').boundingBox()) as Box
  const main = (await page.getByTestId('main').boundingBox()) as Box
  const ix = Math.max(0, Math.min(map.x + map.width, sheet.x + sheet.width) - Math.max(map.x, sheet.x))
  const iy = Math.max(0, Math.min(map.y + map.height, sheet.y + sheet.height) - Math.max(map.y, sheet.y))
  return { overlapPx: Math.min(ix, iy), mapShare: (map.width * map.height) / (main.width * main.height) }
}

test('a térképet a panel semmilyen nézetben nem takarja', async ({ page }, info) => {
  await mockServices(page)
  const views: [number, number][] = [
    [360, 780],
    [780, 360],
    [800, 1100],
    [1366, 768],
    [1920, 1080],
  ]
  await open(page)
  for (const [w, h] of views) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(350)
    // kezdőnézet, lista, kártya; álló nézetben a panel legnagyobb állásában is
    for (const step of ['start', 'list', 'card', 'max'] as const) {
      if (step === 'list') await page.getByTestId('tab-list').click()
      if (step === 'card') {
        await page.getByTestId('result-row').first().locator('button').click()
        await expect(page.getByTestId('poi-card')).toBeVisible()
      }
      if (step === 'max') {
        const handle = page.getByRole('button', { name: 'Panel méretezése' })
        if (!(await handle.isVisible())) continue
        while (!(await page.getByTestId('sheet').getAttribute('class'))?.includes('sheet-full')) await handle.click()
      }
      await page.waitForTimeout(350)
      const l = await layout(page)
      // legfeljebb 1 px kerekítési sáv
      expect(l.overlapPx, `${w}x${h} ${step}`).toBeLessThanOrEqual(1)
      expect(l.mapShare, `${w}x${h} ${step}`).toBeGreaterThanOrEqual(0.39)
    }
    await page.screenshot({ path: info.outputPath(`elrendezes-${w}x${h}.png`) })
    await page.getByTestId('poi-card').getByRole('button', { name: 'Bezárás' }).click()
    await expect(page.getByTestId('poi-card')).toBeHidden()
    await page.getByTestId('tab-filters').click()
  }
})

test('érintőképernyőn a térképgombok legalább 44 px-esek', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobil', 'csak érintőképernyőn')
  await open(page)
  const btn = await page.getByRole('button', { name: 'Nagyítás' }).boundingBox()
  expect(btn!.width).toBeGreaterThanOrEqual(44)
  expect(btn!.height).toBeGreaterThanOrEqual(44)
})

test('asztalon a panel elrejthető, ilyenkor a térkép a teljes szélességet kapja', async ({ page }, info) => {
  test.skip(info.project.name !== 'asztali', 'oldalpanel-elrendezés')
  await open(page)
  await page.getByRole('button', { name: 'Panel elrejtése' }).click()
  const map = await page.getByTestId('map').boundingBox()
  expect(map!.width).toBeGreaterThan(1300)
  await page.getByTestId('panel-show').click()
  await expect(page.getByTestId('sheet')).toBeVisible()
  expect((await page.getByTestId('map').boundingBox())!.width).toBeLessThan(1000)
})

test('műhold nézet a Rétegek menüből, és megmarad', async ({ page }) => {
  await mockServices(page)
  await open(page)
  await page.getByTestId('layers-btn').click()
  await page.getByTestId('basemap-sat').check()
  const vis = () =>
    page.evaluate(() => {
      const m = (window as unknown as { __terkepMap: { getLayoutProperty: (l: string, p: string) => string } })
        .__terkepMap
      return [m.getLayoutProperty('sat', 'visibility'), m.getLayoutProperty('topo', 'visibility')]
    })
  await expect.poll(vis).toEqual(['visible', 'none'])
  await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toContainText('Esri', { useInnerText: false })
  // újratöltés után (URL-paraméter nélkül) is műhold marad
  await page.goto('./')
  await expect(page.getByTestId('result-count')).toBeVisible()
  await expect.poll(vis).toEqual(['visible', 'none'])
})

test('útvonaltervezés: kártya -> „Útvonal ide”, változatok, GPX, látnivalók az út mentén', async ({ page, context }, info) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: MATYAS.lat, longitude: MATYAS.lon })
  const calls = await mockServices(page)
  await open(page)
  await openCard(page, 'fellegvár')
  await page.getByTestId('route-to').click()

  const panel = page.getByTestId('route-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('route-end')).toContainText('Visegrádi fellegvár')
  await expect(page.getByTestId('route-start')).toContainText('Saját helyem')

  const alts = page.getByTestId('route-alt')
  await expect(alts).toHaveCount(2)
  await expect(alts.first()).toContainText('36 km')
  await expect(alts.first()).toContainText('↑ 240 m · ↓ 20 m')
  // a kérés a túraprofillal ment
  const req = JSON.parse(decodeURIComponent(calls.at(-1)!.split('json=')[1]))
  expect(req.costing).toBe('pedestrian')
  expect(req.locations[0].lat).toBeCloseTo(MATYAS.lat, 4)

  // a térképen ott a vonal
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __terkepMap: { querySourceFeatures: (s: string) => unknown[] } }).__terkepMap.querySourceFeatures(
            'route',
          ).length,
      ),
    )
    .toBeGreaterThan(0)

  // útfelület-összetétel
  await expect(page.getByTestId('road-share')).toContainText('Közúton: 2,4 km (7%)')
  await expect(page.getByTestId('road-share')).toContainText('forgalmas út: 0,4 km')

  // változatváltás
  await alts.nth(1).click()
  await expect(alts.nth(1)).toHaveAttribute('aria-checked', 'true')

  // látnivalók az út mentén (a vonal két végén minta-látnivaló van)
  await expect(page.getByTestId('along')).toContainText('Mátyás-templom')

  // GPX
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('gpx').click()])
  expect(download.suggestedFilename()).toMatch(/^utvonal-.*\.gpx$/)
  const gpx = await (await download.createReadStream()).toArray()
  const text = Buffer.concat(gpx).toString('utf8')
  expect(text).toContain('<trkpt')
  expect(text).toContain('Visegrádi fellegvár')

  // profilváltás újratervez
  await page.getByTestId('profile-bike').click()
  await expect.poll(() => JSON.parse(decodeURIComponent(calls.at(-1)!.split('json=')[1])).costing).toBe('bicycle')
  await page.screenshot({ path: info.outputPath('utvonal.png') })
})

test('útvonalpont a térképről (jobb klikk / hosszú nyomás menü)', async ({ page }, info) => {
  test.skip(info.project.name !== 'asztali', 'egérrel')
  await mockServices(page)
  await open(page)
  const box = (await page.getByTestId('map').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await expect(page.getByTestId('point-menu')).toBeVisible()
  await page.getByTestId('ctx-start').click()
  await expect(page.getByTestId('route-panel')).toBeVisible()
  await expect(page.getByTestId('route-start')).toContainText('Térképi pont')

  // cél kijelölése „Térképről” módban
  await page.getByTestId('pick-end').click()
  await expect(page.getByTestId('pick-hint')).toBeVisible()
  await page.mouse.click(box.x + box.width / 2 + 120, box.y + box.height / 2 - 80)
  await expect(page.getByTestId('pick-hint')).toBeHidden()
  await expect(page.getByTestId('route-end')).toContainText('Térképi pont')
  await expect(page.getByTestId('route-alt').first()).toBeVisible()
})

test('Vissza gomb: bezárja a kártyát, és az appban maradunk', async ({ page }) => {
  await mockServices(page)
  await open(page)
  await openCard(page, 'baradla')
  await expect(page).toHaveURL(/[#&]p=/)
  await page.goBack()
  await expect(page.getByTestId('poi-card')).toBeHidden()
  await expect(page.getByTestId('result-count')).toBeHidden() // a lista fül maradt nyitva
  await expect(page.getByTestId('result-row').first()).toBeVisible()
  await expect(page).not.toHaveURL(/[#&]p=/)

  // útvonal-nézet: Vissza -> vissza a szűrőkhöz
  await page.getByTestId('tab-route').click()
  await expect(page.getByTestId('route-panel')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('route-panel')).toBeHidden()
  await expect(page.getByTestId('tab-filters')).toHaveAttribute('aria-selected', 'true')
})

test('360°-os körkép a kiemelt helynél (Commons), és Google utcakép link', async ({ page }, info) => {
  await mockServices(page)
  await open(page)
  // 2:1 arányú tesztkép (a böngészőben rajzolva)
  const png = Buffer.from(
    (
      await page.evaluate(() => {
        const c = document.createElement('canvas')
        c.width = 1024
        c.height = 512
        const g = c.getContext('2d')!
        const gr = g.createLinearGradient(0, 0, 1024, 0)
        gr.addColorStop(0, '#2f855a')
        gr.addColorStop(0.5, '#2b6cb0')
        gr.addColorStop(1, '#c05621')
        g.fillStyle = gr
        g.fillRect(0, 0, 1024, 512)
        return c.toDataURL('image/png')
      })
    ).split(',')[1],
    'base64',
  )
  await page.route(/commons\.wikimedia\.org\/w\/api\.php/, (r) =>
    r.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: {
        query: {
          pages: [
            {
              title: 'File:Baradla 360.jpg',
              coordinates: [{ lat: 48.4745, lon: 20.4951 }],
              categories: [{ title: 'Category:360° panoramas' }],
              imageinfo: [
                {
                  url: 'https://upload.wikimedia.org/test/baradla-360.png',
                  width: 8000,
                  height: 4000,
                  thumburl: 'https://upload.wikimedia.org/test/baradla-360.png',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Baradla_360.jpg',
                  extmetadata: { Artist: { value: 'Teszt Elek' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
                },
              ],
            },
          ],
        },
      },
    }),
  )
  await page.route('https://upload.wikimedia.org/test/**', (r) =>
    r.fulfill({ body: png, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } }),
  )

  await openCard(page, 'baradla')
  const card = page.getByTestId('poi-card')
  await expect(card.getByTestId('gsv-link')).toHaveAttribute('href', /map_action=pano&viewpoint=48\.474/)
  await expect(card.getByTestId('sv-search')).toBeVisible()
  await card.getByTestId('pano-open').click()
  const viewer = page.getByTestId('pano-viewer')
  await expect(viewer).toBeVisible()
  await expect(viewer).toContainText('Teszt Elek')
  await expect(viewer).toContainText('CC BY-SA 4.0')
  await expect(viewer.locator('canvas')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: info.outputPath('korkep.png') })
  // a bezárás gomb látható és kattintható (nem takarja a felső sáv)
  await viewer.getByTestId('pano-close').click()
  await expect(viewer).toBeHidden()
  await expect(card).toBeVisible()
  // Esc is bezárja
  await card.getByTestId('pano-open').click()
  await expect(viewer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
})

test('nem kiemelt helynél gombnyomásra keres; ha nincs felvétel, jelzi', async ({ page }) => {
  await mockServices(page)
  await page.route(/commons\.wikimedia\.org\/w\/api\.php/, (r) =>
    r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { batchcomplete: true } }),
  )
  await open(page, '#s=2,3')
  await page.getByTestId('tab-list').click()
  await page.getByTestId('result-row').first().locator('button').click()
  const card = page.getByTestId('poi-card')
  await card.getByTestId('pano-search').click()
  await expect(card.getByTestId('pano')).toContainText('nincs nyílt 360°-os felvétel')
})

test('útválasztás: autóút nélkül / legrövidebb -> a kérés paraméterei', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: MATYAS.lat, longitude: MATYAS.lon })
  const calls = await mockServices(page)
  await open(page)
  await openCard(page, 'fellegvár')
  await page.getByTestId('route-to').click()
  await expect(page.getByTestId('route-alt').first()).toBeVisible()
  const last = () => JSON.parse(decodeURIComponent(calls.at(-1)!.split('json=')[1]))
  expect(last().costing_options.pedestrian.walkway_factor).toBe(0.7) // alap: kis forgalmú utak

  await page.getByTestId('pref-avoid').click()
  await expect.poll(() => last().costing_options.pedestrian.walkway_factor).toBe(0.35)
  await expect(page.getByTestId('pref-avoid')).toHaveAttribute('aria-checked', 'true')

  await page.getByTestId('pref-shortest').click()
  await expect.poll(() => last().costing_options.pedestrian.shortest).toBe(true)

  await page.getByTestId('profile-car').click()
  await page.getByTestId('pref-nohighway').click()
  await expect.poll(() => last().costing_options.auto?.use_highways).toBe(0)
})

test('vibrálás ellen: a lap nem görget, mozgatáskor a térkép nem méreteződik újra', async ({ page }) => {
  await mockServices(page)
  await open(page)
  const scroll = await page.evaluate(() => ({
    sh: document.scrollingElement!.scrollHeight,
    h: window.innerHeight,
    overflow: getComputedStyle(document.body).overflow,
  }))
  expect(scroll.sh).toBeLessThanOrEqual(scroll.h)
  expect(scroll.overflow).toBe('hidden')

  await page.evaluate(() => {
    const m = (window as unknown as { __terkepMap: { on: (e: string, f: () => void) => void } }).__terkepMap
    ;(window as unknown as { __resizes: number }).__resizes = 0
    m.on('resize', () => (window as unknown as { __resizes: number }).__resizes++)
  })
  const box = (await page.getByTestId('map').boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 15; i++) await page.mouse.move(cx - i * 12, cy - i * 6)
  await page.mouse.up()
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => (window as unknown as { __resizes: number }).__resizes)).toBe(0)
})

test('kompatibilis mód: a térkép megőrzött rajzpufferrel újraépül, a nézet és a pontok maradnak', async ({ page }) => {
  await mockServices(page)
  await open(page, '#m=BZ')
  await page.waitForTimeout(900)
  const before = await page.evaluate(() => {
    const m = (window as unknown as { __terkepMap: { getZoom: () => number } }).__terkepMap
    return m.getZoom()
  })
  await page.getByTestId('layers-btn').click()
  await page.getByTestId('compat-map').check()
  const attrs = () =>
    page.evaluate(() => {
      const m = (
        window as unknown as {
          __terkepMap: { getCanvas: () => HTMLCanvasElement; getZoom: () => number; querySourceFeatures: (s: string) => unknown[] }
        }
      ).__terkepMap
      const gl = m.getCanvas().getContext('webgl2')
      return {
        preserve: gl?.getContextAttributes()?.preserveDrawingBuffer ?? null,
        zoom: m.getZoom(),
        pois: m.querySourceFeatures('pois').length > 0,
      }
    })
  await expect.poll(async () => (await attrs()).preserve).toBe(true)
  await expect.poll(async () => (await attrs()).pois).toBe(true)
  expect((await attrs()).zoom).toBeCloseTo(before, 1)
  // megmarad újratöltés után is
  await page.reload()
  await expect(page.getByTestId('result-count')).toBeVisible()
  await expect.poll(async () => (await attrs()).preserve).toBe(true)
})

test('Google-utcakép az appban, ha a pipeline talált felvételt (a látnivaló felé fordulva)', async ({ page }) => {
  await mockServices(page)
  // a Baradla részleteibe utcakép-adat (mint a valós adatfrissítés után)
  await page.route('**/data/details/BZ.json', async (route) => {
    const res = await route.fetch()
    const json = await res.json()
    json['sample:baradla-barlang'] = { ...json['sample:baradla-barlang'], sv: { lat: 48.4731, lon: 20.4962, h: 21 } }
    await route.fulfill({ response: res, json })
  })
  await page.route(/commons\.wikimedia\.org\/w\/api\.php/, (r) =>
    r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { batchcomplete: true } }),
  )
  await open(page)
  await openCard(page, 'baradla')
  const card = page.getByTestId('poi-card')
  await card.getByTestId('sv-open').click()
  const viewer = page.getByTestId('pano-viewer')
  await expect(viewer).toBeVisible()
  const src = await viewer.getByTestId('pano-iframe').getAttribute('src')
  const u = new URL(src!)
  expect(u.pathname).toBe('/maps/embed/v1/streetview')
  expect(u.searchParams.get('location')).toBe('48.473100,20.496200')
  expect(u.searchParams.get('heading')).toBe('21')
  expect(u.searchParams.get('key')).toBeTruthy()
  await expect(viewer).toContainText('Google')
  await viewer.getByTestId('pano-close').click()
  await expect(viewer).toBeHidden()
})

test('szűrő: csak 360°-os képpel', async ({ page }) => {
  await mockServices(page)
  await open(page)
  await page.getByText('360°-os képpel').click()
  await expect(page).toHaveURL(/j=360/)
  // a mintaadatban nincs utcakép-adat -> üres lista
  await expect(page.getByTestId('result-count')).toContainText('0')
})
