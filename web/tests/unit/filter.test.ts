import { describe, expect, it } from 'vitest'
import { applyFilters, DEFAULT_FILTERS, type FilterState, isDefault, toggle } from '../../src/filters/filter'
import { sampleIndex } from './fixtures'

const ix = sampleIndex()
const all: FilterState = { ...DEFAULT_FILTERS, tiers: [] }
const ids = (f: FilterState) => Array.from(applyFilters(ix, f).indices, (i) => ix.id[i])

describe('applyFilters', () => {
  it('alapértelmezés: kiemelt + érdekes', () => {
    expect(ids(DEFAULT_FILTERS)).toEqual(['Q1', 'Q2', 'Q3', 'n4', 'n5'])
  })

  it('üres szintlista = minden szint', () => {
    expect(ids(all)).toHaveLength(6)
  })

  it('csak várak országosan', () => {
    expect(ids({ ...all, cats: ['var'] })).toEqual(['Q1'])
  })

  it('csak Pest vármegye', () => {
    expect(ids({ ...all, counties: ['PE'] })).toEqual(['Q1', 'n4', 'w6'])
  })

  it('Pest vármegye templomai', () => {
    expect(ids({ ...all, counties: ['PE'], cats: ['templom'] })).toEqual(['n4', 'w6'])
  })

  it('több vármegye és kategória kombinálható', () => {
    expect(ids({ ...all, counties: ['PE', 'BU'], cats: ['templom', 'barlang'] })).toEqual(['Q2', 'n4', 'n5', 'w6'])
  })

  it('ékezetfüggetlen keresés névben és településben', () => {
    expect(ids({ ...all, q: 'BARADLA' })).toEqual(['Q3'])
    expect(ids({ ...all, q: 'vac' })).toEqual(['n4', 'w6'])
    expect(ids({ ...all, q: 'pal volgyi' })).toEqual(['n5'])
  })

  it('jelzők: látogatható barlang, műemlék', () => {
    expect(ids({ ...all, showcave: true })).toEqual(['Q3', 'n5'])
    expect(ids({ ...all, showcave: true, heritage: true })).toEqual(['Q3'])
  })

  it('facet-számok: a saját dimenzió szűrője nélkül', () => {
    const r = applyFilters(ix, { ...all, counties: ['PE'], cats: ['templom'] })
    // vármegyénként: templomok (a vármegye-szűrő figyelmen kívül)
    expect(r.countyCounts).toEqual({ BU: 1, PE: 2, BZ: 0 })
    // kategóriánként: Pest (a kategória-szűrő figyelmen kívül)
    expect(r.catCounts).toEqual({ var: 1, templom: 2, barlang: 0 })
    expect(r.tierCounts).toEqual({ 1: 0, 2: 1, 3: 1 })
  })

  it('a sorrend a pontszám szerinti marad', () => {
    const r = applyFilters(ix, all)
    const scores = Array.from(r.indices, (i) => ix.score[i])
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })
})

describe('segédfüggvények', () => {
  it('toggle', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('isDefault', () => {
    expect(isDefault(DEFAULT_FILTERS)).toBe(true)
    expect(isDefault({ ...DEFAULT_FILTERS, q: 'x' })).toBe(false)
  })
})
