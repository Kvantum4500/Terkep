import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS } from '../../src/filters/filter'
import { parseHash, toHash } from '../../src/filters/urlState'

const COUNTIES = ['BU', 'PE', 'BZ']
const CATS = ['var', 'templom', 'barlang']

describe('URL hash', () => {
  it('alapállapot üres hash', () => {
    expect(toHash({ filters: DEFAULT_FILTERS, selected: null })).toBe('')
    expect(parseHash('', COUNTIES, CATS)).toEqual({ filters: DEFAULT_FILTERS, selected: null })
  })

  it('oda-vissza alakítás', () => {
    const state = {
      filters: {
        counties: ['PE', 'BU'],
        cats: ['templom'],
        tiers: [1, 2, 3] as (1 | 2 | 3)[],
        q: 'Szent Anna',
        showcave: true,
        kektura: false,
        heritage: true,
      },
      selected: 'Q42',
    }
    const hash = toHash(state)
    expect(hash).toBe('#m=BU,PE&k=templom&s=1,2,3&q=Szent+Anna&j=barlang,muemlek&p=Q42')
    const back = parseHash(hash, COUNTIES, CATS)
    expect(back.selected).toBe('Q42')
    expect(back.filters).toEqual({ ...state.filters, counties: ['BU', 'PE'] })
  })

  it('ismeretlen kódokat eldob', () => {
    const st = parseHash('#m=PE,XX&k=var,ufo&s=1,7', COUNTIES, CATS)
    expect(st.filters.counties).toEqual(['PE'])
    expect(st.filters.cats).toEqual(['var'])
    expect(st.filters.tiers).toEqual([1])
  })
})
