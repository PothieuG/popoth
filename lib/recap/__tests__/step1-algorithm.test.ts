import { describe, it, expect } from 'vitest'
import { decideStep1Allocation } from '@/lib/recap/step1-algorithm'
import type { BudgetAnalysis, ProcessStep1Snapshot } from '@/lib/recap/types'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Builds a BudgetAnalysis with sensible defaults. Override the fields you
 * care about per test.
 */
function makeBudget(overrides: Partial<BudgetAnalysis> & { id: string }): BudgetAnalysis {
  return {
    name: `budget-${overrides.id}`,
    estimated_amount: 100,
    spent_amount: 0,
    surplus: 0,
    deficit: 0,
    cumulated_savings: 0,
    ...overrides,
  }
}

/**
 * Builds a ProcessStep1Snapshot with sensible defaults. ravActuel, ravBudgetaire
 * and difference are linked: caller sets ravActuel + ravBudgetaire, difference
 * is derived (override if you need to break the invariant for a specific test).
 */
function makeSnapshot(overrides: {
  piggyBank?: number
  ravActuel: number
  ravBudgetaire: number
  difference?: number
  budgetAnalyses?: BudgetAnalysis[]
  context?: 'profile' | 'group'
}): ProcessStep1Snapshot {
  return {
    context: overrides.context ?? 'profile',
    contextId: 'test-context-id',
    ownerField: 'profile_id',
    piggyBank: overrides.piggyBank ?? 50,
    ravActuel: overrides.ravActuel,
    ravBudgetaire: overrides.ravBudgetaire,
    difference: overrides.difference ?? overrides.ravActuel - overrides.ravBudgetaire,
    budgetAnalyses: overrides.budgetAnalyses ?? [],
  }
}

// ---------------------------------------------------------------------------
// CAS 1 — excédent (difference >= 0)
// ---------------------------------------------------------------------------
describe('CAS 1 — excédent (difference >= 0)', () => {
  it('pure excédent: emits 1.1 op with full difference to piggy_bank', () => {
    const snap = makeSnapshot({ piggyBank: 50, ravActuel: 700, ravBudgetaire: 500 })
    const d = decideStep1Allocation(snap)
    expect(d.case).toBe('excedent')
    expect(d.newPiggyBank).toBe(250)
    expect(d.operations).toHaveLength(1)
    expect(d.operations[0]).toMatchObject({
      step: '1.1',
      type: 'excedent_to_piggy_bank',
      details: { excedent_amount: 200, old_piggy_bank: 50, new_piggy_bank: 250 },
    })
  })

  it('excédent + deficit budgets: deficits listed, NOT refloated', () => {
    const snap = makeSnapshot({
      ravActuel: 700,
      ravBudgetaire: 500,
      budgetAnalyses: [makeBudget({ id: 'a', deficit: 50 }), makeBudget({ id: 'b', surplus: 30 })],
    })
    const d = decideStep1Allocation(snap)
    expect(d.case).toBe('excedent')
    expect(d.budgetsWithDeficitRefloated).toEqual([{ id: 'a', name: 'budget-a', deficit: 50 }])
    expect(d.secondPassRefloatOps).toHaveLength(0)
    // No 2.3.1 ops in CAS 1 — deficits are listed but not refloated
    expect(d.operations.some((o) => o.step === '2.3.1')).toBe(false)
  })

  it('zero-difference (équilibre exact): NO 1.1 op, piggy unchanged', () => {
    const snap = makeSnapshot({ piggyBank: 50, ravActuel: 500, ravBudgetaire: 500 })
    const d = decideStep1Allocation(snap)
    expect(d.case).toBe('excedent')
    expect(d.operations).toHaveLength(0)
    expect(d.newPiggyBank).toBe(50)
  })

  it('NaN-safe: no surplus budgets means empty budgetsWithDeficitRefloated', () => {
    const snap = makeSnapshot({ ravActuel: 100, ravBudgetaire: 50, budgetAnalyses: [] })
    const d = decideStep1Allocation(snap)
    expect(d.budgetsWithDeficitRefloated).toEqual([])
  })

  it('sub-tolerance difference (0.005): emits 1.1 op with the tiny amount', () => {
    // CAS 1 path doesn't gate on ROUNDING_TOLERANCE — `difference > 0` is enough.
    // The asymmetry tolerance is for CAS 2 skip decisions, not CAS 1.
    const snap = makeSnapshot({ piggyBank: 50, ravActuel: 500.005, ravBudgetaire: 500 })
    const d = decideStep1Allocation(snap)
    expect(d.operations).toHaveLength(1)
    expect(d.operations[0]?.step).toBe('1.1')
  })
})

// ---------------------------------------------------------------------------
// CAS 2 ÉTAPE 2.2 — savings used proportionally
// ---------------------------------------------------------------------------
describe('CAS 2 ÉTAPE 2.2 — savings used proportionally', () => {
  it('savings >= gap: all gap covered by savings, NO 2.3 op fires', () => {
    const snap = makeSnapshot({
      ravActuel: -200,
      ravBudgetaire: 0,
      budgetAnalyses: [
        makeBudget({ id: 'a', cumulated_savings: 200 }),
        makeBudget({ id: 'b', cumulated_savings: 300 }),
      ],
    })
    const d = decideStep1Allocation(snap)
    expect(d.case).toBe('deficit')
    // 200 / 500 = 40% from 'a' (80€), 60% from 'b' (120€)
    const useSavingsOps = d.operations.filter((o) => o.step === '2.2')
    expect(useSavingsOps).toHaveLength(2)
    const aOp = useSavingsOps.find((o) => o.type === 'use_savings' && o.details.budget_id === 'a')
    const bOp = useSavingsOps.find((o) => o.type === 'use_savings' && o.details.budget_id === 'b')
    expect(aOp?.type === 'use_savings' && aOp.details.amount_used).toBeCloseTo(80)
    expect(bOp?.type === 'use_savings' && bOp.details.amount_used).toBeCloseTo(120)
    expect(d.gapResiduel).toBeCloseTo(0)
    expect(d.isFullyBalanced).toBe(true)
    expect(d.newBudgetSavings).toEqual({ a: expect.closeTo(120), b: expect.closeTo(180) })
  })

  it('savings < gap: gap reduced but not zeroed; surplus no longer consumed', () => {
    const snap = makeSnapshot({
      ravActuel: -500,
      ravBudgetaire: 0,
      budgetAnalyses: [
        makeBudget({ id: 'sav', cumulated_savings: 200 }),
        makeBudget({ id: 'sur', surplus: 400 }),
      ],
    })
    const d = decideStep1Allocation(snap)
    expect(d.case).toBe('deficit')
    // 2.2 consumes 200 → gap = 300 (post-Sprint Refactor-I5-followup: 2.3 dropped,
    // surplus is no longer consumed, gap residuel stays 300, isFullyBalanced=false).
    const step22 = d.operations.filter((o) => o.step === '2.2')
    expect(step22).toHaveLength(1)
    expect(step22[0]?.type === 'use_savings' && step22[0].details.amount_used).toBeCloseTo(200)
    expect(d.gapResiduel).toBeCloseTo(300)
    expect(d.isFullyBalanced).toBe(false)
  })

  it('no savings budgets: 2.2 emits nothing, gap untouched', () => {
    const snap = makeSnapshot({
      ravActuel: -100,
      ravBudgetaire: 0,
      budgetAnalyses: [makeBudget({ id: 'sur', surplus: 100 })],
    })
    const d = decideStep1Allocation(snap)
    const step22 = d.operations.filter((o) => o.step === '2.2')
    expect(step22).toHaveLength(0)
    expect(d.newBudgetSavings).toEqual({})
  })

  it('single budget with all savings: 100% proportion', () => {
    const snap = makeSnapshot({
      ravActuel: -100,
      ravBudgetaire: 0,
      budgetAnalyses: [makeBudget({ id: 'only', cumulated_savings: 200 })],
    })
    const d = decideStep1Allocation(snap)
    const op = d.operations.find((o) => o.step === '2.2')
    expect(op?.type === 'use_savings' && op.details.amount_used).toBeCloseTo(100)
    expect(op?.type === 'use_savings' && op.details.proportion).toBe(1)
    expect(d.newBudgetSavings).toEqual({ only: expect.closeTo(100) })
  })

  it('mixed: 2 savings + 1 surplus + 1 deficit, gap split correctly', () => {
    const snap = makeSnapshot({
      ravActuel: -300,
      ravBudgetaire: 0,
      budgetAnalyses: [
        makeBudget({ id: 'd', deficit: 200 }),
        makeBudget({ id: 'su', surplus: 100 }),
        makeBudget({ id: 's1', cumulated_savings: 100 }),
        makeBudget({ id: 's2', cumulated_savings: 200 }),
      ],
    })
    const d = decideStep1Allocation(snap)
    // 2.2: savings 100+200=300 ≥ gap 300 → exhausts both: s1=100*300/300=100→0, s2=200*300/300=200→0
    const step22 = d.operations.filter((o) => o.step === '2.2')
    expect(step22.length).toBe(2)
    expect(d.newBudgetSavings).toEqual({ s1: expect.closeTo(0), s2: expect.closeTo(0) })
  })
})

// ---------------------------------------------------------------------------
// CAS 2 ÉTAPE 2.3.1 — deficit refloat proportional
// ---------------------------------------------------------------------------
describe('CAS 2 ÉTAPE 2.3.1 — deficit refloat proportional', () => {
  it('full refloat when totalDeficit === gap and gap fully covered', () => {
    const snap = makeSnapshot({
      ravActuel: -100,
      ravBudgetaire: 0,
      budgetAnalyses: [
        makeBudget({ id: 'def', deficit: 100 }),
        makeBudget({ id: 'sav', cumulated_savings: 100 }),
      ],
    })
    const d = decideStep1Allocation(snap)
    const refloat = d.operations.find((o) => o.step === '2.3.1')
    expect(refloat?.type === 'transfer_to_deficit' && refloat.details.transfer_amount).toBeCloseTo(
      100,
    )
    expect(
      refloat?.type === 'transfer_to_deficit' && refloat.details.deficit_remaining,
    ).toBeCloseTo(0)
  })

  it('partial refloat by proportion across multiple deficit budgets', () => {
    const snap = makeSnapshot({
      ravActuel: -100,
      ravBudgetaire: 0,
      budgetAnalyses: [
        makeBudget({ id: 'd1', deficit: 50 }),
        makeBudget({ id: 'd2', deficit: 50 }),
        makeBudget({ id: 'sav', cumulated_savings: 100 }),
      ],
    })
    const d = decideStep1Allocation(snap)
    const refloats = d.operations.filter((o) => o.step === '2.3.1')
    expect(refloats).toHaveLength(2)
    // d1 and d2 each get 50/100 = 50% × 100 = 50€
    const d1Op = refloats.find(
      (o) => o.type === 'transfer_to_deficit' && o.details.budget_id === 'd1',
    )
    const d2Op = refloats.find(
      (o) => o.type === 'transfer_to_deficit' && o.details.budget_id === 'd2',
    )
    expect(d1Op?.type === 'transfer_to_deficit' && d1Op.details.transfer_amount).toBeCloseTo(50)
    expect(d2Op?.type === 'transfer_to_deficit' && d2Op.details.transfer_amount).toBeCloseTo(50)
  })

  it('totalDeficit > resources: partial refloat, leaves deficits in memory', () => {
    // gap=100, savings exhausted → ressourcesUtilisees=100. totalDeficit=200 > 100.
    // montantARenflouer = min(100, 200) = 100. Refloats each deficit proportionally.
    const snap = makeSnapshot({
      ravActuel: -100,
      ravBudgetaire: 0,
      budgetAnalyses: [
        makeBudget({ id: 'd1', deficit: 100 }),
        makeBudget({ id: 'd2', deficit: 100 }),
        makeBudget({ id: 'sav', cumulated_savings: 100 }),
      ],
    })
    const d = decideStep1Allocation(snap)
    const refloats = d.operations.filter((o) => o.step === '2.3.1')
    expect(refloats).toHaveLength(2)
    // d1 = 100/200=50% × 100 = 50€ (deficit_remaining = 50)
    const d1Op = refloats.find(
      (o) => o.type === 'transfer_to_deficit' && o.details.budget_id === 'd1',
    )
    expect(d1Op?.type === 'transfer_to_deficit' && d1Op.details.transfer_amount).toBeCloseTo(50)
    expect(d1Op?.type === 'transfer_to_deficit' && d1Op.details.deficit_remaining).toBeCloseTo(50)
  })

  it('no deficits: 2.3.1 emits nothing', () => {
    const snap = makeSnapshot({
      ravActuel: -50,
      ravBudgetaire: 0,
      budgetAnalyses: [makeBudget({ id: 'sav', cumulated_savings: 100 })],
    })
    const d = decideStep1Allocation(snap)
    expect(d.operations.filter((o) => o.step === '2.3.1')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// CAS 2 ÉTAPE 2.4.2 — 2nd-pass refloat from remaining savings
// ---------------------------------------------------------------------------
describe('CAS 2 ÉTAPE 2.4.2 — 2nd-pass refloat from remaining savings', () => {
  it('fires when equilibre atteint AND deficits remain AND savings remain', () => {
    // gap=200, 2.2 uses 200 from savings(500), leaves 300. 2.3.1 refloats 200 of
    // the 400 deficit. After: deficit=200 left in memory, savings=300 left.
    // 2.4.2 fires.
    const snap = makeSnapshot({
      ravActuel: -200,
      ravBudgetaire: 0,
      budgetAnalyses: [
        makeBudget({ id: 'def', deficit: 400 }),
        makeBudget({ id: 'sav', cumulated_savings: 500 }),
      ],
    })
    const d = decideStep1Allocation(snap)
    expect(d.isFullyBalanced).toBe(true)
    expect(d.secondPassRefloatOps.length).toBeGreaterThan(0)
    // The 2.4.2 op moves savings → deficit
    const op = d.secondPassRefloatOps[0]
    expect(op?.fromBudgetId).toBe('sav')
    expect(op?.toBudgetId).toBe('def')
  })

  it('does NOT fire if not isFullyBalanced (gap residuel > tolerance)', () => {
    const snap = makeSnapshot({
      ravActuel: -1000,
      ravBudgetaire: 0,
      budgetAnalyses: [
        makeBudget({ id: 'def', deficit: 200 }),
        makeBudget({ id: 'sav', cumulated_savings: 100 }),
      ],
    })
    const d = decideStep1Allocation(snap)
    expect(d.isFullyBalanced).toBe(false)
    expect(d.secondPassRefloatOps).toHaveLength(0)
  })

  it('does NOT fire if no deficit budgets in memory', () => {
    const snap = makeSnapshot({
      ravActuel: -100,
      ravBudgetaire: 0,
      budgetAnalyses: [makeBudget({ id: 'sav', cumulated_savings: 200 })],
    })
    const d = decideStep1Allocation(snap)
    expect(d.secondPassRefloatOps).toHaveLength(0)
  })

  it('does NOT fire if all savings exhausted in 2.2', () => {
    // gap=300, savings=300 → 2.2 exhausts savings. Deficit budget exists but
    // savings are 0 → 2.4.2 skipped.
    const snap = makeSnapshot({
      ravActuel: -300,
      ravBudgetaire: 0,
      budgetAnalyses: [
        makeBudget({ id: 'def', deficit: 100 }),
        makeBudget({ id: 'sav', cumulated_savings: 300 }),
      ],
    })
    const d = decideStep1Allocation(snap)
    expect(d.secondPassRefloatOps).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Rounding tolerance — asymmetric `>` vs `<=`
// ---------------------------------------------------------------------------
describe('Rounding tolerance — asymmetric > vs <=', () => {
  it('gap exactly at tolerance (0.01): is_fully_balanced=true', () => {
    // Directly construct a snapshot with difference = -0.01 (no budgets to
    // touch → gap stays exactly at 0.01). The <= check marks this as balanced
    // (mirror route L566/L762). Using -100.01/-100 introduces IEEE 754 drift
    // that pushes the gap to ~0.0100000000000001, just above tolerance.
    const snap = makeSnapshot({
      ravActuel: -0.01,
      ravBudgetaire: 0,
      budgetAnalyses: [],
    })
    const d = decideStep1Allocation(snap)
    expect(d.gapResiduel).toBe(0.01)
    expect(d.isFullyBalanced).toBe(true)
  })

  it('gap just above tolerance (0.02): is_fully_balanced=false', () => {
    const snap = makeSnapshot({
      ravActuel: -0.02,
      ravBudgetaire: 0,
      budgetAnalyses: [],
    })
    const d = decideStep1Allocation(snap)
    expect(d.gapResiduel).toBe(0.02)
    expect(d.isFullyBalanced).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('0 budgets in snapshot: CAS 1 with no ops, no refloats', () => {
    const snap = makeSnapshot({ ravActuel: 100, ravBudgetaire: 50, budgetAnalyses: [] })
    const d = decideStep1Allocation(snap)
    expect(d.case).toBe('excedent')
    expect(d.budgetsWithDeficitRefloated).toEqual([])
    expect(d.operations).toHaveLength(1) // just the 1.1
  })

  it('0 budgets + CAS 2: gap residuel = |difference|, no ops', () => {
    const snap = makeSnapshot({ ravActuel: -100, ravBudgetaire: 0, budgetAnalyses: [] })
    const d = decideStep1Allocation(snap)
    expect(d.case).toBe('deficit')
    expect(d.operations).toHaveLength(0)
    expect(d.gapResiduel).toBeCloseTo(100)
    expect(d.isFullyBalanced).toBe(false)
  })

  it('1 budget with all zeros: no surplus, no deficit, no savings', () => {
    const snap = makeSnapshot({
      ravActuel: 50,
      ravBudgetaire: 50,
      budgetAnalyses: [makeBudget({ id: 'a' })],
    })
    const d = decideStep1Allocation(snap)
    expect(d.case).toBe('excedent')
    expect(d.operations).toHaveLength(0)
  })

  it('very large amounts: no overflow', () => {
    const snap = makeSnapshot({
      piggyBank: 1e9,
      ravActuel: 1e10,
      ravBudgetaire: 1e9,
      budgetAnalyses: [],
    })
    const d = decideStep1Allocation(snap)
    expect(d.newPiggyBank).toBe(1e9 + 9e9) // 1e10
    expect(
      d.operations[0]?.type === 'excedent_to_piggy_bank' && d.operations[0].details.excedent_amount,
    ).toBe(9e9)
  })

  it('all-zero amounts produce CAS 1 with no piggy push', () => {
    const snap = makeSnapshot({ piggyBank: 0, ravActuel: 0, ravBudgetaire: 0, budgetAnalyses: [] })
    const d = decideStep1Allocation(snap)
    expect(d.case).toBe('excedent')
    expect(d.newPiggyBank).toBe(0)
    expect(d.operations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Determinism — sort by id ensures reproducible output
// ---------------------------------------------------------------------------
describe('Determinism', () => {
  it('shuffled budget input produces identical operations to sorted input', () => {
    const budgetsSorted: BudgetAnalysis[] = [
      makeBudget({ id: 'aaa', cumulated_savings: 100 }),
      makeBudget({ id: 'bbb', cumulated_savings: 200 }),
      makeBudget({ id: 'ccc', cumulated_savings: 300 }),
    ]
    const budgetsShuffled: BudgetAnalysis[] = [
      makeBudget({ id: 'ccc', cumulated_savings: 300 }),
      makeBudget({ id: 'aaa', cumulated_savings: 100 }),
      makeBudget({ id: 'bbb', cumulated_savings: 200 }),
    ]
    const snap1 = makeSnapshot({
      ravActuel: -300,
      ravBudgetaire: 0,
      budgetAnalyses: budgetsSorted,
    })
    const snap2 = makeSnapshot({
      ravActuel: -300,
      ravBudgetaire: 0,
      budgetAnalyses: budgetsShuffled,
    })
    const d1 = decideStep1Allocation(snap1)
    const d2 = decideStep1Allocation(snap2)
    // Op ordering must match (sorted by id), so JSON serializations match.
    expect(JSON.stringify(d1.operations)).toBe(JSON.stringify(d2.operations))
  })

  it('does NOT mutate the input snapshot (immutability)', () => {
    const budget = makeBudget({ id: 'a', cumulated_savings: 100 })
    const snap = makeSnapshot({ ravActuel: -50, ravBudgetaire: 0, budgetAnalyses: [budget] })
    const beforeSavings = budget.cumulated_savings
    decideStep1Allocation(snap)
    expect(budget.cumulated_savings).toBe(beforeSavings)
  })
})

// ---------------------------------------------------------------------------
// Snapshot test: locks operations_performed shape + ordering for one scenario
// ---------------------------------------------------------------------------
describe('Operations ordering — snapshot lock', () => {
  it('CAS 2 with chain (2.2 + 2.3.1) emits ops in the right order', () => {
    // gap=100, savings=400 (covers gap fully in 2.2), deficit=200 (will be
    // partially refloated in 2.3.1 from ressourcesUtilisees=100).
    // Note: 2.4.2 ops live in `secondPassRefloatOps`, not in `operations`.
    // (Step 2.3 "consume_surplus" was dropped Sprint Refactor-I5-followup.)
    const snap = makeSnapshot({
      ravActuel: -100,
      ravBudgetaire: 0,
      budgetAnalyses: [
        makeBudget({ id: 'def', deficit: 200 }),
        makeBudget({ id: 'sav', cumulated_savings: 400 }),
      ],
    })
    const d = decideStep1Allocation(snap)
    const steps = d.operations.map((o) => o.step)
    const idx22 = steps.indexOf('2.2')
    const idx231 = steps.indexOf('2.3.1')
    expect(idx22).toBeGreaterThanOrEqual(0)
    expect(idx231).toBeGreaterThan(idx22)
  })
})
