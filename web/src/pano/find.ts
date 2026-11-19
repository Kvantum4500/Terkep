// 360°-os körképek egy hely közelében:
//  - Google-utcakép: a pipeline előre megnézte, hol van felvétel (details.sv); az app a
//    Maps Embed API-val ágyazza be (böngészőkulcs: VITE_GOOGLE_MAPS_EMBED_KEY);
//  - Wikidata-gömbkép (P4640, details.pano) és Wikimedia Commons-keresés: gömbpanorámák
//    (2:1) és 360°-os körpanorámák;
//  - Mapillary: 360°-os utcaképek (csak ha van ügyféltoken, VITE_MAPILLARY_TOKEN).
// Kulcs nélkül a Google-utcakép külső linkként nyílik.

import { haversineM } from '../route/geo'

export interface Pano {
  source: 'google' | 'commons' | 'mapillary'
  id: string
  lat: number
  lon: number
  /** távolság a látnivalótól (ismeretlen: undefined) */
  distM?: number
  title: string
  /** gömb (2:1) vagy 360°-os körpanoráma (széles, csak vízszintesen forgatható) */
  kind?: 'sphere' | 'cylinder'
  /** körpanorámánál a függőleges látószög (fok) */
  vaov?: number
  /** a nézegetőnek: equirectangular kép URL-je (Commons) */
  url?: string
  thumb?: string
  author?: string
  license?: string
  licenseUrl?: string
  pageUrl?: string
}

export const MAPILLARY_TOKEN: string = import.meta.env.VITE_MAPILLARY_TOKEN ?? ''
export const GOOGLE_EMBED_KEY: string = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY ?? ''

const EMBED_SV = 'https://www.google.com/maps/embed/v1/streetview'

/** Beágyazott Google-utcakép (Maps Embed API, ingyenes; a kulcs a weboldal címére korlátozva). */
export function googleEmbedUrl(key: string, lat: number, lon: number, heading?: number): string {
  const q = new URLSearchParams({ key, location: `${lat.toFixed(6)},${lon.toFixed(6)}`, fov: '90', pitch: '0', language: 'hu', region: 'HU' })
  if (heading !== undefined) q.set('heading', String(Math.round(heading)))
  return `${EMBED_SV}?${q.toString()}`
}

/** Az előre ismert utcakép (pipeline) a látnivaló felé fordulva. */
export function googlePano(
  sv: { lat: number; lon: number; h: number },
  poiLat: number,
  poiLon: number,
  key = GOOGLE_EMBED_KEY,
): Pano | null {
  if (!key) return null
  return {
    source: 'google',
    id: 'google',
    lat: sv.lat,
    lon: sv.lon,
    distM: Math.round(haversineM(poiLat, poiLon, sv.lat, sv.lon)),
    title: 'Google utcakép',
    url: googleEmbedUrl(key, sv.lat, sv.lon, sv.h),
  }
}

/** Előzetes adat nélkül: a Google a hely legközelebbi felvételét mutatja (ha van). */
export function googleSearchPano(lat: number, lon: number, key = GOOGLE_EMBED_KEY): Pano | null {
  if (!key) return null
  return { source: 'google', id: 'google-search', lat, lon, title: 'Google utcakép (legközelebbi felvétel)', url: googleEmbedUrl(key, lat, lon) }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export function googleStreetViewUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`
}

const PANO_WORD = /360|panoram|spherical|equirectangular|photosphere|gömbpanor|körpanor/i

/**
 * Gömbpanoráma (2:1) vagy 360°-os körpanoráma (legalább 3,5:1 és „360” a címben vagy
 * kategóriában) – ugyanaz a szabály, mint a pipeline pano-auditjában.
 */
export function classifyPano(
  width: number,
  height: number,
  title = '',
  categories: string[] = [],
): 'sphere' | 'cylinder' | null {
  if (!width || !height) return null
  const ratio = width / height
  const tagged = PANO_WORD.test(title) || categories.some((c) => PANO_WORD.test(c))
  if (Math.abs(ratio - 2) <= 0.04 && width >= 3000) return 'sphere'
  if (Math.abs(ratio - 2) <= 0.1 && width >= 2000 && tagged) return 'sphere'
  const has360 = title.includes('360') || categories.some((c) => c.includes('360'))
  if (ratio >= 3.5 && width >= 3000 && has360) return 'cylinder'
  return null
}

/** Gömbpanoráma-e (2:1). */
export function isEquirect(width: number, height: number, categories: string[] = []): boolean {
  return classifyPano(width, height, '', categories) === 'sphere'
}

export function commonsQueryUrl(lat: number, lon: number, radiusM = 1000): string {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'geosearch',
    ggscoord: `${lat}|${lon}`,
    ggsradius: String(radiusM),
    ggsnamespace: '6',
    ggslimit: '50',
    prop: 'imageinfo|categories|coordinates',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '4096',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
    clshow: '!hidden',
    cllimit: 'max',
  })
  return `https://commons.wikimedia.org/w/api.php?${q.toString()}`
}

const stripHtml = (s?: string) =>
  s ? s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || undefined : undefined

interface CommonsPage {
  title: string
  coordinates?: { lat: number; lon: number }[]
  categories?: { title: string }[]
  imageinfo?: {
    url: string
    thumburl?: string
    width: number
    height: number
    descriptionurl?: string
    extmetadata?: Record<string, { value: string } | undefined>
  }[]
}

export function parseCommons(json: { query?: { pages?: CommonsPage[] } }, lat: number, lon: number): Pano[] {
  const out: Pano[] = []
  for (const p of json.query?.pages ?? []) {
    const ii = p.imageinfo?.[0]
    const c = p.coordinates?.[0]
    if (!ii || !c) continue
    const cats = (p.categories ?? []).map((x) => x.title)
    const kind = classifyPano(ii.width, ii.height, p.title, cats)
    if (!kind) continue
    const md = ii.extmetadata ?? {}
    out.push({
      source: 'commons',
      id: p.title,
      lat: c.lat,
      lon: c.lon,
      distM: Math.round(haversineM(lat, lon, c.lat, c.lon)),
      kind,
      vaov: kind === 'cylinder' ? (360 * ii.height) / ii.width : undefined,
      title: p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
      // a 4096 px széles változat a legtöbb telefon WebGL-textúrakorlátján belül van
      url: ii.width > 4096 && ii.thumburl ? ii.thumburl : ii.url,
      thumb: ii.thumburl,
      author: stripHtml(md.Artist?.value),
      license: md.LicenseShortName?.value,
      licenseUrl: md.LicenseUrl?.value,
      pageUrl: ii.descriptionurl,
    })
  }
  // a gömbpanorámák előre, utánuk a körpanorámák; azon belül távolság szerint
  return out.sort((a, b) => Number(a.kind === 'cylinder') - Number(b.kind === 'cylinder') || a.distM! - b.distM!)
}

/** Egy ismert Commons-fájl (pl. Wikidata P4640 gömbkép) adatai a nézegetőhöz. */
export async function commonsFilePano(
  file: string,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
): Promise<Pano | null> {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    titles: `File:${file}`,
    prop: 'imageinfo|coordinates',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '4096',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
  })
  const res = await fetchFn(`https://commons.wikimedia.org/w/api.php?${q.toString()}`)
  if (!res.ok) return null
  const json = (await res.json()) as { query?: { pages?: CommonsPage[] } }
  const p = json.query?.pages?.[0]
  const ii = p?.imageinfo?.[0]
  if (!p || !ii) return null
  const md = ii.extmetadata ?? {}
  const c = p.coordinates?.[0]
  return {
    source: 'commons',
    id: p.title,
    lat: c?.lat ?? NaN,
    lon: c?.lon ?? NaN,
    kind: 'sphere',
    title: p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
    url: ii.width > 4096 && ii.thumburl ? ii.thumburl : ii.url,
    thumb: ii.thumburl,
    author: stripHtml(md.Artist?.value),
    license: md.LicenseShortName?.value,
    licenseUrl: md.LicenseUrl?.value,
    pageUrl: ii.descriptionurl,
  }
}

export async function findCommonsPanos(lat: number, lon: number, fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<Pano[]> {
  const res = await fetchFn(commonsQueryUrl(lat, lon))
  if (!res.ok) throw new Error(`Commons: ${res.status}`)
  return parseCommons(await res.json(), lat, lon)
}

export function mapillaryQueryUrl(lat: number, lon: number, token: string, radiusM = 150): string {
  const dLat = radiusM / 110540
  const dLon = radiusM / (Math.cos((lat * Math.PI) / 180) * 111320)
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((x) => x.toFixed(6)).join(',')
  const q = new URLSearchParams({
    access_token: token,
    fields: 'id,computed_geometry,geometry,captured_at,thumb_256_url',
    bbox,
    is_pano: 'true',
    limit: '50',
  })
  return `https://graph.mapillary.com/images?${q.toString()}`
}

interface MapillaryImage {
  id: string
  computed_geometry?: { coordinates: [number, number] }
  geometry?: { coordinates: [number, number] }
  captured_at?: number
  thumb_256_url?: string
}

export function parseMapillary(json: { data?: MapillaryImage[] }, lat: number, lon: number, max = 5): Pano[] {
  return (json.data ?? [])
    .map((im) => {
      const [plon, plat] = (im.computed_geometry ?? im.geometry)?.coordinates ?? [NaN, NaN]
      const year = im.captured_at ? new Date(im.captured_at).getFullYear() : undefined
      return {
        source: 'mapillary' as const,
        id: im.id,
        lat: plat,
        lon: plon,
        distM: Math.round(haversineM(lat, lon, plat, plon)),
        title: year ? `Mapillary utcakép (${year})` : 'Mapillary utcakép',
        thumb: im.thumb_256_url,
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        pageUrl: `https://www.mapillary.com/app/?pKey=${im.id}`,
      }
    })
    .filter((p) => Number.isFinite(p.distM))
    .sort((a, b) => a.distM - b.distM)
    .slice(0, max)
}

export async function findMapillaryPanos(
  lat: number,
  lon: number,
  token: string = MAPILLARY_TOKEN,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
): Promise<Pano[]> {
  if (!token) return []
  const res = await fetchFn(mapillaryQueryUrl(lat, lon, token))
  if (!res.ok) throw new Error(`Mapillary: ${res.status}`)
  return parseMapillary(await res.json(), lat, lon)
}

/**
 * Mindkét forrás; az egyik hibája nem akadályozza a másikat. A Mapillary-felvételek
 * előre kerülnek (utcaszintről). Ha minden megkérdezett forrás hibázott, hibát dob
 * (különben „nincs felvétel” jelenne meg akkor is, ha csak a hálózat hiányzik).
 */
export async function findPanos(lat: number, lon: number, fetchFn?: FetchFn, token = MAPILLARY_TOKEN): Promise<Pano[]> {
  const tasks = [findCommonsPanos(lat, lon, fetchFn)]
  if (token) tasks.unshift(findMapillaryPanos(lat, lon, token, fetchFn))
  const settled = await Promise.allSettled(tasks)
  if (settled.every((s) => s.status === 'rejected')) throw new Error('A körképek nem tölthetők be.')
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
}
