/**
 * Sprint Salary-Reception (2026-10-02) — règles pures de « Réception du
 * salaire ». Les montants du cas réel sont ceux du récap de septembre 2026 :
 * salaire déclaré 2 752,08 €, paie de 2 760,18 € reçue le 28/09 pour octobre.
 */

import { describe, expect, it } from 'vitest'

import {
  defaultSalaryMonthOption,
  isLaterMonth,
  monthName,
  nextMonth,
  ofMonth,
  parseSalaryMonth,
  salaryDelta,
  salaryMonthOptions,
  toSalaryMonth,
} from '../salary-reception'

const SEPTEMBER = { month: 9, year: 2026 }
const OCTOBER = { month: 10, year: 2026 }
const SALARY = 2752.08

describe('salaryMonthOptions', () => {
  it('aucune ligne salaire : les deux mois (ouvert et suivant) sont disponibles', () => {
    expect(salaryMonthOptions([], SALARY, SEPTEMBER)).toEqual([
      { month: SEPTEMBER, isOpenMonth: true, status: { kind: 'available', expected: SALARY } },
      { month: OCTOBER, isOpenMonth: false, status: { kind: 'available', expected: SALARY } },
    ])
  })

  it('pas de salaire déclaré et rien en attente : aucune option', () => {
    expect(salaryMonthOptions([], 0, SEPTEMBER)).toEqual([])
  })

  it('ligne du récap à valider : le montant attendu est celui de la LIGNE', () => {
    const incomes = [
      {
        amount: 2700,
        salary_month: '2026-09-01',
        recap_origin_id: 'recap-aout',
        applied_to_balance_at: null,
      },
    ]
    const [open, next] = salaryMonthOptions(incomes, SALARY, SEPTEMBER)
    expect(open?.status).toEqual({ kind: 'awaiting', expected: 2700 })
    expect(next?.status).toEqual({ kind: 'available', expected: SALARY })
  })

  it('ligne à valider sans salaire déclaré : l’option reste proposée', () => {
    const incomes = [
      {
        amount: 2700,
        salary_month: '2026-09-01',
        recap_origin_id: 'recap-aout',
        applied_to_balance_at: null,
      },
    ]
    expect(salaryMonthOptions(incomes, 0, SEPTEMBER)).toHaveLength(2)
  })

  it('salaire du mois suivant déjà reçu (cas réel) : octobre réglé, septembre libre', () => {
    const incomes = [
      { amount: 2760.18, salary_month: '2026-10-01', applied_to_balance_at: '2026-09-28T07:57Z' },
    ]
    const [open, next] = salaryMonthOptions(incomes, SALARY, SEPTEMBER)
    expect(open?.status.kind).toBe('available')
    expect(next?.status).toEqual({ kind: 'received', received: 2760.18 })
  })

  it('ligne du récap déjà validée : mois réglé', () => {
    const incomes = [
      {
        amount: SALARY,
        salary_month: '2026-09-01',
        recap_origin_id: 'recap-aout',
        applied_to_balance_at: '2026-09-02T08:00Z',
      },
    ]
    const [open] = salaryMonthOptions(incomes, SALARY, SEPTEMBER)
    expect(open?.status).toEqual({ kind: 'received', received: SALARY })
  })

  it('réception retirée du solde par l’utilisateur : le mois reste pris', () => {
    // Ni disponible (la ligne existe) ni « à valider » (pas une ligne de récap) :
    // on la remet dans le solde par appui long, ou on la supprime.
    const incomes = [{ amount: 2760.18, salary_month: '2026-10-01', applied_to_balance_at: null }]
    const [, next] = salaryMonthOptions(incomes, SALARY, SEPTEMBER)
    expect(next?.status.kind).toBe('received')
  })

  it('les revenus ordinaires et les salaires d’autres mois ne comptent pas', () => {
    const incomes = [
      { amount: 700, applied_to_balance_at: '2026-09-01T19:00Z' },
      { amount: SALARY, salary_month: '2026-08-01', applied_to_balance_at: null },
    ]
    const options = salaryMonthOptions(incomes, SALARY, SEPTEMBER)
    expect(options.map((option) => option.status.kind)).toEqual(['available', 'available'])
  })

  it('décembre : le mois suivant est janvier de l’année d’après', () => {
    const [, next] = salaryMonthOptions([], SALARY, { month: 12, year: 2026 })
    expect(next?.month).toEqual({ month: 1, year: 2027 })
  })
})

describe('defaultSalaryMonthOption', () => {
  const free = salaryMonthOptions([], SALARY, OCTOBER)

  it('payé le 3 : mois en cours', () => {
    expect(defaultSalaryMonthOption(free, 3)?.month).toEqual(OCTOBER)
  })

  it('payé le 28 : mois suivant', () => {
    expect(defaultSalaryMonthOption(free, 28)?.month).toEqual({ month: 11, year: 2026 })
  })

  it('bascule entre le 15 et le 16', () => {
    expect(defaultSalaryMonthOption(free, 15)?.isOpenMonth).toBe(true)
    expect(defaultSalaryMonthOption(free, 16)?.isOpenMonth).toBe(false)
  })

  it('une ligne en attente l’emporte sur le jour de réception', () => {
    const incomes = [
      {
        amount: SALARY,
        salary_month: '2026-10-01',
        recap_origin_id: 'recap-sept',
        applied_to_balance_at: null,
      },
    ]
    const options = salaryMonthOptions(incomes, SALARY, OCTOBER)
    expect(defaultSalaryMonthOption(options, 28)?.month).toEqual(OCTOBER)
  })

  it('mois proposé déjà réglé : on propose l’autre', () => {
    const incomes = [
      { amount: SALARY, salary_month: '2026-10-01', applied_to_balance_at: '2026-10-03T08:00Z' },
    ]
    const options = salaryMonthOptions(incomes, SALARY, OCTOBER)
    expect(defaultSalaryMonthOption(options, 3)?.month).toEqual({ month: 11, year: 2026 })
  })

  it('les deux mois réglés, ou aucune option : rien à proposer', () => {
    const incomes = [
      { amount: SALARY, salary_month: '2026-10-01', applied_to_balance_at: '2026-10-03T08:00Z' },
      { amount: SALARY, salary_month: '2026-11-01', applied_to_balance_at: '2026-10-28T08:00Z' },
    ]
    expect(defaultSalaryMonthOption(salaryMonthOptions(incomes, SALARY, OCTOBER), 3)).toBeNull()
    expect(defaultSalaryMonthOption([], 3)).toBeNull()
  })
})

describe('salaryDelta', () => {
  it('cas réel : 2 760,18 reçus pour 2 752,08 prévus → +8,10', () => {
    expect(salaryDelta(2760.18, SALARY)).toBe(8.1)
  })

  it('reçu moins que prévu → écart négatif, au centime', () => {
    expect(salaryDelta(2700, SALARY)).toBe(-52.08)
  })

  it('montant conforme → 0 (pas de résidu flottant)', () => {
    expect(salaryDelta(SALARY, SALARY)).toBe(0)
  })
})

describe('mois', () => {
  it('nextMonth / isLaterMonth franchissent l’année', () => {
    expect(nextMonth(SEPTEMBER)).toEqual(OCTOBER)
    expect(nextMonth({ month: 12, year: 2026 })).toEqual({ month: 1, year: 2027 })
    expect(isLaterMonth(OCTOBER, SEPTEMBER)).toBe(true)
    expect(isLaterMonth(SEPTEMBER, SEPTEMBER)).toBe(false)
    expect(isLaterMonth({ month: 1, year: 2027 }, { month: 12, year: 2026 })).toBe(true)
    expect(isLaterMonth({ month: 12, year: 2026 }, { month: 1, year: 2027 })).toBe(false)
  })

  it('toSalaryMonth / parseSalaryMonth sont inverses', () => {
    expect(toSalaryMonth(SEPTEMBER)).toBe('2026-09-01')
    expect(parseSalaryMonth('2026-09-01')).toEqual(SEPTEMBER)
    expect(parseSalaryMonth('2026-09')).toEqual(SEPTEMBER)
  })

  it.each(['2026-13-01', '2026-00', '2026-09-15', 'septembre', '', null, undefined])(
    'parseSalaryMonth refuse %j',
    (value) => {
      expect(parseSalaryMonth(value)).toBeNull()
    },
  )

  it('monthName / ofMonth : élision devant voyelle', () => {
    expect(monthName(OCTOBER)).toBe('octobre')
    expect(ofMonth(OCTOBER)).toBe("d'octobre")
    expect(ofMonth({ month: 4, year: 2026 })).toBe("d'avril")
    expect(ofMonth({ month: 8, year: 2026 })).toBe("d'août")
    expect(ofMonth(SEPTEMBER)).toBe('de septembre')
    expect(ofMonth({ month: 1, year: 2027 })).toBe('de janvier')
  })
})
