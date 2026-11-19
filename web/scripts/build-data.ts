// A pipeline kimenetét (data/*.ndjson) a böngészőnek kényelmes formára alakítja:
//   public/data/index.json        – oszlopos index a szűréshez és a térképhez
//   public/data/details/<CC>.json – vármegyénkénti részletek (leírás, kép, források)
//   public/data/meta.json, megyek.geojson
// és ellenőrzi a mérethatárokat (mobilra).
//
// Forrás: TERKEP_DATA környezeti változó, különben ../data (ha van pois.ndjson),
// különben ../data/sample (kézi mintaadat).
//
// Futtatás: node scripts/build-data.ts  (Node 22+ típuseltávolítással)

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const outDir = resolve(here, '..', 'public', 'data')

const KB = 1024
const BUDGET = {
  indexGzip: 1536 * KB,
  detailsGzipTotal: 3072 * KB,
  detailsGzipPerCounty: 400 * KB,
  countiesGzip: 150 * KB,
  trailsGzip: 3072 * KB,
}

function pickDataDir(): string {
  const env = process.env.TERKEP_DATA
  if (env) return resolve(env)
  const real = join(repo, 'data')
  return existsSync(join(real, 'pois.ndjson')) ? real : join(real, 'sample')
}

interface Row {
  id: string
  name: string
  cat: string
  lat: number
  lon: number
  county: string
  tier: number
  score: number
  flags: number
  sources: { s: string; ref: string }[]
  sub?: string
  settlement?: string
  wikidata?: string
  osm?: string
  huwiki?: string
  desc?: string
  ele?: number
  img?: { file: string; artist?: string; license?: string; license_url?: string }
  sv?: { lat: number; lon: number; h: number }
  pano?: string
  alt?: string[]
}

const dataDir = pickDataDir()
const rows: Row[] = readFileSync(join(dataDir, 'pois.ndjson'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
const meta = JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf8'))
const catKeys: string[] = Object.keys(meta.categories)
const countyKeys: string[] = Object.keys(meta.counties)
const settlements: string[] = [...new Set(rows.map((r) => r.settlement).filter((s): s is string => !!s))].sort(
  (a, b) => a.localeCompare(b, 'hu'),
)
const settlementIdx = new Map(settlements.map((s, i) => [s, i]))

// Pontszám szerint csökkenő sorrend: a térképen a fontosabb pont nyer, és a
// lista alapértelmezett sorrendje is ez.
rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))

const index = {
  v: 1,
  n: rows.length,
  cats: catKeys,
  counties: countyKeys,
  settlements,
  id: rows.map((r) => r.id),
  name: rows.map((r) => r.name),
  lat: rows.map((r) => Math.round(r.lat * 1e5)),
  lon: rows.map((r) => Math.round(r.lon * 1e5)),
  c: rows.map((r) => catKeys.indexOf(r.cat)),
  m: rows.map((r) => countyKeys.indexOf(r.county)),
  t: rows.map((r) => r.tier),
  f: rows.map((r) => r.flags),
  s: rows.map((r) => (r.settlement ? (settlementIdx.get(r.settlement) as number) : -1)),
  sc: rows.map((r) => Math.round(r.score * 10)),
}
if (index.c.includes(-1) || index.m.includes(-1)) throw new Error('Ismeretlen kategória vagy vármegye az adatban')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(join(outDir, 'details'), { recursive: true })

function write(name: string, obj: unknown): number {
  const text = JSON.stringify(obj)
  writeFileSync(join(outDir, name), text)
  return gzipSync(text).length
}

const problems: string[] = []
const indexGz = write('index.json', index)
if (indexGz > BUDGET.indexGzip) problems.push(`index.json gzip ${indexGz} > ${BUDGET.indexGzip}`)

let detailsTotal = 0
for (const code of countyKeys) {
  const details: Record<string, unknown> = {}
  for (const r of rows) {
    if (r.county !== code) continue
    const d: Record<string, unknown> = { sources: r.sources }
    for (const k of ['sub', 'desc', 'ele', 'img', 'alt', 'sv', 'pano', 'wikidata', 'osm', 'huwiki'] as const) {
      if (r[k] !== undefined) d[k] = r[k]
    }
    details[r.id] = d
  }
  const gz = write(`details/${code}.json`, details)
  detailsTotal += gz
  if (gz > BUDGET.detailsGzipPerCounty) problems.push(`details/${code}.json gzip ${gz} > ${BUDGET.detailsGzipPerCounty}`)
}
if (detailsTotal > BUDGET.detailsGzipTotal) problems.push(`details összesen ${detailsTotal} > ${BUDGET.detailsGzipTotal}`)

write('meta.json', meta)
const counties = readFileSync(join(repo, 'data', 'megyek.geojson'), 'utf8')
writeFileSync(join(outDir, 'megyek.geojson'), counties)
const countiesGz = gzipSync(counties).length
if (countiesGz > BUDGET.countiesGzip) problems.push(`megyek.geojson gzip ${countiesGz} > ${BUDGET.countiesGzip}`)

// jelzett turistautak (ha a pipeline előállította): változatlanul átmásoljuk
let trailsGz = 0
const trailsDir = join(dataDir, 'trails')
if (existsSync(join(trailsDir, 'index.json'))) {
  mkdirSync(join(outDir, 'trails'), { recursive: true })
  for (const f of readdirSync(trailsDir).filter((x) => x.endsWith('.json'))) {
    const text = readFileSync(join(trailsDir, f), 'utf8')
    writeFileSync(join(outDir, 'trails', f), text)
    trailsGz += gzipSync(text).length
  }
  if (trailsGz > BUDGET.trailsGzip) problems.push(`turistautak gzip ${trailsGz} > ${BUDGET.trailsGzip}`)
}

console.log(
  `adat: ${dataDir} -> ${outDir}\n` +
    `  ${rows.length} látnivaló${meta.sample ? ' (MINTAADAT)' : ''}; index ${(indexGz / KB).toFixed(0)} KB gz, ` +
    `részletek ${(detailsTotal / KB).toFixed(0)} KB gz, határok ${(countiesGz / KB).toFixed(0)} KB gz, ` +
    `turistautak ${(trailsGz / KB).toFixed(0)} KB gz`,
)
if (problems.length) {
  console.error('Mérethatár túllépve:\n  ' + problems.join('\n  '))
  process.exit(1)
}
