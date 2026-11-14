import type { Meta } from '../data/types'

const OSM_KIND: Record<string, string> = { n: 'node', w: 'way', r: 'relation' }

/** A forrásrekord hivatkozása (a meta.json URL-sablonja szerint). */
export function sourceUrl(meta: Meta, source: string, ref: string): string | null {
  const tpl = meta.sources[source]?.url
  if (!tpl) return null
  if (source === 'osm') {
    const kind = OSM_KIND[ref[0]]
    return kind ? `https://www.openstreetmap.org/${kind}/${ref.slice(1)}` : null
  }
  if (source === 'huwiki' || source === 'commons') {
    return tpl.replace('{ref}', encodeURIComponent(ref.replace(/ /g, '_')))
  }
  if (source === 'wikidata') return tpl.replace('{ref}', encodeURIComponent(ref))
  // harmadik féltől: a ref az oldal URL-útvonala
  return tpl.replace('{ref}', ref.startsWith('/') ? encodeURI(ref) : `/${encodeURI(ref)}`)
}

export function commonsThumb(file: string, width = 640): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=${width}`
}

export function commonsPage(file: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`
}

export function osmMapUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`
}

export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
}

/** Androidon (pl. Samsung) a telepített navigációs appot nyitja meg. */
export function geoUri(lat: number, lon: number, name: string): string {
  return `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(name)})`
}
