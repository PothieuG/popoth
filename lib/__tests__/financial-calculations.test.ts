/**
 * Characterization tests for `lib/financial-calculations.ts` — chantier I4.
 *
 * Pin the behavior of the 5 PURE calc helpers before they're extracted to
 * `lib/finance/calc-rtl.ts`. These tests must continue to pass verbatim
 * after extraction (re-export shim during commits 2-8, then dropped at #10).
 *
 * The DB-bound functions (getProfileFinancialData, getGroupFinancialData,
 * getRavFromDatabase, getBudgetSavingsDetail, saveRemainingToLiveSnapshot)
 * are not characterized here — they're covered by gated suites in commits
 * #6-#8 (`SUPABASE_FINANCE_TESTS=1`, mirror api-regressions.test.ts).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  calculateAvailableCash,
  calculateBudgetDeficit,
  calculateBudgetSavings,
  calculateRemainingToLiveGroup,
  calculateRemainingToLiveProfile,
} from '@/lib/financial-calculations'

// The god file's pure helpers carry verbose console.log debug output
// (~25 sites). Silence during tests to keep output clean. Lot 2 cleanup
// in commit #5 will drop these — the spies become no-ops then.
beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterAll(() => {
  vi.restoreAllMocks()
})

describe('calculateAvailableCash', () => {
  it('returns bankBalance + realIncomes - realExpenses for positive case', () => {
    expect(calculateAvailableCash(1000, 500, 200)).toBe(1300)
  })

  it('allows negative result (overdraft)', () => {
    expect(calculateAvailableCash(100, 0, 500)).toBe(-400)
  })

  it('returns 0 when all inputs are 0', () => {
    expect(calculateAvailableCash(0, 0, 0)).toBe(0)
  })

  it('handles floating-point arithmetic at cent precision', () => {
    // 0.1 + 0.2 famously yields 0.30000000000000004 in IEEE 754; the formula
    // does not round, callers are expected to handle precision at display.
    expect(calculateAvailableCash(0.1, 0.2, 0)).toBeCloseTo(0.3, 10)
  })
})

describe('calculateBudgetSavings', () => {
  it('returns 0 in real-time (isEndOfPeriod default false), even when savings would exist', () => {
    expect(calculateBudgetSavings(200, 150)).toBe(0)
  })

  it('returns 0 in real-time when explicitly false', () => {
    expect(calculateBudgetSavings(200, 150, false)).toBe(0)
  })

  it('returns estimated - spent at end-of-period when under budget', () => {
    expect(calculateBudgetSavings(200, 150, true)).toBe(50)
  })

  it('returns 0 at end-of-period when over budget (no negative savings)', () => {
    expect(calculateBudgetSavings(200, 250, true)).toBe(0)
  })

  it('returns 0 at end-of-period when exactly on budget', () => {
    expect(calculateBudgetSavings(200, 200, true)).toBe(0)
  })
})

describe('calculateBudgetDeficit', () => {
  it('returns 0 when spent is below estimated (no deficit)', () => {
    expect(calculateBudgetDeficit(300, 200)).toBe(0)
  })

  it('returns 0 when spent equals estimated (boundary)', () => {
    expect(calculateBudgetDeficit(300, 300)).toBe(0)
  })

  it('returns spent - estimated when over budget', () => {
    expect(calculateBudgetDeficit(300, 450)).toBe(150)
  })
})

describe('calculateRemainingToLiveProfile', () => {
  it('applies the canonical formula: contribution + exceptionalIn - estimatedBudgets - exceptionalOut - deficits', async () => {
    // 2000 + 100 - 1500 - 50 - 0 = 550
    await expect(
      calculateRemainingToLiveProfile(2000, 100, 1500, 50, 0),
    ).resolves.toBe(550)
  })

  it('returns negative RAV when expenses dominate', async () => {
    // 1000 + 0 - 1500 - 200 - 100 = -800
    await expect(
      calculateRemainingToLiveProfile(1000, 0, 1500, 200, 100),
    ).resolves.toBe(-800)
  })

  it('defaults budgetDeficits to 0 when omitted', async () => {
    // 2000 + 0 - 1500 - 0 = 500
    await expect(calculateRemainingToLiveProfile(2000, 0, 1500, 0)).resolves.toBe(500)
  })
})

describe('calculateRemainingToLiveGroup', () => {
  it('applies the canonical formula with group contributions added: contribution + exceptionalIn + groupContrib - estimatedBudgets - exceptionalOut - deficits', async () => {
    // 2000 + 100 + 500 - 1500 - 50 - 0 = 1050
    await expect(
      calculateRemainingToLiveGroup(2000, 100, 500, 1500, 50, 0),
    ).resolves.toBe(1050)
  })

  it('returns negative RAV when expenses dominate even with group contribution', async () => {
    // 1000 + 0 + 200 - 1500 - 200 - 100 = -600
    await expect(
      calculateRemainingToLiveGroup(1000, 0, 200, 1500, 200, 100),
    ).resolves.toBe(-600)
  })

  it('defaults budgetDeficits to 0 when omitted', async () => {
    // 2000 + 0 + 500 - 1500 - 0 = 1000
    await expect(
      calculateRemainingToLiveGroup(2000, 0, 500, 1500, 0),
    ).resolves.toBe(1000)
  })

  it('matches the profile formula when totalGroupContributions is 0', async () => {
    // Equivalence check: group with 0 group-contrib === profile with same other args
    const groupResult = await calculateRemainingToLiveGroup(2000, 100, 0, 1500, 50, 25)
    const profileResult = await calculateRemainingToLiveProfile(2000, 100, 1500, 50, 25)
    expect(groupResult).toBe(profileResult)
  })
})
