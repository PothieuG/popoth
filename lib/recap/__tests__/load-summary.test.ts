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
 * (empty query chain) so the test exercises only the formula in load-summary.
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

vi.mock('@/lib/supabase-server', () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    not: () => builder,
    gte: () => builder,
    lt: () => builder,
    maybeSingle: () => Promise.resolve({ data: null }),
    then: (resolve: (v: { data: unknown[] }) => void) => resolve({ data: [] }),
  }
  return {
    supabaseServer: {
      from: () => builder,
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
    })

    expect(summary.ravEstime).toBe(800)
    expect(summary.ravEffectif).toBe(300)
    expect(summary.bilan).toBe(300)
    expect(summary.bilanSign).toBe('positive')
  })
})
