import { expect, type Page, test } from '@playwright/test'

// A tesztek a kézi mintaadaton futnak (determinisztikus), alaptérkép nélkül
// (?basemap=none), így nem függnek a csempeszerverektől.

interface Row {
  id: string
  name: string
  cat: string
  county: string
  tier: number
}

async function visible(page: Page): Promise<Row[]> {
  return page.evaluate(() => (window as unknown as { __terkep: { visible: () => Row[] } }).__terkep.visible())
}

async function resultCount(page: Page): Promise<number> {
  const text = await page.getByTestId('result-count').locator('strong').innerText()
  return Number(text.replace(/\s/g, ''))
}

async function expectMapRendered(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = (
            window as unknown as {
              __terkepMap: { querySourceFeatures: (s: string) => unknown[] }
            }
          ).__terkepMap
          return {
            counties: m.querySourceFeatures('counties').length > 0,
            pois: m.querySourceFeatures('pois').length > 0,
          }
        }),
      { timeout: 20_000 },
    )
    .toEqual({ counties: true, pois: true })
}

async function open(page: Page, hash = '') {
  await page.goto(`./?basemap=none${hash}`)
  await expect(page.getByTestId('result-count')).toBeVisible()
  // mobilon kinyitjuk a panelt
  const sheet = page.getByTestId('sheet')
  if ((await sheet.getAttribute('class'))?.includes('sheet-peek') && (page.viewportSize()?.width ?? 0) < 900) {
    await page.getByRole('button', { name: 'Panel méretezése' }).click()
    await expect(sheet).toHaveClass(/sheet-half/)
  }
}

test('betölt, mintaadat-jelzés és térkép', async ({ page }) => {
  await open(page)
  await expect(page.getByTestId('sample-banner')).toBeVisible()
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  expect(await resultCount(page)).toBeGreaterThan(50)
  // a térkép tényleg kirajzolta a vármegyéket és a pontokat (a háttérszál működik)
  await expectMapRendered(page)
})

test('szűrés: várak -> Pest -> Pest templomai, és megmarad újratöltés után', async ({ page }, info) => {
  await open(page)

  await page.getByTestId('cat-var').click()
  let rows = await visible(page)
  expect(rows.length).toBeGreaterThan(5)
  expect(rows.every((r) => r.cat === 'var')).toBe(true)
  expect(await resultCount(page)).toBe(rows.length)

  await page.getByTestId('county-PE').click()
  rows = await visible(page)
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.every((r) => r.cat === 'var' && r.county === 'PE')).toBe(true)

  await page.getByTestId('cat-var').click()
  await page.getByTestId('cat-templom').click()
  rows = await visible(page)
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.every((r) => r.cat === 'templom' && r.county === 'PE')).toBe(true)
  await expect(page).toHaveURL(/#m=PE&k=templom/)

  const before = rows.map((r) => r.id)
  await page.reload()
  await expect(page.getByTestId('result-count')).toBeVisible()
  expect((await visible(page)).map((r) => r.id)).toEqual(before)
  await expect(page.getByTestId('cat-templom')).toHaveAttribute('aria-pressed', 'true')

  await expectMapRendered(page)
  await page.waitForTimeout(900) // a ráközelítés animációja
  await page.screenshot({ path: info.outputPath('szures.png') })
})

test('megosztott link közvetlenül szűr', async ({ page }) => {
  await open(page, '#m=BZ&k=barlang&s=1,2,3')
  const rows = await visible(page)
  expect(rows.map((r) => r.name)).toContain('Baradla-barlang')
  expect(rows.every((r) => r.county === 'BZ' && r.cat === 'barlang')).toBe(true)
})

test('keresés, lista és részletkártya', async ({ page }, info) => {
  await open(page)
  await page.getByTestId('search').fill('baradla')
  await page.getByTestId('tab-list').click()
  const row = page.getByTestId('result-row').first()
  await expect(row).toContainText('Baradla-barlang')
  await row.locator('button').click()

  const card = page.getByTestId('poi-card')
  await expect(card).toBeVisible()
  await expect(card.getByRole('heading', { level: 2 })).toHaveText('Baradla-barlang')
  await expect(card).toContainText('Borsod-Abaúj-Zemplén')
  await expect(card).toContainText('csak vezetéssel')
  await expect(card.getByTestId('sources')).toBeVisible()
  await expect(card.getByRole('link', { name: 'Navigáció' })).toHaveAttribute('href', /^geo:48\.47/)
  await expect(page).toHaveURL(/p=sample%3Abaradla-barlang|p=sample:baradla-barlang/)
  await expectMapRendered(page)
  await page.waitForTimeout(1000) // a ráközelítés animációja
  await page.screenshot({ path: info.outputPath('kartya.png') })

  await card.getByRole('button', { name: 'Bezárás' }).click()
  await expect(card).toBeHidden()
})

test('névjegy: források és licencek', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Az adatokról' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('ODbL')
  await expect(dialog).toContainText('csak tényeket')
  await dialog.getByRole('button', { name: 'Bezárás' }).click()
  await expect(dialog).toBeHidden()
})

test('offline is működik (service worker)', async ({ page, context }) => {
  await open(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  // az első betöltés után a SW átveszi a lapot
  await page.reload()
  await expect(page.getByTestId('result-count')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 })
    .toBe(true)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('result-count')).toBeVisible()
  expect(await resultCount(page)).toBeGreaterThan(50)
  await expectMapRendered(page)
  await context.setOffline(false)
})
