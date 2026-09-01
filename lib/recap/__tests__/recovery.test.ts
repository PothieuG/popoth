/**
 * Sprint Abandoned-Recap-Recovery (2026-09-01) — tests purs, non gated.
 *
 * `parseRecoveryData` est le seul garde-fou entre le blob JSONB écrit par
 * `start_monthly_recap` et le bandeau affiché à l'utilisateur. Il doit rendre
 * `null` dans TOUS les cas « rien à annoncer » — c'est le seul test que font
 * les consommateurs.
 */

import { describe, expect, it } from 'vitest'

import { parseRecoveryData } from '@/lib/recap'

describe('parseRecoveryData', () => {
  it('returns null on null / undefined', () => {
    expect(parseRecoveryData(null)).toBeNull()
    expect(parseRecoveryData(undefined)).toBeNull()
  })

  it('returns null on the default empty blob', () => {
    // DEFAULT '{}' de la colonne : aucun bilan abandonné n'a été balayé.
    expect(parseRecoveryData({})).toBeNull()
  })

  it('returns null on a non-object blob', () => {
    expect(parseRecoveryData('150')).toBeNull()
    expect(parseRecoveryData(150)).toBeNull()
    expect(parseRecoveryData([{ month: 6, year: 2026, amount: 150 }])).toBeNull()
  })

  it('returns null when total is zero — silent archive, nothing to announce', () => {
    // Décision produit 2026-09-01 : un bilan abandonné avant l'étape de
    // renflouement est archivé sans bandeau.
    expect(parseRecoveryData({ total: 0, periods: [] })).toBeNull()
  })

  it('returns null when total is negative or non-finite', () => {
    expect(parseRecoveryData({ total: -10, periods: [] })).toBeNull()
    expect(parseRecoveryData({ total: 'beaucoup', periods: [] })).toBeNull()
  })

  it('parses a single recovered period', () => {
    expect(
      parseRecoveryData({ total: 150, periods: [{ month: 6, year: 2026, amount: 150 }] }),
    ).toEqual({ total: 150, periods: [{ month: 6, year: 2026, amount: 150 }] })
  })

  it('parses several recovered periods, order preserved', () => {
    expect(
      parseRecoveryData({
        total: 230,
        periods: [
          { month: 12, year: 2025, amount: 80 },
          { month: 1, year: 2026, amount: 150 },
        ],
      }),
    ).toEqual({
      total: 230,
      periods: [
        { month: 12, year: 2025, amount: 80 },
        { month: 1, year: 2026, amount: 150 },
      ],
    })
  })

  it('keeps the total but drops malformed period entries', () => {
    // Le montant total prime : mieux vaut un bandeau sans le détail des mois
    // qu'aucun bandeau du tout alors que de l'argent a bougé.
    const parsed = parseRecoveryData({
      total: 150,
      periods: [
        { month: 6, year: 2026, amount: 150 },
        { month: 13, year: 2026, amount: 10 },
        { month: 'juin', year: 2026, amount: 10 },
        { month: 5, year: 2026 },
        null,
        'nope',
      ],
    })
    expect(parsed).toEqual({ total: 150, periods: [{ month: 6, year: 2026, amount: 150 }] })
  })

  it('tolerates a missing or non-array periods key', () => {
    expect(parseRecoveryData({ total: 150 })).toEqual({ total: 150, periods: [] })
    expect(parseRecoveryData({ total: 150, periods: 'nope' })).toEqual({ total: 150, periods: [] })
  })
})
