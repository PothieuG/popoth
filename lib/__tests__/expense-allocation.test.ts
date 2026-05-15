import { describe, it, expect } from 'vitest'
import { calculateBreakdown } from '@/lib/expense-allocation'

/**
 * Pure-unit tests for `calculateBreakdown` (Sprint P4-P5-P6 / Phase A4).
 *
 * The algorithm matches next-steps.md spec P4 strict:
 *   - **Default (toggle off)**: budget first, savings cascade only on overflow,
 *     piggy NEVER auto-debited.
 *   - **P5 opt-in (toggle on)**: savings first, budget second.
 *
 * `overflow > 0` signals Phase 2 cross-budget cascade need — the route
 * handler / UI step is responsible for prompting the user.
 *
 * No mocks — `calculateBreakdown` is pure-sync (0 I/O).
 */

describe('calculateBreakdown — P4 strict default (toggle off)', () => {
  it('amount fits budget → all budget, savings & piggy untouched', () => {
    const result = calculateBreakdown(100, 500, 50)
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 0,
      fromBudget: 100,
      overflow: 0,
    })
  })

  it('amount exceeds budget → savings cascade absorbs overflow', () => {
    // budgetRemaining=20, savings=80, amount=50 → 20 budget + 30 savings, savings unused: 50
    const result = calculateBreakdown(50, 20, 80)
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 30,
      fromBudget: 20,
      overflow: 0,
    })
  })

  it('amount exceeds budget + savings → overflow > 0', () => {
    // budgetRemaining=20, savings=30, amount=100 → 20 + 30 + overflow 50
    const result = calculateBreakdown(100, 20, 30)
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 30,
      fromBudget: 20,
      overflow: 50,
    })
  })

  it('zero budget remaining → all savings cascade', () => {
    // budgetRemaining=0, savings=100, amount=40 → 0 + 40 savings
    const result = calculateBreakdown(40, 0, 100)
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 40,
      fromBudget: 0,
      overflow: 0,
    })
  })

  it('zero savings → only budget can fund (no cascade possible)', () => {
    // budgetRemaining=50, savings=0, amount=80 → 50 budget + overflow 30
    const result = calculateBreakdown(80, 50, 0)
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 0,
      fromBudget: 50,
      overflow: 30,
    })
  })

  it('zero budget + zero savings → all overflow (Phase 2 needed)', () => {
    const result = calculateBreakdown(100, 0, 0)
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 0,
      fromBudget: 0,
      overflow: 100,
    })
  })

  it('exact boundary: amount === budgetRemaining → no cascade', () => {
    const result = calculateBreakdown(100, 100, 50)
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 0,
      fromBudget: 100,
      overflow: 0,
    })
  })

  it('negative budgetRemaining clamps to 0 (no cascade from underwater budget)', () => {
    // budgetRemaining=-30 (already overspent), savings=100, amount=50
    // → fromBudget=0, savings=50, overflow=0
    const result = calculateBreakdown(50, -30, 100)
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 50,
      fromBudget: 0,
      overflow: 0,
    })
  })

  it('decimal amounts preserve precision', () => {
    // amount=99.99, budgetRemaining=50, savings=100 → 50 budget + 49.99 savings
    const result = calculateBreakdown(99.99, 50, 100)
    expect(result.fromBudget).toBe(50)
    // Note: JS float math may introduce tiny precision artifacts on Math.min;
    // 99.99 - 50 in IEEE 754 is 49.989999... but Math.min returns exactly 49.99
    // because savings (100) > remaining (49.99...). Use toBeCloseTo for safety.
    expect(result.fromBudgetSavings).toBeCloseTo(49.99, 2)
    expect(result.overflow).toBeCloseTo(0, 5)
  })
})

describe('calculateBreakdown — P5 opt-in (toggle on)', () => {
  it('savings consumed first, then budget', () => {
    // amount=100, budget=200, savings=30, toggle on → savings 30 + budget 70
    const result = calculateBreakdown(100, 200, 30, { useSavingsToggle: true })
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 30,
      fromBudget: 70,
      overflow: 0,
    })
  })

  it('savings fully absorbs amount (no budget needed)', () => {
    // amount=30, budget=200, savings=100, toggle on → 30 savings only
    const result = calculateBreakdown(30, 200, 100, { useSavingsToggle: true })
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 30,
      fromBudget: 0,
      overflow: 0,
    })
  })

  it('savings exhausted → cascade to budget', () => {
    // amount=80, budget=200, savings=30, toggle on → 30 savings + 50 budget
    const result = calculateBreakdown(80, 200, 30, { useSavingsToggle: true })
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 30,
      fromBudget: 50,
      overflow: 0,
    })
  })

  it('savings + budget insufficient → overflow', () => {
    // amount=200, budget=50, savings=30, toggle on → 30 savings + 50 budget + 120 overflow
    const result = calculateBreakdown(200, 50, 30, { useSavingsToggle: true })
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 30,
      fromBudget: 50,
      overflow: 120,
    })
  })

  it('zero savings + toggle on → behaves identically to budget-only path', () => {
    // amount=50, budget=200, savings=0, toggle on → 50 budget (no savings to consume)
    const result = calculateBreakdown(50, 200, 0, { useSavingsToggle: true })
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 0,
      fromBudget: 50,
      overflow: 0,
    })
  })
})

describe('calculateBreakdown — invariants & determinism', () => {
  it('fromPiggyBank is ALWAYS 0 (P4 strict — never auto-debited)', () => {
    // Even with large hypothetical piggy values, fromPiggyBank stays 0.
    // (No piggy param accepted in new signature — only via Phase 2 explicit
    // cross-budget cascade which uses a different RPC path entirely.)
    expect(calculateBreakdown(100, 50, 30).fromPiggyBank).toBe(0)
    expect(calculateBreakdown(100, 0, 0).fromPiggyBank).toBe(0)
    expect(calculateBreakdown(100, 1000, 1000, { useSavingsToggle: true }).fromPiggyBank).toBe(0)
  })

  it('breakdown sum + overflow = amount (conservation law)', () => {
    const cases: Array<[number, number, number, boolean?]> = [
      [100, 50, 30],
      [100, 50, 30, true],
      [200, 0, 0],
      [50, 200, 100],
      [99.99, 50, 30],
    ]
    for (const [amount, budgetRemaining, savings, useSavingsToggle] of cases) {
      const result = calculateBreakdown(amount, budgetRemaining, savings, {
        useSavingsToggle: useSavingsToggle ?? false,
      })
      const sum =
        result.fromPiggyBank + result.fromBudgetSavings + result.fromBudget + result.overflow
      expect(sum).toBeCloseTo(amount, 5)
    }
  })

  it('default options (omitted) behaves like { useSavingsToggle: false }', () => {
    const withDefault = calculateBreakdown(100, 50, 30)
    const explicitFalse = calculateBreakdown(100, 50, 30, { useSavingsToggle: false })
    expect(withDefault).toEqual(explicitFalse)
  })

  it('idempotent: same inputs → same outputs', () => {
    const r1 = calculateBreakdown(150, 200, 30, { useSavingsToggle: true })
    const r2 = calculateBreakdown(150, 200, 30, { useSavingsToggle: true })
    expect(r1).toEqual(r2)
  })
})
