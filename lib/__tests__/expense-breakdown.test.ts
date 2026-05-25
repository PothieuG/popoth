import { describe, it, expect } from 'vitest'
import { calculateBreakdownWithAutoCascade } from '@/lib/expense-breakdown'

/**
 * Pure-unit tests for `calculateBreakdownWithAutoCascade` (auto piggy-first
 * + cross-budget proportional cascade). Companion to
 * `expense-allocation.test.ts` which covers the legacy `calculateBreakdown`.
 *
 * Algorithm under test :
 *   1. Local: savings du destination puis budget (P5 toggle ON).
 *   2. Overflow → piggy first (jusqu'à piggyAvailable).
 *   3. Overflow restant → cross-budget proportionnel aux savings disponibles.
 *   4. Résidu (sum disponible < overflow) → absorbé par fromBudget (déficit).
 */

describe('calculateBreakdownWithAutoCascade', () => {
  it('pas d’overflow (couvert par budget + savings local) → retour P5 standard, cascade vide', () => {
    const result = calculateBreakdownWithAutoCascade(50, 100, 0, 200, [
      { budget_id: 'A', available: 100 },
    ])
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 0,
      fromBudget: 50,
      overflow: 0,
      crossBudgetDebits: [],
    })
  })

  it('overflow couvert intégralement par la tirelire → pas de cross-budget', () => {
    const result = calculateBreakdownWithAutoCascade(100, 20, 30, 100, [
      { budget_id: 'A', available: 200 },
    ])
    expect(result).toEqual({
      fromPiggyBank: 50,
      fromBudgetSavings: 30,
      fromBudget: 20,
      overflow: 0,
      crossBudgetDebits: [],
    })
  })

  it('tirelire partielle + 1 budget cross couvre le reste', () => {
    const result = calculateBreakdownWithAutoCascade(100, 20, 30, 20, [
      { budget_id: 'B', available: 50 },
    ])
    expect(result).toEqual({
      fromPiggyBank: 20,
      fromBudgetSavings: 30,
      fromBudget: 20,
      overflow: 0,
      crossBudgetDebits: [{ budget_id: 'B', amount: 30 }],
    })
  })

  it('cascade proportionnelle 2 budgets (ratio 2:1 si available 100/50)', () => {
    const result = calculateBreakdownWithAutoCascade(100, 0, 0, 0, [
      { budget_id: 'A', available: 100 },
      { budget_id: 'B', available: 50 },
    ])
    expect(result.fromPiggyBank).toBe(0)
    expect(result.fromBudgetSavings).toBe(0)
    expect(result.fromBudget).toBe(0)
    expect(result.overflow).toBe(0)
    expect(result.crossBudgetDebits).toEqual([
      { budget_id: 'A', amount: 66.67 },
      { budget_id: 'B', amount: 33.33 },
    ])
    const sum = result.crossBudgetDebits.reduce((s, d) => s + d.amount, 0)
    expect(sum).toBeCloseTo(100, 2)
  })

  it('drift d’arrondi cents — 3 budgets égaux → somme exacte = overflow', () => {
    const result = calculateBreakdownWithAutoCascade(100, 0, 0, 0, [
      { budget_id: 'A', available: 100 },
      { budget_id: 'B', available: 100 },
      { budget_id: 'C', available: 100 },
    ])
    const sum = result.crossBudgetDebits.reduce((s, d) => s + d.amount, 0)
    expect(sum).toBe(100)
    expect(result.crossBudgetDebits).toHaveLength(3)
    const last = result.crossBudgetDebits[result.crossBudgetDebits.length - 1]
    expect(last?.amount).toBe(33.34)
  })

  it('tout réuni < overflow → fromBudget absorbe le résidu (déficit destination)', () => {
    const result = calculateBreakdownWithAutoCascade(100, 0, 0, 10, [
      { budget_id: 'A', available: 20 },
      { budget_id: 'B', available: 20 },
    ])
    expect(result.fromPiggyBank).toBe(10)
    expect(result.fromBudgetSavings).toBe(0)
    expect(result.fromBudget).toBe(50)
    expect(result.overflow).toBe(0)
    expect(result.crossBudgetDebits).toEqual([
      { budget_id: 'A', amount: 20 },
      { budget_id: 'B', amount: 20 },
    ])
    const sumAll =
      result.fromPiggyBank +
      result.fromBudgetSavings +
      result.fromBudget +
      result.crossBudgetDebits.reduce((s, d) => s + d.amount, 0)
    expect(sumAll).toBe(100)
  })

  it('piggy = 0 et aucune source cross → tout overflow va sur fromBudget', () => {
    const result = calculateBreakdownWithAutoCascade(100, 0, 0, 0, [])
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 0,
      fromBudget: 100,
      overflow: 0,
      crossBudgetDebits: [],
    })
  })

  it('filtre les budgets cross avec available = 0', () => {
    const result = calculateBreakdownWithAutoCascade(100, 0, 0, 0, [
      { budget_id: 'A', available: 100 },
      { budget_id: 'B', available: 0 },
      { budget_id: 'C', available: 50 },
    ])
    expect(result.crossBudgetDebits.map((d) => d.budget_id)).toEqual(['A', 'C'])
  })

  it('invariant somme — quelque soit le scénario, somme breakdown = amount', () => {
    const cases = [
      { args: [50, 100, 0, 200, [{ budget_id: 'A', available: 100 }]] as const },
      { args: [100, 20, 30, 100, [{ budget_id: 'A', available: 200 }]] as const },
      { args: [100, 20, 30, 20, [{ budget_id: 'B', available: 50 }]] as const },
      {
        args: [
          100,
          0,
          0,
          0,
          [
            { budget_id: 'A', available: 100 },
            { budget_id: 'B', available: 50 },
          ],
        ] as const,
      },
      {
        args: [
          100,
          0,
          0,
          10,
          [
            { budget_id: 'A', available: 20 },
            { budget_id: 'B', available: 20 },
          ],
        ] as const,
      },
    ]
    for (const { args } of cases) {
      const [amount, budgetRemaining, savingsAvailable, piggyAvailable, others] = args
      const result = calculateBreakdownWithAutoCascade(
        amount,
        budgetRemaining,
        savingsAvailable,
        piggyAvailable,
        others,
      )
      const total =
        result.fromPiggyBank +
        result.fromBudgetSavings +
        result.fromBudget +
        result.crossBudgetDebits.reduce((s, d) => s + d.amount, 0)
      expect(total).toBeCloseTo(amount, 2)
      expect(result.overflow).toBe(0)
    }
  })
})
