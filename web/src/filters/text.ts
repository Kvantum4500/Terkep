/** Kisbetű, ékezet nélkül, írásjelek helyén szóköz – a pipeline `fold` függvényével azonos. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^0-9a-z]+/g, ' ')
    .trim()
}

const collator = new Intl.Collator('hu', { sensitivity: 'base' })

/** Magyar ábécé szerinti összehasonlítás (cs, gy, sz, zs, ő, ű helyesen). */
export function compareHu(a: string, b: string): number {
  return collator.compare(a, b)
}

const numberFormat = new Intl.NumberFormat('hu-HU')

export function formatCount(n: number): string {
  return numberFormat.format(n)
}
