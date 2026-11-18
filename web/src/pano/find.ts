// 360°-os körképek keresése egy hely közelében, nyílt forrásokból:
//  - Wikimedia Commons: gömbpanorámák (equirectangular, 2:1 oldalarány);
//  - Mapillary: 360°-os utcaképek (csak ha van ügyféltoken, VITE_MAPILLARY_TOKEN).
// A Google utcakép csak külső linkként jelenik meg (kulcs nélkül nem ágyazható be).

import { haversineM } from '../route/geo'

export interface Pano {
  source: 'commons' | 'mapillary'
  id: string
  lat: number
  lon: number
  distM: number
  title: string
  /** a nézegetőnek: equirectangular kép URL-je (Commons) */
  url?: string
  thumb?: string
  author?: string
  license?: string
  licenseUrl?: string
  pageUrl?: string
}

export const MAPILLARY_TOKEN: string = import.meta.env.VITE_MAPILLARY_TOKEN ?? ''

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export function googleStreetViewUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`
}

const PANO_CAT = /360|panoram|spherical|equirectangular|photosphere|gömbpanor/i

/** Gömbpanoráma-e: 2:1 oldalarány és elég nagy felbontás (vagy ilyen kategória). */
export function isEquirect(width: number, height: number, categories: string[] = []): boolean {
  if (!width || !height) return false
  const ratio = width / height
  if (Math.abs(ratio - 2) <= 0.04 && width >= 3000) return true
  return Math.abs(ratio - 2) <= 0.1 && width >= 2000 && categories.some((c) => PANO_CAT.test(c))
}

export function commonsQueryUrl(lat: number, lon: number, radiusM = 500): string {
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
    if (!isEquirect(ii.width, ii.height, cats)) continue
    const md = ii.extmetadata ?? {}
    out.push({
      source: 'commons',
      id: p.title,
      lat: c.lat,
      lon: c.lon,
      distM: Math.round(haversineM(lat, lon, c.lat, c.lon)),
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
  return out.sort((a, b) => a.distM - b.distM)
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
