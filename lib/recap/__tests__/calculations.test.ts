import { describe, expect, it } from 'vitest'
import {
  computeBudgetSurplus,
  computeProportionalBudgetSnapshot,
  computeProportionalSavingsRefloat,
  computeRecapSummary,
  type RecapSummary,
} from '@/lib/recap'

describe('computeBudgetSurplus', () => {
  it('returns positive surplus when estimated > spent', () => {
    expect(computeBudgetSurplus(100, 70)).toEqual({ surplus: 30, deficit: 0 })
  })

  it('returns positive deficit when estimated < spent', () => {
    expect(computeBudgetSurplus(70, 100)).toEqual({ surplus: 0, deficit: 30 })
  })

  it('returns zero on both when estimated == spent', () => {
    expect(computeBudgetSurplus(50, 50)).toEqual({ surplus: 0, deficit: 0 })
  })

  it('returns cents-precise surplus (100.33 - 100.32 = 0.01) despite float drift', () => {
    expect(computeBudgetSurplus(100.33, 100.32)).toEqual({ surplus: 0.01, deficit: 0 })
  })

  it('returns deficit when estimated is zero', () => {
    expect(computeBudgetSurplus(0, 10)).toEqual({ surplus: 0, deficit: 10 })
  })

  it('returns surplus when spent is zero', () => {
    expect(computeBudgetSurplus(10, 0)).toEqual({ surplus: 10, deficit: 0 })
  })
})

describe('computeRecapSummary', () => {
  const baseInput = {
    currentBalance: 1000,
    piggyAmount: 0,
  }

  it('aggregates surplus across 3 budgets when bilan is positive', () => {
    const result = computeRecapSummary({
      ...baseInput,
      // bilan = ravEffectif - ravEstime → 400 - 100 = 300 (positive)
      ravEstime: 100,
      ravEffectif: 400,
      budgets: [
        {
          budgetId: 'a',
          budgetName: 'A',
          estimatedAmount: 100,
          spentThisMonth: 70,
          cumulatedSavings: 0,
        },
        {
          budgetId: 'b',
          budgetName: 'B',
          estimatedAmount: 200,
          spentThisMonth: 150,
          cumulatedSavings: 0,
        },
        {
          budgetId: 'c',
          budgetName: 'C',
          estimatedAmount: 50,
          spentThisMonth: 30,
          cumulatedSavings: 0,
        },
      ],
    })

    expect(result.totalSurplus).toBe(100)
    expect(result.bilan).toBe(300)
    expect(result.bilanSign).toBe<RecapSummary['bilanSign']>('positive')
  })

  it('reports bilanSign zero when ravEffectif equals ravEstime (mois exactement comme prévu)', () => {
    const result = computeRecapSummary({
      ...baseInput,
      // bilan = 50 - 50 = 0 (équilibre exact)
      ravEstime: 50,
      ravEffectif: 50,
      budgets: [],
    })

    expect(result.bilan).toBe(0)
    expect(result.bilanSign).toBe<RecapSummary['bilanSign']>('zero')
  })

  it('reports bilanSign negative when ravEffectif < ravEstime (j-ai dépensé plus que prévu)', () => {
    const result = computeRecapSummary({
      ...baseInput,
      // bilan = -150 - (-50) = -100 (RAV effectif pire que RAV estimé)
      ravEstime: -50,
      ravEffectif: -150,
      budgets: [
        {
          budgetId: 'a',
          budgetName: 'Loisirs',
          estimatedAmount: 50,
          spentThisMonth: 80,
          cumulatedSavings: 0,
        },
      ],
    })

    expect(result.bilan).toBe(-100)
    expect(result.bilanSign).toBe<RecapSummary['bilanSign']>('negative')
    expect(result.budgets[0]?.deficit).toBe(30)
    expect(result.budgets[0]?.surplus).toBe(0)
  })

  it('returns zero totals when budgets array is empty', () => {
    const result = computeRecapSummary({
      ...baseInput,
      ravEstime: 0,
      ravEffectif: 0,
      budgets: [],
    })

    expect(result.totalSurplus).toBe(0)
    expect(result.totalSavings).toBe(0)
    expect(result.budgets).toEqual([])
  })

  it('returns budgets sorted by budgetId regardless of input order', () => {
    const result = computeRecapSummary({
      ...baseInput,
      ravEstime: 0,
      ravEffectif: 0,
      budgets: [
        {
          budgetId: 'c',
          budgetName: 'C',
          estimatedAmount: 10,
          spentThisMonth: 0,
          cumulatedSavings: 0,
        },
        {
          budgetId: 'a',
          budgetName: 'A',
          estimatedAmount: 10,
          spentThisMonth: 0,
          cumulatedSavings: 0,
        },
        {
          budgetId: 'b',
          budgetName: 'B',
          estimatedAmount: 10,
          spentThisMonth: 0,
          cumulatedSavings: 0,
        },
      ],
    })

    expect(result.budgets.map((b) => b.budgetId)).toEqual(['a', 'b', 'c'])
  })

  it('sums cumulatedSavings across budgets with cents precision', () => {
    const result = computeRecapSummary({
      ...baseInput,
      ravEstime: 0,
      ravEffectif: 0,
      budgets: [
        {
          budgetId: 'a',
          budgetName: 'A',
          estimatedAmount: 0,
          spentThisMonth: 0,
          cumulatedSavings: 10.5,
        },
        {
          budgetId: 'b',
          budgetName: 'B',
          estimatedAmount: 0,
          spentThisMonth: 0,
          cumulatedSavings: 20.25,
        },
        {
          budgetId: 'c',
          budgetName: 'C',
          estimatedAmount: 0,
          spentThisMonth: 0,
          cumulatedSavings: 30.125,
        },
      ],
    })

    expect(result.totalSavings).toBe(60.88)
  })

  it('passes piggyAmount through verbatim', () => {
    const result = computeRecapSummary({
      currentBalance: 0,
      piggyAmount: 123.45,
      ravEstime: 0,
      ravEffectif: 0,
      budgets: [],
    })

    expect(result.piggyAmount).toBe(123.45)
  })

  it('computes bilan cents-precise when RAVs combine to a sub-cent value', () => {
    const result = computeRecapSummary({
      ...baseInput,
      // bilan = 100.015 - 100.005 = 0.01 (cents-precise via round2 absorbe float drift)
      ravEstime: 100.005,
      ravEffectif: 100.015,
      budgets: [],
    })

    expect(result.bilan).toBe(0.01)
  })

  // Sprint Recap-Positive-Consume-Surplus (2026-05-25) — piggyTransfersData
  // tracker is treated as virtual spending so the surplus reaches 0 once the
  // user has transferred everything to the piggy bank.

  it('preserves surplus when piggyTransfersData is undefined (regression guard)', () => {
    const result = computeRecapSummary({
      ...baseInput,
      ravEstime: 0,
      ravEffectif: 0,
      budgets: [
        {
          budgetId: 'a',
          budgetName: 'A',
          estimatedAmount: 100,
          spentThisMonth: 50,
          cumulatedSavings: 0,
        },
      ],
    })

    expect(result.budgets[0]?.surplus).toBe(50)
  })

  it('subtracts piggyTransfersData[budgetId] from the surplus computation', () => {
    const result = computeRecapSummary({
      ...baseInput,
      ravEstime: 0,
      ravEffectif: 0,
      budgets: [
        {
          budgetId: 'a',
          budgetName: 'A',
          estimatedAmount: 100,
          spentThisMonth: 50,
          cumulatedSavings: 0,
        },
      ],
      piggyTransfersData: { a: 25 },
    })

    // estimated 100 - (spent 50 + transferred 25) = 25 remaining surplus
    expect(result.budgets[0]?.surplus).toBe(25)
    // spentThisMonth in the BudgetSummary stays the raw value — only the surplus is adjusted
    expect(result.budgets[0]?.spentThisMonth).toBe(50)
  })

  it('clamps surplus at 0 when piggyTransfersData over-consumes (max guard)', () => {
    const result = computeRecapSummary({
      ...baseInput,
      ravEstime: 0,
      ravEffectif: 0,
      budgets: [
        {
          budgetId: 'a',
          budgetName: 'A',
          estimatedAmount: 100,
          spentThisMonth: 50,
          cumulatedSavings: 0,
        },
      ],
      // 60 > 50 of remaining surplus → must clamp at 0 (computeBudgetSurplus uses max(0, diff))
      piggyTransfersData: { a: 60 },
    })

    expect(result.budgets[0]?.surplus).toBe(0)
    // overshoot does NOT bleed into deficit — the tracker is a tirelire offset, not a real overspend
    expect(result.budgets[0]?.deficit).toBe(10)
  })
})

describe('computeProportionalSavingsRefloat', () => {
  it('distributes a target proportionally across two budgets', () => {
    const result = computeProportionalSavingsRefloat(100, [
      { budgetId: 'a', cumulatedSavings: 200 },
      { budgetId: 'b', cumulatedSavings: 100 },
    ])

    expect(result.perBudget).toEqual([
      { budgetId: 'a', amount: 66.67 },
      { budgetId: 'b', amount: 33.33 },
    ])
    expect(result.totalAllocated).toBe(100)
    expect(result.shortfall).toBe(0)
  })

  it('returns shortfall 0 when total pool equals target exactly', () => {
    const result = computeProportionalSavingsRefloat(100, [
      { budgetId: 'a', cumulatedSavings: 70 },
      { budgetId: 'b', cumulatedSavings: 30 },
    ])

    expect(result.perBudget).toEqual([
      { budgetId: 'a', amount: 70 },
      { budgetId: 'b', amount: 30 },
    ])
    expect(result.totalAllocated).toBe(100)
    expect(result.shortfall).toBe(0)
  })

  it('caps allocation at pool capacity and reports shortfall when pool < target', () => {
    const result = computeProportionalSavingsRefloat(200, [
      { budgetId: 'a', cumulatedSavings: 70 },
      { budgetId: 'b', cumulatedSavings: 30 },
    ])

    expect(result.perBudget).toEqual([
      { budgetId: 'a', amount: 70 },
      { budgetId: 'b', amount: 30 },
    ])
    expect(result.totalAllocated).toBe(100)
    expect(result.shortfall).toBe(100)
  })

  it('returns empty perBudget when every pool is zero', () => {
    const result = computeProportionalSavingsRefloat(100, [
      { budgetId: 'a', cumulatedSavings: 0 },
      { budgetId: 'b', cumulatedSavings: 0 },
    ])

    expect(result.perBudget).toEqual([])
    expect(result.totalAllocated).toBe(0)
    expect(result.shortfall).toBe(100)
  })

  it('allocates to a single budget when pool > target', () => {
    const result = computeProportionalSavingsRefloat(50, [{ budgetId: 'a', cumulatedSavings: 200 }])

    expect(result.perBudget).toEqual([{ budgetId: 'a', amount: 50 }])
    expect(result.totalAllocated).toBe(50)
    expect(result.shortfall).toBe(0)
  })

  it('caps a single insufficient budget and reports shortfall', () => {
    const result = computeProportionalSavingsRefloat(100, [{ budgetId: 'a', cumulatedSavings: 30 }])

    expect(result.perBudget).toEqual([{ budgetId: 'a', amount: 30 }])
    expect(result.totalAllocated).toBe(30)
    expect(result.shortfall).toBe(70)
  })

  it('returns empty allocation when target is zero', () => {
    const result = computeProportionalSavingsRefloat(0, [{ budgetId: 'a', cumulatedSavings: 100 }])

    expect(result.perBudget).toEqual([])
    expect(result.totalAllocated).toBe(0)
    expect(result.shortfall).toBe(0)
  })

  it('lets the last budget absorb the cents remainder for an exact total', () => {
    const result = computeProportionalSavingsRefloat(100, [
      { budgetId: 'a', cumulatedSavings: 100 },
      { budgetId: 'b', cumulatedSavings: 100 },
      { budgetId: 'c', cumulatedSavings: 100 },
    ])

    expect(result.perBudget).toEqual([
      { budgetId: 'a', amount: 33.33 },
      { budgetId: 'b', amount: 33.33 },
      { budgetId: 'c', amount: 33.34 },
    ])
    expect(result.totalAllocated).toBe(100)
    expect(result.shortfall).toBe(0)
  })

  it('sorts perBudget output by budgetId regardless of input order', () => {
    const result = computeProportionalSavingsRefloat(60, [
      { budgetId: 'c', cumulatedSavings: 100 },
      { budgetId: 'a', cumulatedSavings: 100 },
      { budgetId: 'b', cumulatedSavings: 100 },
    ])

    expect(result.perBudget.map((p) => p.budgetId)).toEqual(['a', 'b', 'c'])
  })

  it('guarantees sum(perBudget.amount) equals min(target, pool) to cents precision', () => {
    const target = 137.42
    const budgets = [
      { budgetId: 'a', cumulatedSavings: 213.11 },
      { budgetId: 'b', cumulatedSavings: 67.55 },
      { budgetId: 'c', cumulatedSavings: 419.34 },
      { budgetId: 'd', cumulatedSavings: 102.77 },
    ]
    const result = computeProportionalSavingsRefloat(target, budgets)
    const sum = Math.round(result.perBudget.reduce((s, p) => s + p.amount, 0) * 100) / 100

    expect(sum).toBe(target)
    expect(result.shortfall).toBe(0)
  })

  it('returns empty allocation and zero shortfall when target is negative', () => {
    const result = computeProportionalSavingsRefloat(-5, [{ budgetId: 'a', cumulatedSavings: 100 }])

    expect(result.perBudget).toEqual([])
    expect(result.totalAllocated).toBe(0)
    expect(result.shortfall).toBe(0)
  })

  it('allocates each budget exactly its pool when total pool equals target with equal sizes', () => {
    const result = computeProportionalSavingsRefloat(100, [
      { budgetId: 'a', cumulatedSavings: 50 },
      { budgetId: 'b', cumulatedSavings: 50 },
    ])

    expect(result.perBudget).toEqual([
      { budgetId: 'a', amount: 50 },
      { budgetId: 'b', amount: 50 },
    ])
    expect(result.totalAllocated).toBe(100)
    expect(result.shortfall).toBe(0)
  })
})

describe('computeProportionalBudgetSnapshot', () => {
  it('distributes equally across budgets with the same estimatedAmount (spec example 30€/3 budgets)', () => {
    const result = computeProportionalBudgetSnapshot(30, [
      { budgetId: 'a', estimatedAmount: 100 },
      { budgetId: 'b', estimatedAmount: 100 },
      { budgetId: 'c', estimatedAmount: 100 },
    ])

    expect(result.perBudget).toEqual([
      { budgetId: 'a', amount: 10 },
      { budgetId: 'b', amount: 10 },
      { budgetId: 'c', amount: 10 },
    ])
    expect(result.totalAllocated).toBe(30)
    expect(result.shortfall).toBe(0)
  })

  it('distributes proportionally when estimatedAmounts differ (100/50/25 pool)', () => {
    const result = computeProportionalBudgetSnapshot(30, [
      { budgetId: 'a', estimatedAmount: 100 },
      { budgetId: 'b', estimatedAmount: 50 },
      { budgetId: 'c', estimatedAmount: 25 },
    ])

    expect(result.perBudget).toEqual([
      { budgetId: 'a', amount: 17.14 },
      { budgetId: 'b', amount: 8.57 },
      { budgetId: 'c', amount: 4.29 },
    ])
    expect(result.totalAllocated).toBe(30)
    expect(result.shortfall).toBe(0)
  })

  it('lets the last budget absorb the cents remainder for an exact total (target=10, 3x100)', () => {
    const result = computeProportionalBudgetSnapshot(10, [
      { budgetId: 'a', estimatedAmount: 100 },
      { budgetId: 'b', estimatedAmount: 100 },
      { budgetId: 'c', estimatedAmount: 100 },
    ])

    expect(result.perBudget).toEqual([
      { budgetId: 'a', amount: 3.33 },
      { budgetId: 'b', amount: 3.33 },
      { budgetId: 'c', amount: 3.34 },
    ])
    expect(result.totalAllocated).toBe(10)
  })

  it('caps a single insufficient budget and reports shortfall', () => {
    const result = computeProportionalBudgetSnapshot(100, [{ budgetId: 'a', estimatedAmount: 30 }])

    expect(result.perBudget).toEqual([{ budgetId: 'a', amount: 30 }])
    expect(result.totalAllocated).toBe(30)
    expect(result.shortfall).toBe(70)
  })

  it('returns empty perBudget when every estimatedAmount is zero', () => {
    const result = computeProportionalBudgetSnapshot(50, [
      { budgetId: 'a', estimatedAmount: 0 },
      { budgetId: 'b', estimatedAmount: 0 },
    ])

    expect(result.perBudget).toEqual([])
    expect(result.totalAllocated).toBe(0)
    expect(result.shortfall).toBe(50)
  })

  it('gives equal shares to budgets with the same estimatedAmount (carryover-ignored regression guard)', () => {
    const result = computeProportionalBudgetSnapshot(20, [
      { budgetId: 'a', estimatedAmount: 50 },
      { budgetId: 'b', estimatedAmount: 50 },
    ])

    expect(result.perBudget).toEqual([
      { budgetId: 'a', amount: 10 },
      { budgetId: 'b', amount: 10 },
    ])
  })

  it('sorts perBudget output by budgetId regardless of input order', () => {
    const result = computeProportionalBudgetSnapshot(30, [
      { budgetId: 'c', estimatedAmount: 100 },
      { budgetId: 'a', estimatedAmount: 100 },
      { budgetId: 'b', estimatedAmount: 100 },
    ])

    expect(result.perBudget.map((p) => p.budgetId)).toEqual(['a', 'b', 'c'])
  })
})
