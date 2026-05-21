/**
 * Pure-unit tests for `decideRecoveryActions` — Sprint Refactor-Recover.
 *
 * Pins the dispatch v1/v2 + FK-safe ordering + skip-on-empty semantics
 * BEFORE the persist layer is wired in. ~15-20 cas non-gated, <0.5s.
 *
 * Pattern mirror lib/recap/__tests__/step1-algorithm.test.ts and
 * complete-algorithm.test.ts: import-and-call, no mocks, no env vars,
 * deep-equality assertions on the returned decision shape.
 */

import { describe, expect, it } from 'vitest'

import type { SnapshotPayloadV1, SnapshotPayloadV2 } from '@/lib/recap-snapshot.types'
import { decideRecoveryActions } from '@/lib/recap-legacy/recover-algorithm'
import type {
  ProcessRecoveryDecision,
  ProcessRecoverySnapshot,
  RestorationAction,
} from '@/lib/recap-legacy/recover-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SNAPSHOT_ROW_ID = 'snap-row-1'
const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const BUDGET_ID = '22222222-2222-4222-8222-222222222222'
const TODAY_ISO = '2026-05-16'

/** Build a minimal V1 payload — arrays default to [], bank_balance to 0. */
function buildV1Payload(overrides: Partial<SnapshotPayloadV1> = {}): SnapshotPayloadV1 {
  return {
    snapshot_version: 1,
    context: 'profile',
    estimated_incomes: [],
    estimated_budgets: [],
    real_income_entries: [],
    real_expenses: [],
    bank_balance: 0,
    ...overrides,
  }
}

/** Build a minimal V2 payload — all arrays default to []. */
function buildV2Payload(overrides: Partial<SnapshotPayloadV2> = {}): SnapshotPayloadV2 {
  return {
    snapshot_version: 2,
    context: 'profile',
    created_at: '2026-05-16T12:00:00Z',
    profiles: [],
    estimated_incomes: [],
    estimated_budgets: [],
    real_income_entries: [],
    real_expenses: [],
    bank_balances: [],
    bank_balance: null,
    piggy_bank: [],
    remaining_to_live_snapshots: [],
    budget_transfers: [],
    monthly_recaps: [],
    _table_counts: {},
    ...overrides,
  }
}

function buildSnapshot(
  payload: SnapshotPayloadV1 | SnapshotPayloadV2,
  overrides: Partial<ProcessRecoverySnapshot> = {},
): ProcessRecoverySnapshot {
  return {
    snapshotRowId: SNAPSHOT_ROW_ID,
    snapshotCreatedAt: '2026-05-16T12:00:00Z',
    payload,
    ...overrides,
  }
}

/** Realistic fixture rows for each table (typed loosely to match unknown[]). */
function makeIncome(name = 'salary'): unknown {
  return { id: 'i-1', profile_id: PROFILE_ID, group_id: null, name, estimated_amount: 1000 }
}
function makeBudget(name = 'groceries'): unknown {
  return {
    id: BUDGET_ID,
    profile_id: PROFILE_ID,
    group_id: null,
    name,
    estimated_amount: 200,
  }
}
function makeRealIncomeEntry(amount = 1000): unknown {
  return {
    id: 'rie-1',
    profile_id: PROFILE_ID,
    group_id: null,
    amount,
    description: 'paycheck',
    entry_date: TODAY_ISO,
  }
}
function makeRealExpense(amount = 50): unknown {
  return {
    id: 'rex-1',
    profile_id: PROFILE_ID,
    group_id: null,
    amount,
    description: 'lunch',
    expense_date: TODAY_ISO,
    estimated_budget_id: BUDGET_ID,
    is_exceptional: false,
  }
}
function makeBankRow(balance = 500): unknown {
  return {
    id: 'bb-1',
    profile_id: PROFILE_ID,
    group_id: null,
    balance,
    current_remaining_to_live: 200,
  }
}
function makePiggyRow(amount = 42): unknown {
  return { id: 'pg-1', profile_id: PROFILE_ID, group_id: null, amount }
}
function makeTransfer(transferAmount = 25): unknown {
  return {
    id: 'bt-1',
    profile_id: PROFILE_ID,
    group_id: null,
    from_budget_id: null,
    to_budget_id: BUDGET_ID,
    transfer_amount: transferAmount,
    transfer_date: TODAY_ISO,
  }
}

// ---------------------------------------------------------------------------
// V2 dispatch cases
// ---------------------------------------------------------------------------

describe('decideRecoveryActions — V2 dispatch', () => {
  it('V2 full happy: 7 tables non-empty → 7 actions in FK-safe order', () => {
    const payload = buildV2Payload({
      estimated_incomes: [makeIncome()] as SnapshotPayloadV2['estimated_incomes'],
      estimated_budgets: [makeBudget()] as SnapshotPayloadV2['estimated_budgets'],
      real_income_entries: [makeRealIncomeEntry()] as SnapshotPayloadV2['real_income_entries'],
      real_expenses: [makeRealExpense()] as SnapshotPayloadV2['real_expenses'],
      bank_balances: [makeBankRow()] as SnapshotPayloadV2['bank_balances'],
      bank_balance: 500,
      piggy_bank: [makePiggyRow()] as SnapshotPayloadV2['piggy_bank'],
      budget_transfers: [makeTransfer()] as SnapshotPayloadV2['budget_transfers'],
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))

    expect(decision.snapshotRowId).toBe(SNAPSHOT_ROW_ID)
    expect(decision.actions).toHaveLength(7)
    expect(decision.actions.map((a) => (a.kind === 'restore_table' ? a.table : a.kind))).toEqual([
      'estimated_incomes',
      'estimated_budgets',
      'real_income_entries',
      'real_expenses',
      'bank_balances',
      'piggy_bank',
      'budget_transfers',
    ])
  })

  it('V2 bank dispatch: non-empty bank_balances → restore_table (full)', () => {
    const payload = buildV2Payload({
      estimated_incomes: [makeIncome()] as SnapshotPayloadV2['estimated_incomes'],
      estimated_budgets: [makeBudget()] as SnapshotPayloadV2['estimated_budgets'],
      bank_balances: [makeBankRow(777)] as SnapshotPayloadV2['bank_balances'],
      bank_balance: 999, // shadowed by non-empty bank_balances per route L233
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))

    const bankAction = decision.actions.find(
      (a): a is Extract<RestorationAction, { kind: 'restore_table' }> =>
        a.kind === 'restore_table' && a.table === 'bank_balances',
    )
    expect(bankAction).toBeDefined()
    expect(bankAction!.resultKey).toBe('bank_balance')
    expect(bankAction!.rows).toHaveLength(1)
    // Scalar fallback NOT used when array is non-empty
    expect(decision.actions.some((a) => a.kind === 'update_bank_balance_v1')).toBe(false)
  })

  it('V2 bank dispatch: bank_balances empty + scalar bank_balance:number → v1 fallback UPDATE', () => {
    const payload = buildV2Payload({
      estimated_incomes: [makeIncome()] as SnapshotPayloadV2['estimated_incomes'],
      estimated_budgets: [makeBudget()] as SnapshotPayloadV2['estimated_budgets'],
      bank_balances: [],
      bank_balance: 1234,
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))

    const fallback = decision.actions.find((a) => a.kind === 'update_bank_balance_v1')
    expect(fallback).toBeDefined()
    expect(fallback?.kind === 'update_bank_balance_v1' && fallback.amount).toBe(1234)
    // No restore_table for bank_balances
    expect(
      decision.actions.some((a) => a.kind === 'restore_table' && a.table === 'bank_balances'),
    ).toBe(false)
  })

  it('V2 bank dispatch: bank_balances empty + bank_balance null → SKIP entirely', () => {
    const payload = buildV2Payload({
      estimated_incomes: [makeIncome()] as SnapshotPayloadV2['estimated_incomes'],
      estimated_budgets: [makeBudget()] as SnapshotPayloadV2['estimated_budgets'],
      bank_balances: [],
      bank_balance: null,
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))

    // No bank action at all (init false will be preserved in persist)
    expect(decision.actions.some((a) => a.kind === 'update_bank_balance_v1')).toBe(false)
    expect(
      decision.actions.some((a) => a.kind === 'restore_table' && a.table === 'bank_balances'),
    ).toBe(false)
  })

  it('V2 piggy_bank empty → no piggy action', () => {
    const payload = buildV2Payload({
      estimated_incomes: [makeIncome()] as SnapshotPayloadV2['estimated_incomes'],
      piggy_bank: [],
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))
    expect(
      decision.actions.some((a) => a.kind === 'restore_table' && a.table === 'piggy_bank'),
    ).toBe(false)
  })

  it('V2 piggy_bank non-empty → piggy action with resultKey=piggy_bank', () => {
    const payload = buildV2Payload({
      estimated_incomes: [makeIncome()] as SnapshotPayloadV2['estimated_incomes'],
      piggy_bank: [makePiggyRow(123)] as SnapshotPayloadV2['piggy_bank'],
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))
    const piggy = decision.actions.find(
      (a): a is Extract<RestorationAction, { kind: 'restore_table' }> =>
        a.kind === 'restore_table' && a.table === 'piggy_bank',
    )
    expect(piggy).toBeDefined()
    expect(piggy!.resultKey).toBe('piggy_bank')
  })

  it('V2 budget_transfers non-empty → action with count resultKey', () => {
    const payload = buildV2Payload({
      estimated_incomes: [makeIncome()] as SnapshotPayloadV2['estimated_incomes'],
      estimated_budgets: [makeBudget()] as SnapshotPayloadV2['estimated_budgets'],
      budget_transfers: [
        makeTransfer(50),
        makeTransfer(75),
      ] as SnapshotPayloadV2['budget_transfers'],
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))
    const transfers = decision.actions.find(
      (a): a is Extract<RestorationAction, { kind: 'restore_table' }> =>
        a.kind === 'restore_table' && a.table === 'budget_transfers',
    )
    expect(transfers).toBeDefined()
    expect(transfers!.resultKey).toBe('budget_transfers')
    expect(transfers!.rows).toHaveLength(2)
  })

  it('V2 real_income_entries non-empty → resultKey IS real_incomes (NOT real_income_entries)', () => {
    // Pin the route L227-228 quirk: table name = real_income_entries but
    // result key = real_incomes (matches recoveryResults shape).
    const payload = buildV2Payload({
      real_income_entries: [makeRealIncomeEntry()] as SnapshotPayloadV2['real_income_entries'],
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))
    const incomes = decision.actions.find(
      (a): a is Extract<RestorationAction, { kind: 'restore_table' }> =>
        a.kind === 'restore_table' && a.table === 'real_income_entries',
    )
    expect(incomes).toBeDefined()
    expect(incomes!.resultKey).toBe('real_incomes')
  })
})

// ---------------------------------------------------------------------------
// V1 fallback cases
// ---------------------------------------------------------------------------

describe('decideRecoveryActions — V1 fallback', () => {
  it('V1 happy: 4 array tables non-empty + scalar bank → 5 actions (no piggy, no transfers)', () => {
    const payload = buildV1Payload({
      estimated_incomes: [makeIncome()] as SnapshotPayloadV1['estimated_incomes'],
      estimated_budgets: [makeBudget()] as SnapshotPayloadV1['estimated_budgets'],
      real_income_entries: [makeRealIncomeEntry()] as SnapshotPayloadV1['real_income_entries'],
      real_expenses: [makeRealExpense()] as SnapshotPayloadV1['real_expenses'],
      bank_balance: 1234,
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))

    expect(decision.actions).toHaveLength(5)
    expect(decision.actions.map((a) => (a.kind === 'restore_table' ? a.table : a.kind))).toEqual([
      'estimated_incomes',
      'estimated_budgets',
      'real_income_entries',
      'real_expenses',
      'update_bank_balance_v1',
    ])
  })

  it('V1 with all empty arrays + scalar bank → only bank update action', () => {
    const payload = buildV1Payload({ bank_balance: 50 })
    const decision = decideRecoveryActions(buildSnapshot(payload))
    expect(decision.actions).toHaveLength(1)
    expect(decision.actions[0]).toEqual({ kind: 'update_bank_balance_v1', amount: 50 })
  })

  it('V1 with bank_balance=0 → still produces update_bank_balance_v1 (0 is valid)', () => {
    // Pin route L236 check: `typeof snapshotData.bank_balance === 'number'`
    // — 0 is a number, must NOT be skipped.
    const payload = buildV1Payload({ bank_balance: 0 })
    const decision = decideRecoveryActions(buildSnapshot(payload))
    const fallback = decision.actions.find((a) => a.kind === 'update_bank_balance_v1')
    expect(fallback).toBeDefined()
    expect(fallback?.kind === 'update_bank_balance_v1' && fallback.amount).toBe(0)
  })

  it('V1 with snapshot_version undefined (legacy) → still treated as V1, no piggy/transfers', () => {
    // Mirror isSnapshotV2: returns true only when snapshot_version === 2.
    // undefined / absent → V1 fallback path.
    const payload: SnapshotPayloadV1 = {
      // snapshot_version intentionally absent
      estimated_incomes: [makeIncome()] as SnapshotPayloadV1['estimated_incomes'],
      estimated_budgets: [makeBudget()] as SnapshotPayloadV1['estimated_budgets'],
      real_income_entries: [],
      real_expenses: [],
      bank_balance: 100,
    }
    const decision = decideRecoveryActions(buildSnapshot(payload))
    // No piggy_bank action (V1 has no such field)
    expect(
      decision.actions.some((a) => a.kind === 'restore_table' && a.table === 'piggy_bank'),
    ).toBe(false)
    // No budget_transfers action
    expect(
      decision.actions.some((a) => a.kind === 'restore_table' && a.table === 'budget_transfers'),
    ).toBe(false)
    // 3 actions: incomes, budgets, bank update
    expect(decision.actions).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Edge cases — empty arrays + skip semantics
// ---------------------------------------------------------------------------

describe('decideRecoveryActions — edge cases', () => {
  it('all arrays empty + V1 with bank_balance=null-like → 0 actions', () => {
    // V1 declares `bank_balance: number` (non-nullable). To exercise the
    // "no bank action at all" branch, use V2 with both bank_balances=[]
    // and bank_balance=null.
    const payload = buildV2Payload({})
    const decision = decideRecoveryActions(buildSnapshot(payload))
    expect(decision.actions).toHaveLength(0)
    expect(decision.snapshotRowId).toBe(SNAPSHOT_ROW_ID)
  })

  it('only estimated_incomes non-empty → 1 action', () => {
    const payload = buildV2Payload({
      estimated_incomes: [makeIncome()] as SnapshotPayloadV2['estimated_incomes'],
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))
    expect(decision.actions).toHaveLength(1)
    expect(decision.actions[0]).toMatchObject({
      kind: 'restore_table',
      table: 'estimated_incomes',
      resultKey: 'estimated_incomes',
    })
  })

  it('multiple rows pass through verbatim (not deduped, not sorted by algorithm)', () => {
    const rows = [makeIncome('a'), makeIncome('b'), makeIncome('c')]
    const payload = buildV2Payload({
      estimated_incomes: rows as SnapshotPayloadV2['estimated_incomes'],
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))
    const action = decision.actions[0] as Extract<RestorationAction, { kind: 'restore_table' }>
    expect(action.rows).toHaveLength(3)
    expect(action.rows).toBe(rows) // same array reference (no copy by algorithm)
  })

  it('FK order pin: estimated_budgets always BEFORE budget_transfers when both present', () => {
    // Regression-guard: a future refactor reordering tables would violate
    // the FK budget_transfers.{from,to}_budget_id → estimated_budgets.id.
    const payload = buildV2Payload({
      estimated_budgets: [makeBudget()] as SnapshotPayloadV2['estimated_budgets'],
      budget_transfers: [makeTransfer()] as SnapshotPayloadV2['budget_transfers'],
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))
    const tableActions = decision.actions.filter(
      (a): a is Extract<RestorationAction, { kind: 'restore_table' }> => a.kind === 'restore_table',
    )
    const budgetIdx = tableActions.findIndex((a) => a.table === 'estimated_budgets')
    const transferIdx = tableActions.findIndex((a) => a.table === 'budget_transfers')
    expect(budgetIdx).toBeGreaterThanOrEqual(0)
    expect(transferIdx).toBeGreaterThanOrEqual(0)
    expect(budgetIdx).toBeLessThan(transferIdx)
  })

  it('FK order pin: estimated_budgets always BEFORE real_expenses when both present', () => {
    // Regression-guard: real_expenses.estimated_budget_id → estimated_budgets.id.
    const payload = buildV2Payload({
      estimated_budgets: [makeBudget()] as SnapshotPayloadV2['estimated_budgets'],
      real_expenses: [makeRealExpense()] as SnapshotPayloadV2['real_expenses'],
    })
    const decision = decideRecoveryActions(buildSnapshot(payload))
    const tableActions = decision.actions.filter(
      (a): a is Extract<RestorationAction, { kind: 'restore_table' }> => a.kind === 'restore_table',
    )
    const budgetIdx = tableActions.findIndex((a) => a.table === 'estimated_budgets')
    const expensesIdx = tableActions.findIndex((a) => a.table === 'real_expenses')
    expect(budgetIdx).toBeLessThan(expensesIdx)
  })
})

// ---------------------------------------------------------------------------
// Determinism + no-mutation
// ---------------------------------------------------------------------------

describe('decideRecoveryActions — determinism', () => {
  it('same snapshot → same decision (deep-equal)', () => {
    const payload = buildV2Payload({
      estimated_incomes: [makeIncome()] as SnapshotPayloadV2['estimated_incomes'],
      estimated_budgets: [makeBudget()] as SnapshotPayloadV2['estimated_budgets'],
      bank_balances: [makeBankRow()] as SnapshotPayloadV2['bank_balances'],
      piggy_bank: [makePiggyRow()] as SnapshotPayloadV2['piggy_bank'],
    })
    const snap = buildSnapshot(payload)
    const a = decideRecoveryActions(snap)
    const b = decideRecoveryActions(snap)
    expect(a).toEqual(b)
  })

  it('does NOT mutate the input snapshot', () => {
    const rows = [makeIncome('original')]
    const payload = buildV2Payload({
      estimated_incomes: rows as SnapshotPayloadV2['estimated_incomes'],
    })
    const snap = buildSnapshot(payload)
    const snapBefore: ProcessRecoverySnapshot = JSON.parse(JSON.stringify(snap))
    decideRecoveryActions(snap)
    expect(snap).toEqual(snapBefore)
  })

  it('returns a fresh decision object each call (no shared reference)', () => {
    const payload = buildV2Payload({
      estimated_incomes: [makeIncome()] as SnapshotPayloadV2['estimated_incomes'],
    })
    const a = decideRecoveryActions(buildSnapshot(payload))
    const b = decideRecoveryActions(buildSnapshot(payload))
    expect(a).not.toBe(b)
    expect(a.actions).not.toBe(b.actions)
  })

  it('decision shape matches ProcessRecoveryDecision contract', () => {
    const decision: ProcessRecoveryDecision = decideRecoveryActions(buildSnapshot(buildV2Payload()))
    // Required fields present
    expect(Array.isArray(decision.actions)).toBe(true)
    expect(typeof decision.snapshotRowId).toBe('string')
  })
})
