import { describe, expect, it } from 'vitest'

import { ravColorClass } from '../rav-color'

/**
 * Source de vérité unique du code couleur RAV (vert positif / rouge négatif /
 * gris nul), partagée par `RavProjectionRecap` (solo), `GroupMembersRavRecap`
 * (groupe budget/projet) et la sous-ligne RAV de `GroupMembersContributionsRecap`
 * (groupe revenu).
 */
describe('ravColorClass', () => {
  it('montant positif → vert', () => {
    expect(ravColorClass(100)).toBe('text-green-600')
    expect(ravColorClass(0.01)).toBe('text-green-600')
  })

  it('montant négatif → rouge', () => {
    expect(ravColorClass(-1)).toBe('text-red-600')
    expect(ravColorClass(-1500)).toBe('text-red-600')
  })

  it('montant nul → gris', () => {
    expect(ravColorClass(0)).toBe('text-gray-900')
  })
})
