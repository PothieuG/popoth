import { describe, expect, it } from 'vitest'

import { computeDeadlineFromDuration } from '@/lib/finance/projects-meta'
import { makeProjectClientSchema, monthsUntilDeadline } from '@/lib/schemas/projects'

/**
 * Sprint Deadline-Month-End-Clamp 2026-08-31.
 *
 * `monthsUntilDeadline` alimente l'unique refine de `makeProjectClientSchema`
 * (« le projet est-il atteignable d'ici l'échéance ? »). Il doit compter les
 * mois EXACTEMENT comme `computeDeadlineFromDuration` les produit, sinon le
 * formulaire refuse une date qu'il vient lui-même de calculer.
 *
 * Le bug corrigé : les 29/30/31 du mois, `computeDeadlineFromDuration` rabote
 * le jour quand le mois cible est plus court (31 août + 6 mois → 28 février),
 * et l'ancien floor `days < 0` relisait 5 mois au lieu de 6 → « Allocation
 * mensuelle insuffisante » sur un projet parfaitement finançable.
 */

describe('monthsUntilDeadline', () => {
  it('counts exactly when the day-of-month aligns', () => {
    expect(monthsUntilDeadline(new Date(2026, 6, 5), new Date('2027-01-05'))).toBe(6)
  })

  it('floors a genuinely partial month', () => {
    // 3 mois moins 16 jours → 2 mois pleins.
    expect(monthsUntilDeadline(new Date(2026, 4, 26), new Date('2026-08-10'))).toBe(2)
  })

  it('counts a full month when the deadline was clamped to a shorter month end', () => {
    expect(monthsUntilDeadline(new Date(2026, 7, 31), new Date('2027-02-28'))).toBe(6)
    expect(monthsUntilDeadline(new Date(2026, 7, 29), new Date('2027-02-28'))).toBe(6)
    expect(monthsUntilDeadline(new Date(2026, 7, 31), new Date('2029-02-28'))).toBe(30)
  })

  it('still floors when the deadline is early in its month (not a clamp artefact)', () => {
    expect(monthsUntilDeadline(new Date(2026, 7, 31), new Date('2027-02-27'))).toBe(5)
  })

  it('goes negative for a past deadline (caller treats <= 0 as unreachable)', () => {
    expect(monthsUntilDeadline(new Date(2026, 7, 31), new Date('2026-06-30'))).toBeLessThan(0)
  })
})

describe('makeProjectClientSchema — refine atteignabilité', () => {
  const base = { name: 'Voiture', targetAmount: 1200, monthlyAllocation: 200 }

  it('accepts the deadline the form itself derives, on the 31st of a month', () => {
    // Reproduit le parcours réel : mode « je fixe le mensuel », durée dérivée
    // ceil(1200 / 200) = 6 → deadline = computeDeadlineFromDuration(6).
    const from = new Date(Date.UTC(2026, 7, 31))
    const deadlineDate = computeDeadlineFromDuration(6, from)
    expect(deadlineDate).toBe('2027-02-28')

    const result = makeProjectClientSchema().safeParse({ ...base, deadlineDate })
    expect(result.success).toBe(true)
  })

  it('still rejects a genuinely unreachable target', () => {
    const result = makeProjectClientSchema().safeParse({
      ...base,
      monthlyAllocation: 10, // 10 × 6 = 60 < 1200
      deadlineDate: computeDeadlineFromDuration(6, new Date(Date.UTC(2026, 7, 31))),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['monthlyAllocation'])
    }
  })

  it('takes amountSaved into account so a nearly-funded project validates', () => {
    const result = makeProjectClientSchema({ amountSaved: 1100 }).safeParse({
      ...base,
      monthlyAllocation: 20, // reste 100 € à couvrir sur 6 mois → 120 >= 100
      deadlineDate: computeDeadlineFromDuration(6, new Date(Date.UTC(2026, 7, 31))),
    })
    expect(result.success).toBe(true)
  })
})
