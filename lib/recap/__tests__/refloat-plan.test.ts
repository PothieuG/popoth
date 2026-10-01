/**
 * Sprint Recap-Manual-Refloat (2026-10-01) — `lib/recap/refloat-plan.ts`,
 * règles pures du renflouement manuel (partagées écran + serveur).
 */

import { describe, expect, it } from 'vitest'

import {
  autoDistributeBudgets,
  budgetRefloatCapacity,
  budgetTotalsFromPlan,
  canLeaveDeficitStep,
  deficitRemainingForPlan,
  EMPTY_REFLOAT_PLAN,
  planFromProgress,
  planFromRecapRow,
  planWithoutSource,
  remainingRefloatCapacity,
  splitBudgetRefloat,
  splitBudgetTotals,
  sumPlanSource,
  type RefloatPlan,
} from '@/lib/recap/refloat-plan'

describe('splitBudgetRefloat — économies d’abord, puis budget du mois suivant', () => {
  // Exemple de la spec produit : budget 100 €, économies 30 € → limite 130 €.
  it('20 € pris → 20 € sur les économies, budget intact', () => {
    expect(splitBudgetRefloat(20, 30)).toEqual({ fromSavings: 20, fromBudget: 0 })
  })

  it('50 € pris → économies vidées (30 €), budget amputé de 20 €', () => {
    expect(splitBudgetRefloat(50, 30)).toEqual({ fromSavings: 30, fromBudget: 20 })
  })

  it('sans économies → tout sur le budget', () => {
    expect(splitBudgetRefloat(44.16, 0)).toEqual({ fromSavings: 0, fromBudget: 44.16 })
  })

  it('montant nul ou négatif → rien', () => {
    expect(splitBudgetRefloat(0, 30)).toEqual({ fromSavings: 0, fromBudget: 0 })
    expect(splitBudgetRefloat(-5, 30)).toEqual({ fromSavings: 0, fromBudget: 0 })
  })

  it('reste précis au centime', () => {
    expect(splitBudgetRefloat(100.1, 33.33)).toEqual({ fromSavings: 33.33, fromBudget: 66.77 })
  })
})

describe('budgetRefloatCapacity', () => {
  it('= économies + montant du budget', () => {
    expect(budgetRefloatCapacity({ cumulatedSavings: 30, estimatedAmount: 100 })).toBe(130)
  })

  it('ignore les valeurs négatives', () => {
    expect(budgetRefloatCapacity({ cumulatedSavings: -10, estimatedAmount: 50 })).toBe(50)
  })
})

describe('splitBudgetTotals / budgetTotalsFromPlan', () => {
  it('découpe les montants totaux par budget et omet les zéros', () => {
    const savingsById = new Map([
      ['a', 30],
      ['b', 0],
    ])
    expect(splitBudgetTotals({ a: 50, b: 10, c: 0 }, savingsById)).toEqual({
      savings: { a: 30 },
      budgets: { a: 20, b: 10 },
    })
  })

  it('recompose le total par budget depuis le plan', () => {
    const plan: RefloatPlan = {
      ...EMPTY_REFLOAT_PLAN,
      savings: { a: 30 },
      budgets: { a: 20, b: 10 },
    }
    expect(budgetTotalsFromPlan(plan)).toEqual({ a: 50, b: 10 })
  })
})

describe('deficitRemainingForPlan', () => {
  it('soustrait toutes les sources du plan, ancienne cascade comprise', () => {
    const plan: RefloatPlan = {
      legacyPiggy: 10,
      legacySavings: 5,
      piggy: 100,
      savings: { a: 30 },
      budgets: { a: 20 },
      projects: { p: 40 },
    }
    // 348.06 - 10 - 5 - 100 - 30 - 20 - 40 = 143.06
    expect(deficitRemainingForPlan(-348.06, plan)).toBe(143.06)
  })

  it('vaut 0 quand le bilan n’est pas négatif', () => {
    expect(deficitRemainingForPlan(12, { ...EMPTY_REFLOAT_PLAN, piggy: 5 })).toBe(0)
  })

  it('planWithoutSource remet une seule source à zéro', () => {
    const plan: RefloatPlan = {
      ...EMPTY_REFLOAT_PLAN,
      piggy: 100,
      savings: { a: 30 },
      budgets: { a: 20 },
      projects: { p: 40 },
    }
    expect(deficitRemainingForPlan(-200, planWithoutSource(plan, 'piggy'))).toBe(110)
    expect(deficitRemainingForPlan(-200, planWithoutSource(plan, 'budgets'))).toBe(60)
    expect(deficitRemainingForPlan(-200, planWithoutSource(plan, 'projects'))).toBe(50)
  })
})

describe('sumPlanSource', () => {
  it('somme par source (budgets = économies + budget)', () => {
    const plan: RefloatPlan = {
      ...EMPTY_REFLOAT_PLAN,
      piggy: 12.5,
      savings: { a: 30 },
      budgets: { a: 20, b: 0.01 },
      projects: { p: 40, q: 2 },
    }
    expect(sumPlanSource(plan, 'piggy')).toBe(12.5)
    expect(sumPlanSource(plan, 'budgets')).toBe(50.01)
    expect(sumPlanSource(plan, 'projects')).toBe(42)
  })
})

describe('autoDistributeBudgets — « Répartir le reste automatiquement »', () => {
  const budgets = [
    { budgetId: 'a', cumulatedSavings: 100, estimatedAmount: 200 },
    { budgetId: 'b', cumulatedSavings: 50, estimatedAmount: 100 },
  ]

  it('prend d’abord dans les économies, au prorata des économies', () => {
    expect(autoDistributeBudgets(90, budgets, {})).toEqual({ a: 60, b: 30 })
  })

  it('déborde sur les budgets (au prorata de leur montant) une fois les économies vides', () => {
    // économies 150 vidées, reste 60 réparti 200:100 → 40 / 20
    expect(autoDistributeBudgets(210, budgets, {})).toEqual({ a: 140, b: 70 })
  })

  it('part des montants déjà choisis et ne re-prend pas ce qui est déjà pris', () => {
    // a a déjà 100 (= toutes ses économies) : il ne reste que les économies de b (50)
    expect(autoDistributeBudgets(30, budgets, { a: 100 })).toEqual({ a: 100, b: 30 })
  })

  it('ne dépasse jamais la limite d’un budget (le surplus n’est pas réparti)', () => {
    expect(autoDistributeBudgets(1000, budgets, {})).toEqual({ a: 300, b: 150 })
  })

  it('cible nulle → montants inchangés', () => {
    expect(autoDistributeBudgets(0, budgets, { a: 12 })).toEqual({ a: 12 })
  })
})

describe('remainingRefloatCapacity / canLeaveDeficitStep', () => {
  const input = {
    piggyAmount: 50,
    budgets: [{ budgetId: 'a', cumulatedSavings: 30, estimatedAmount: 100 }],
    projects: [{ id: 'p', monthlyAllocation: 20 }],
  }

  it('additionne ce que chaque source peut encore donner', () => {
    expect(remainingRefloatCapacity(input, EMPTY_REFLOAT_PLAN)).toBe(200)
    expect(
      remainingRefloatCapacity(input, {
        ...EMPTY_REFLOAT_PLAN,
        piggy: 50,
        savings: { a: 30 },
        budgets: { a: 100 },
        projects: { p: 20 },
      }),
    ).toBe(0)
  })

  it('autorise la sortie si le déficit est couvert', () => {
    expect(canLeaveDeficitStep(0, 500)).toBe(true)
    expect(canLeaveDeficitStep(0.004, 500)).toBe(true)
  })

  it('autorise la sortie si plus rien n’est disponible', () => {
    expect(canLeaveDeficitStep(120, 0)).toBe(true)
  })

  it('bloque la sortie tant qu’il reste un déficit ET de quoi le combler', () => {
    expect(canLeaveDeficitStep(120, 10)).toBe(false)
  })
})

describe('planFromRecapRow / planFromProgress', () => {
  it('lit les colonnes du récap (NULL = vide)', () => {
    expect(
      planFromRecapRow({
        refloated_from_piggy: 10,
        refloated_from_savings: 0,
        planned_piggy_refloat: null,
        planned_savings_refloat: null,
        budget_snapshot_data: { a: 20 },
        project_snapshot_data: {},
      }),
    ).toEqual({
      legacyPiggy: 10,
      legacySavings: 0,
      piggy: 0,
      savings: {},
      budgets: { a: 20 },
      projects: {},
    })
  })

  it('lit le `recap` exposé par /status', () => {
    expect(
      planFromProgress({
        refloatedFromPiggy: 0,
        refloatedFromSavings: 0,
        plannedPiggyRefloat: 15,
        plannedSavingsRefloat: { a: 30 },
        snapshotData: null,
        projectSnapshotData: { p: 5 },
      }),
    ).toEqual({
      legacyPiggy: 0,
      legacySavings: 0,
      piggy: 15,
      savings: { a: 30 },
      budgets: {},
      projects: { p: 5 },
    })
  })
})
