/**
 * Sprint Salary-Reception (2026-10-02) — règles pures de « Réception du
 * salaire ». Les montants du cas réel sont ceux du récap de septembre 2026 :
 * salaire déclaré 2 752,08 €, paie reçue le 28/09 de 2 760,18 €.
 */

import { describe, expect, it } from 'vitest'

import {
  monthName,
  nextMonth,
  ofMonth,
  resolveSalaryReceptionState,
  salaryDelta,
} from '../salary-reception'

describe('resolveSalaryReceptionState', () => {
  it('aucune ligne salaire, salaire déclaré : la paie finance le mois suivant', () => {
    expect(resolveSalaryReceptionState([], 2752.08)).toEqual({ kind: 'advance', expected: 2752.08 })
  })

  it('pas de salaire déclaré : option indisponible', () => {
    expect(resolveSalaryReceptionState([], 0)).toEqual({ kind: 'unavailable' })
  })

  it('ligne salaire du mois encore à valider : la paie est celle du mois en cours', () => {
    const incomes = [{ amount: 2700, recap_origin_id: 'recap-1', applied_to_balance_at: null }]
    // Le montant attendu est celui de la LIGNE, pas le salaire déclaré du jour.
    expect(resolveSalaryReceptionState(incomes, 2752.08)).toEqual({
      kind: 'current',
      expected: 2700,
    })
  })

  it('ligne salaire du mois déjà validée : retour au cas « mois suivant »', () => {
    const incomes = [
      {
        amount: 2752.08,
        recap_origin_id: 'recap-1',
        applied_to_balance_at: '2026-09-02T08:00:00Z',
      },
    ]
    expect(resolveSalaryReceptionState(incomes, 2752.08)).toEqual({
      kind: 'advance',
      expected: 2752.08,
    })
  })

  it('réception déjà enregistrée : une seule paie par mois', () => {
    const incomes = [
      { amount: 2760.18, salary_reception: true, applied_to_balance_at: '2026-09-28T07:57:00Z' },
    ]
    expect(resolveSalaryReceptionState(incomes, 2752.08)).toEqual({
      kind: 'already-received',
      received: 2760.18,
    })
  })

  it('ligne à valider ET réception en attente : la ligne à valider passe d’abord', () => {
    const incomes = [
      { amount: 2760.18, salary_reception: true, applied_to_balance_at: '2026-09-28T07:57:00Z' },
      { amount: 2752.08, recap_origin_id: 'recap-1', applied_to_balance_at: null },
    ]
    expect(resolveSalaryReceptionState(incomes, 2752.08).kind).toBe('current')
  })

  it('les revenus ordinaires ne comptent pas', () => {
    const incomes = [{ amount: 700, applied_to_balance_at: '2026-09-01T19:00:00Z' }]
    expect(resolveSalaryReceptionState(incomes, 2752.08).kind).toBe('advance')
  })
})

describe('salaryDelta', () => {
  it('cas réel : 2 760,18 reçus pour 2 752,08 prévus → +8,10', () => {
    expect(salaryDelta(2760.18, 2752.08)).toBe(8.1)
  })

  it('reçu moins que prévu → écart négatif, au centime', () => {
    expect(salaryDelta(2700, 2752.08)).toBe(-52.08)
  })

  it('montant conforme → 0 (pas de résidu flottant)', () => {
    expect(salaryDelta(2752.08, 2752.08)).toBe(0)
  })
})

describe('mois', () => {
  it('nextMonth franchit l’année', () => {
    expect(nextMonth({ month: 9, year: 2026 })).toEqual({ month: 10, year: 2026 })
    expect(nextMonth({ month: 12, year: 2026 })).toEqual({ month: 1, year: 2027 })
  })

  it('monthName / ofMonth : élision devant voyelle', () => {
    expect(monthName({ month: 10, year: 2026 })).toBe('octobre')
    expect(ofMonth({ month: 10, year: 2026 })).toBe("d'octobre")
    expect(ofMonth({ month: 4, year: 2026 })).toBe("d'avril")
    expect(ofMonth({ month: 8, year: 2026 })).toBe("d'août")
    expect(ofMonth({ month: 9, year: 2026 })).toBe('de septembre')
    expect(ofMonth({ month: 1, year: 2027 })).toBe('de janvier')
  })
})
