/**
 * Sprint Fix-Group-Recap-RavEstime (2026-05-27) — pin the formula
 * `ravEstime = totalEstimatedIncome + (meta.totalGroupContributions ?? 0) −
 * totalEstimatedBudgets` in `lib/recap/load-summary.ts`.
 *
 * `ravEstime` est une métrique d'AFFICHAGE autonome (carte « Reste à vivre
 * estimé »). Depuis Sprint Bilan-Equals-RavEffectif, le bilan = `ravEffectif`
 * et ne lit PLUS `ravEstime` — ces tests pinnent donc la formule `ravEstime`
 * elle-même, plus l'invariant `bilan === ravEffectif`. Le terme groupe miroite
 * `calculateRemainingToLiveGroup`
 * ([lib/finance/calc-rtl.ts:58-74](../../finance/calc-rtl.ts)) pour que le RAV
 * estimé affiché reste cohérent avec le RAV effectif.
 *
 * Mocks `@/lib/finance` (controlled FinancialData) + `@/lib/supabase-server`
 * (per-table builder, capture `.gte`/`.lt` args) so the tests can exercise
 * both the formula in load-summary AND (Sprint Fix-Recap-Surplus-Wrong-Month)
 * the `real_expenses` date-range query itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FinancialData } from '@/lib/finance'

const FINANCIAL_DATA_STATE: { value: FinancialData } = {
  value: {
    availableBalance: 0,
    remainingToLive: 0,
    totalSavings: 0,
    totalEstimatedIncome: 0,
    totalEstimatedBudgets: 0,
    totalRealIncome: 0,
    totalRealExpenses: 0,
    meta: { readOnlyIncomes: [], totalMonthlyProjects: 0, savingsProjects: [] },
  },
}

vi.mock('@/lib/finance', () => ({
  getProfileFinancialData: vi.fn(async () => FINANCIAL_DATA_STATE.value),
  getGroupFinancialData: vi.fn(async () => FINANCIAL_DATA_STATE.value),
}))

// `vi.hoisted` so the mock factory below (itself hoisted above imports by
// vitest) can close over — and tests can later inspect/reset — the same
// arrays. `capturedQueries` records one entry per `.from(table)` chain that
// reached a terminal call (`.then`/`.maybeSingle`), including the raw
// `.gte`/`.lt` args — that's what the date-range regression test asserts on.
const { capturedQueries, tableData } = vi.hoisted(() => {
  return {
    capturedQueries: [] as Array<{ table: string; gte?: unknown; lt?: unknown }>,
    tableData: {
      estimated_budgets: [] as unknown[],
      real_expenses: [] as unknown[],
    },
  }
})

vi.mock('@/lib/supabase-server', () => {
  return {
    supabaseServer: {
      from: (table: string) => {
        const record: { table: string; gte?: unknown; lt?: unknown } = { table }
        const builder = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          not: () => builder,
          gte: (_column: string, value: unknown) => {
            record.gte = value
            return builder
          },
          lt: (_column: string, value: unknown) => {
            record.lt = value
            return builder
          },
          maybeSingle: () => Promise.resolve({ data: null }),
          then: (resolve: (v: { data: unknown[] }) => void) => {
            capturedQueries.push(record)
            const rows = (tableData as Record<string, unknown[]>)[table] ?? []
            resolve({ data: rows })
          },
        }
        return builder
      },
    },
  }
})

const PROFILE_ID = 'aaaa1111-1111-1111-1111-111111111111'
const GROUP_ID = 'bbbb2222-2222-2222-2222-222222222222'

beforeEach(() => {
  FINANCIAL_DATA_STATE.value = {
    availableBalance: 0,
    remainingToLive: 0,
    totalSavings: 0,
    totalEstimatedIncome: 0,
    totalEstimatedBudgets: 0,
    totalRealIncome: 0,
    totalRealExpenses: 0,
    meta: { readOnlyIncomes: [], totalMonthlyProjects: 0, savingsProjects: [] },
  }
  capturedQueries.length = 0
  tableData.estimated_budgets = []
  tableData.real_expenses = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('loadRecapSummary — ravEstime formula', () => {
  it('group: ravEstime includes meta.totalGroupContributions (symmetry with ravEffectif)', async () => {
    // Scénario user : 600€ budgets + 2370€ projets groupe = totalEstimatedBudgets 2970,
    // groups.monthly_budget_estimate = 2970 → contributions auto-syncées = 2970,
    // donc ravEstime DOIT valoir 0 (équilibre, aucune activité réelle).
    FINANCIAL_DATA_STATE.value = {
      availableBalance: 0,
      remainingToLive: 0,
      totalSavings: 0,
      totalEstimatedIncome: 0,
      totalEstimatedBudgets: 2970,
      totalRealIncome: 0,
      totalRealExpenses: 0,
      meta: {
        readOnlyIncomes: [],
        totalGroupContributions: 2970,
        totalMonthlyProjects: 2370,
        savingsProjects: [],
      },
    }

    const { loadRecapSummary } = await import('../load-summary')
    const summary = await loadRecapSummary({
      context: 'group',
      profileId: PROFILE_ID,
      groupId: GROUP_ID,
      recapMonth: 6,
      recapYear: 2026,
    })

    expect(summary.ravEstime).toBe(0)
    expect(summary.ravEffectif).toBe(0)
    expect(summary.bilan).toBe(0)
    expect(summary.bilanSign).toBe('zero')
  })

  it('group: ravEstime negative when budgets exceed (income + contributions)', async () => {
    // Edge case : si un jour le total contributions ne couvre pas le budget
    // (ex. plafond salaires atteint), ravEstime reflète bien le déséquilibre.
    FINANCIAL_DATA_STATE.value = {
      availableBalance: 0,
      remainingToLive: 0,
      totalSavings: 0,
      totalEstimatedIncome: 100,
      totalEstimatedBudgets: 1000,
      totalRealIncome: 0,
      totalRealExpenses: 0,
      meta: {
        readOnlyIncomes: [],
        totalGroupContributions: 500,
        totalMonthlyProjects: 0,
        savingsProjects: [],
      },
    }

    const { loadRecapSummary } = await import('../load-summary')
    const summary = await loadRecapSummary({
      context: 'group',
      profileId: PROFILE_ID,
      groupId: GROUP_ID,
      recapMonth: 6,
      recapYear: 2026,
    })

    // 100 + 500 − 1000 = -400
    expect(summary.ravEstime).toBe(-400)
  })

  it('profile: ravEstime unchanged when meta.totalGroupContributions absent (?? 0 no-op)', async () => {
    // En perso, meta.totalGroupContributions n'est jamais exposé. La formule
    // doit dégénérer à `totalEstimatedIncome - totalEstimatedBudgets`.
    FINANCIAL_DATA_STATE.value = {
      availableBalance: 0,
      remainingToLive: 0,
      totalSavings: 0,
      totalEstimatedIncome: 3000, // salaire perso inclus
      totalEstimatedBudgets: 700,
      totalRealIncome: 0,
      totalRealExpenses: 0,
      meta: { readOnlyIncomes: [], totalMonthlyProjects: 0, savingsProjects: [] },
    }

    const { loadRecapSummary } = await import('../load-summary')
    const summary = await loadRecapSummary({
      context: 'profile',
      profileId: PROFILE_ID,
      groupId: null,
      recapMonth: 6,
      recapYear: 2026,
    })

    // 3000 − 700 = 2300 (no contribution term in perso)
    expect(summary.ravEstime).toBe(2300)
  })
})

describe('loadRecapSummary — bilan = ravEffectif (Sprint Bilan-Equals-RavEffectif)', () => {
  it('bilan equals remainingToLive (ravEffectif), independent of ravEstime', async () => {
    // remainingToLive = 300 (positif) ; ravEstime = 1000 − 200 = 800.
    // Ancienne formule : bilan = 300 − 800 = -500 (négatif). Nouvelle : 300.
    FINANCIAL_DATA_STATE.value = {
      availableBalance: 0,
      remainingToLive: 300,
      totalSavings: 0,
      totalEstimatedIncome: 1000,
      totalEstimatedBudgets: 200,
      totalRealIncome: 0,
      totalRealExpenses: 0,
      meta: { readOnlyIncomes: [], totalMonthlyProjects: 0, savingsProjects: [] },
    }

    const { loadRecapSummary } = await import('../load-summary')
    const summary = await loadRecapSummary({
      context: 'profile',
      profileId: PROFILE_ID,
      groupId: null,
      recapMonth: 6,
      recapYear: 2026,
    })

    expect(summary.ravEstime).toBe(800)
    expect(summary.ravEffectif).toBe(300)
    expect(summary.bilan).toBe(300)
    expect(summary.bilanSign).toBe('positive')
  })
})

describe('loadRecapSummary — spentThisMonth window follows recapMonth/recapYear', () => {
  // Sprint Fix-Recap-Surplus-Wrong-Month (2026-07-03) — before the fix,
  // `loadRecapSummary` derived the `real_expenses` date range from `new
  // Date()` (the calendar month "now"), not from the month the recap is
  // actually reviewing. A recap opened at the start of a new month found
  // ~zero expenses in that not-yet-lived-in month, so every budget's full
  // estimated amount showed up as "surplus". These 2 cases pin: (a) the SQL
  // window matches the *input* `recapMonth`/`recapYear` regardless of when
  // the test runs, and (b) a budget that was actually spent on comes back
  // with the correct (non-inflated) surplus.
  it('queries real_expenses against the recapped month, not the calendar month', async () => {
    tableData.estimated_budgets = [
      {
        id: 'budget-1',
        name: 'Crypto',
        estimated_amount: 190,
        cumulated_savings: 0,
        carryover_spent_amount: 0,
      },
    ]
    tableData.real_expenses = [{ estimated_budget_id: 'budget-1', amount_from_budget: 190 }]

    const { loadRecapSummary } = await import('../load-summary')
    const summary = await loadRecapSummary({
      context: 'profile',
      profileId: PROFILE_ID,
      groupId: null,
      recapMonth: 6,
      recapYear: 2026,
    })

    const realExpensesQuery = capturedQueries.find((q) => q.table === 'real_expenses')
    expect(realExpensesQuery?.gte).toBe('2026-06-01')
    expect(realExpensesQuery?.lt).toBe('2026-07-01')

    // Fully spent budget → 0 surplus, not the full 190€ (the pre-fix symptom).
    expect(summary.budgets[0]?.spentThisMonth).toBe(190)
    expect(summary.budgets[0]?.surplus).toBe(0)
  })

  it('handles the December → January rollover in the query window', async () => {
    tableData.estimated_budgets = []
    tableData.real_expenses = []

    const { loadRecapSummary } = await import('../load-summary')
    await loadRecapSummary({
      context: 'profile',
      profileId: PROFILE_ID,
      groupId: null,
      recapMonth: 12,
      recapYear: 2025,
    })

    const realExpensesQuery = capturedQueries.find((q) => q.table === 'real_expenses')
    expect(realExpensesQuery?.gte).toBe('2025-12-01')
    expect(realExpensesQuery?.lt).toBe('2026-01-01')
  })
})
