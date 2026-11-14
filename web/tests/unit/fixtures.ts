import { decodeIndex } from '../../src/data/decode'
import type { RawIndex } from '../../src/data/types'

/** Kis, kézzel írt index a szűrőtesztekhez (pontszám szerint csökkenő sorrend). */
export function sampleIndex() {
  const raw: RawIndex = {
    v: 1,
    n: 6,
    cats: ['var', 'templom', 'barlang'],
    counties: ['BU', 'PE', 'BZ'],
    settlements: ['Aggtelek', 'Budapest', 'Visegrád', 'Vác'],
    id: ['Q1', 'Q2', 'Q3', 'n4', 'n5', 'w6'],
    name: ['Visegrádi fellegvár', 'Mátyás-templom', 'Baradla-barlang', 'Váci székesegyház', 'Pál-völgyi-barlang', 'Kis kápolna'],
    lat: [4779420, 4750200, 4847400, 4777680, 4753360, 4775000],
    lon: [1898110, 1903440, 2049500, 1913110, 1901860, 1910000],
    c: [0, 1, 2, 1, 2, 1],
    m: [1, 0, 2, 1, 0, 1],
    t: [1, 1, 1, 2, 2, 3],
    f: [1, 1, 8 | 1, 1, 8, 0],
    s: [2, 1, 0, 3, 1, 3],
    sc: [120, 110, 100, 60, 50, 10],
  }
  return decodeIndex(raw)
}
