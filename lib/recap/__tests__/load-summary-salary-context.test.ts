/**
 * Sprint Salary-Reception (2026-10-02) — `loadRecapSummary` expose, en espace
 * perso, de quoi EXPLIQUER le reste à vivre : la contribution au groupe déjà
 * déduite et le salaire reçu en avance. Ces deux champs ne doivent entrer dans
 * AUCUN calcul (le bilan reste `ravEffectif`).
 *
 * Montants du cas réel (récap de septembre 2026) : contribution 2 501,72 €,
 * salaire déclaré 2 752,08 €, paie de 2 760,18 € reçue le 28/09.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FinancialData } from '@/lib/finance'

const { single, queried, filters } = vi.hoisted(() => ({
  single: {} as Record<string, unknown>,
  queried: [] as string[],
  /** Filtres `.eq(colonne, valeur)` posés, par table. */
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
}))

const FINANCIAL_DATA: FinancialData = {
  availableBalance: 3042.7,
  remainingToLive: -56.37,
  totalSavings: 0,
  totalEstimatedIncome: 2752.08,
  totalEstimatedBudgets: 427,
  totalRealIncome: 0,
  totalRealExpenses: 0,
  meta: {
    readOnlyIncomes: [{ kind: 'salary', label: 'Salaire', amount: 2752.08 }],
    totalMonthlyProjects: 0,
    savingsProjects: [],
  },
}

vi.mock('@/lib/finance', () => ({
  getProfileFinancialData: vi.fn(async () => FINANCIAL_DATA),
  getGroupFinancialData: vi.fn(async () => FINANCIAL_DATA),
}))

vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: {
    from: (table: string) => {
      queried.push(table)
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push({ table, column, value })
          return builder
        },
        is: () => builder,
        gte: () => builder,
        lt: () => builder,
        maybeSingle: () => Promise.resolve({ data: single[table] ?? null }),
        then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: [] }),
      }
      return builder
    },
  },
}))

const PROFILE_ID = '0679b0f9-830a-44e5-aecf-f8452c8dd101'
const GROUP_ID = '92dbf6f2-7aa1-4f63-b31c-b85c57e3657e'

beforeEach(() => {
  for (const key of Object.keys(single)) delete single[key]
  queried.length = 0
  filters.length = 0
  single.bank_balances = { balance: 3042.7 }
})

async function load(context: 'profile' | 'group') {
  const { loadRecapSummary } = await import('../load-summary')
  return loadRecapSummary({
    context,
    profileId: PROFILE_ID,
    groupId: GROUP_ID,
    recapMonth: 9,
    recapYear: 2026,
  })
}

describe('loadRecapSummary — contribution et salaire reçu en avance (espace perso)', () => {
  it('membre d’un groupe : la contribution déjà déduite est exposée, avec le nom du groupe', async () => {
    single.group_contributions = {
      contribution_amount: 2501.72,
      group: { name: 'Famille Pothieu' },
    }

    const summary = await load('profile')

    expect(summary.groupContribution).toEqual({
      label: 'Contribution au groupe Famille Pothieu',
      amount: 2501.72,
    })
  })

  it('salaire reçu en avance : montant, écart et mois financé (mois recapé + 1)', async () => {
    single.real_income_entries = { amount: 2760.18, applied_to_balance_at: '2026-09-28T07:57:00Z' }

    const summary = await load('profile')

    expect(summary.salaryReception).toEqual({
      received: 2760.18,
      expected: 2752.08,
      delta: 8.1,
      fundedMonth: { month: 10, year: 2026 },
    })
    // La ligne cherchée est celle qui finance le mois SUIVANT le mois recapé.
    expect(filters).toContainEqual({
      table: 'real_income_entries',
      column: 'salary_month',
      value: '2026-10-01',
    })
  })

  it('réception retirée du solde : elle n’est plus dans le solde, rien à expliquer', async () => {
    single.real_income_entries = { amount: 2760.18, applied_to_balance_at: null }

    const summary = await load('profile')

    expect(summary).not.toHaveProperty('salaryReception')
  })

  it('aucun des deux n’entre dans le calcul : le bilan reste le reste à vivre effectif', async () => {
    single.group_contributions = { contribution_amount: 2501.72, group: { name: 'F' } }
    single.real_income_entries = { amount: 2760.18, applied_to_balance_at: '2026-09-28T07:57:00Z' }

    const summary = await load('profile')

    expect(summary.ravEffectif).toBe(-56.37)
    expect(summary.bilan).toBe(-56.37)
    expect(summary.bilanSign).toBe('negative')
    expect(summary.currentBalance).toBe(3042.7)
  })

  it('hors groupe et sans réception : champs absents', async () => {
    const summary = await load('profile')

    expect(summary).not.toHaveProperty('groupContribution')
    expect(summary).not.toHaveProperty('salaryReception')
  })

  it('contribution nulle (groupe sans budget) : pas de carte à 0 €', async () => {
    single.group_contributions = { contribution_amount: 0, group: { name: 'Vide' } }

    const summary = await load('profile')

    expect(summary).not.toHaveProperty('groupContribution')
  })

  it('espace groupe : aucune des deux lectures n’est faite', async () => {
    single.group_contributions = { contribution_amount: 2501.72, group: { name: 'F' } }
    single.real_income_entries = { amount: 2760.18, applied_to_balance_at: '2026-09-28T07:57:00Z' }

    const summary = await load('group')

    expect(summary).not.toHaveProperty('groupContribution')
    expect(summary).not.toHaveProperty('salaryReception')
    expect(queried).not.toContain('group_contributions')
    expect(queried).not.toContain('real_income_entries')
  })
})
