import { describe, expect, it } from 'vitest'

import { formatEuro } from '@/lib/format-currency'

// Intl.NumberFormat 'fr-FR' utilise NBSP (  = espace insécable) entre le
// nombre et le symbole € sur la plupart des plateformes node 20+, mais cela
// peut varier — on normalise pour rendre les assertions stables.
function normalize(s: string): string {
  return s.replace(/\s/g, ' ')
}

describe('formatEuro', () => {
  it('formats zero with 2 decimals', () => {
    expect(normalize(formatEuro(0))).toBe('0,00 €')
  })

  it('formats positive amount with 2 decimals preserved', () => {
    expect(normalize(formatEuro(123.45))).toBe('123,45 €')
  })

  it('pads single decimal to 2 digits (100.1 → 100,10 €)', () => {
    expect(normalize(formatEuro(100.1))).toBe('100,10 €')
  })

  it('formats negative amount with sign preserved', () => {
    expect(normalize(formatEuro(-42))).toBe('-42,00 €')
  })

  it('falls back to 0 for NaN / Infinity (defensive)', () => {
    expect(normalize(formatEuro(Number.NaN))).toBe('0,00 €')
    expect(normalize(formatEuro(Number.POSITIVE_INFINITY))).toBe('0,00 €')
  })

  it('rounds cents-precise input correctly (-0.42 visible, not arrondi)', () => {
    expect(normalize(formatEuro(-0.42))).toBe('-0,42 €')
  })
})
