import { describe, expect, it } from 'vitest'
import { settlementOf } from '../../src/data/decode'
import type { Meta } from '../../src/data/types'
import { compareHu, fold } from '../../src/filters/text'
import { geoUri, sourceUrl } from '../../src/ui/links'
import { sampleIndex } from './fixtures'

describe('dekódolás', () => {
  it('koordináták, azonosítók, település', () => {
    const ix = sampleIndex()
    expect(ix.lat[0]).toBeCloseTo(47.7942, 4)
    expect(ix.byId.get('Q3')).toBe(2)
    expect(settlementOf(ix, 2)).toBe('Aggtelek')
    expect(ix.score[0]).toBeCloseTo(12)
  })
})

describe('szöveg', () => {
  it('fold egyezik a pipeline-éval', () => {
    expect(fold('Szent György-hegy')).toBe('szent gyorgy hegy')
    expect(fold('Őrség – Ű')).toBe('orseg u')
  })

  it('magyar ábécé: a „cs”, „sz”, „zs” önálló betű', () => {
    // Unicode szerint „Cs” < „Cu” lenne; a magyar ábécében c < cs
    expect(compareHu('Cukor', 'Csesznek')).toBeLessThan(0)
    expect(compareHu('Szuha', 'Sztána')).toBeGreaterThan(0)
    // o = ó (azonos betű), de ö külön betű az o után
    expect(['Zsámbék', 'Öreg', 'Zutor', 'Ozora', 'Ócsa'].sort(compareHu)).toEqual(['Ócsa', 'Ozora', 'Öreg', 'Zutor', 'Zsámbék'])
  })
})

describe('linkek', () => {
  const meta = {
    sources: {
      osm: { label: 'OSM', url: 'https://www.openstreetmap.org/{ref}', license: '', kind: 'open' },
      wikidata: { label: 'WD', url: 'https://www.wikidata.org/wiki/{ref}', license: '', kind: 'open' },
      huwiki: { label: 'Wiki', url: 'https://hu.wikipedia.org/wiki/{ref}', license: '', kind: 'editorial' },
      kektura: { label: 'Kék', url: 'https://kektura.hu{ref}', license: '', kind: 'editorial' },
    },
  } as unknown as Meta

  it('OSM-elemtípusok', () => {
    expect(sourceUrl(meta, 'osm', 'n123')).toBe('https://www.openstreetmap.org/node/123')
    expect(sourceUrl(meta, 'osm', 'w5')).toBe('https://www.openstreetmap.org/way/5')
    expect(sourceUrl(meta, 'osm', 'r9')).toBe('https://www.openstreetmap.org/relation/9')
  })

  it('Wikipédia-cím kódolása', () => {
    expect(sourceUrl(meta, 'huwiki', 'Egri vár')).toBe('https://hu.wikipedia.org/wiki/Egri_v%C3%A1r')
  })

  it('harmadik fél: útvonal', () => {
    expect(sourceUrl(meta, 'kektura', '/okt/pecsetelohely#1')).toBe('https://kektura.hu/okt/pecsetelohely#1')
    expect(sourceUrl(meta, 'ismeretlen', 'x')).toBeNull()
  })

  it('geo: URI Androidhoz', () => {
    expect(geoUri(47.5, 19.04, 'Lánchíd')).toBe('geo:47.5,19.04?q=47.5,19.04(L%C3%A1nch%C3%ADd)')
  })
})
