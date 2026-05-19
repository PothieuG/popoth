/**
 * Mocked unit tests for `applyDecision` — Sprint Refactor-I5-followup-v2.
 *
 * Pins the orchestration contract that the gated caract tests can't easily
 * cover: the per-step RPC dispatch, fail-soft semantics on 2.4.2, throw
 * propagation on 2.2, and the new atomic transferWithSavingsDebit wiring.
 *
 * Mock strategy mirrors lib/finance/__tests__/snapshots.test.ts —
 * `vi.mock` hoisted with a `__mocks` registry on the supabaseServer mock,
 * dynamic `await import` of the SUT inside test bodies so the mocks are
 * installed before module load.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AllocationOperation,
  BudgetAnalysis,
  ProcessStep1Decision,
  ProcessStep1Input,
  ProcessStep1Snapshot,
} from '@/lib/recap/types'

// Hoisted mocks
//
// Sprint Refactor-Test-Coverage (2026-05-12) — extended the chain shape to
// support `loadSnapshot`:
// - `.select` / `.eq` / `.not` / `.match` return the chain (chainable)
// - `.single` is a vi.fn used by `from('piggy_bank').select(...).eq(...).single()`
// - chain is thenable via `.then` — enables `await chain` (no terminal) for
//   the budgets + expenses listing SELECTs at lines 127-138 of step1-persist.ts.
//   Pops responses from the `arrayAwait` queue.
// - `.insert` remains a plain vi.fn(async () => ({error: null})) so existing
//   `applyDecision` tests (which queue insert results via mockResolvedValueOnce)
//   work unchanged.
vi.mock('@/lib/supabase-server', () => {
  const insert = vi.fn(async () => ({ error: null }))
  const single = vi.fn(async () => ({ data: null, error: null }))
  const arrayAwait = vi.fn(async () => ({ data: [], error: null }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chain is intentionally thenable + chainable
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.not = vi.fn(() => chain)
  chain.match = vi.fn(() => chain)
  chain.single = single
  // Sprint Fix-Empty-Recap-Tirelire (2026-05-19): step1-persist loadSnapshot
  // switched from .single() to .maybeSingle() so brand-new users without a
  // piggy_bank row don't crash with PGRST116. Same mock fn drives both for
  // back-compat with existing mockResolvedValueOnce calls.
  chain.maybeSingle = single
  chain.insert = insert
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary onResolve/onReject signatures
  chain.then = (onResolve: any, onReject: any) => arrayAwait().then(onResolve, onReject)

  const from = vi.fn(() => chain)
  return {
    supabaseServer: { from },
    __mocks: { insert, from, single, arrayAwait },
  }
})

vi.mock('@/lib/finance/financial-data', () => ({
  getProfileFinancialData: vi.fn(async () => ({
    availableBalance: 100,
    remainingToLive: 200,
    totalSavings: 0,
    totalEstimatedIncome: 1000,
    totalEstimatedBudgets: 800,
    totalRealIncome: 900,
    totalRealExpenses: 700,
  })),
  getGroupFinancialData: vi.fn(async () => ({
    availableBalance: 500,
    remainingToLive: 1500,
    totalSavings: 300,
    totalEstimatedIncome: 5000,
    totalEstimatedBudgets: 3500,
    totalRealIncome: 4800,
    totalRealExpenses: 3200,
  })),
}))

vi.mock('@/lib/finance/budget-transfers', () => ({
  transferWithSavingsDebit: vi.fn(async () => ({
    transfer_id: 'mock-transfer-id',
    cumulated_savings: 0,
  })),
}))

vi.mock('@/lib/finance/budget-savings', () => ({
  updateBudgetCumulatedSavings: vi.fn(async () => 0),
}))

vi.mock('@/lib/finance/piggy-bank', () => ({
  updatePiggyBank: vi.fn(async () => 0),
  ensurePiggyBankRow: vi.fn(async () => undefined),
}))

beforeEach(() => {
  // logger.warn / logger.error go through console under the hood (lib/logger.ts);
  // silence them per the existing snapshots.test.ts pattern.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// Helpers --------------------------------------------------------------------

function buildInput(overrides: Partial<ProcessStep1Input> = {}): ProcessStep1Input {
  return {
    userId: 'user-1',
    context: 'profile',
    contextId: 'profile-1',
    ownerField: 'profile_id',
    ...overrides,
  }
}

function buildBudget(overrides: Partial<BudgetAnalysis> = {}): BudgetAnalysis {
  return {
    id: 'b-1',
    name: 'Budget 1',
    estimated_amount: 100,
    spent_amount: 80,
    surplus: 20,
    deficit: 0,
    cumulated_savings: 0,
    ...overrides,
  }
}

function buildSnapshot(overrides: Partial<ProcessStep1Snapshot> = {}): ProcessStep1Snapshot {
  return {
    context: 'profile',
    contextId: 'profile-1',
    ownerField: 'profile_id',
    piggyBank: 1000,
    ravActuel: 500,
    ravBudgetaire: 400,
    difference: 100,
    budgetAnalyses: [buildBudget()],
    ...overrides,
  }
}

// Tests ----------------------------------------------------------------------

describe('applyDecision — CAS 1 (excédent)', () => {
  it('1.1 piggy push fires updatePiggyBank with the excedent amount and no other RPCs', async () => {
    const piggyMod = (await import('@/lib/finance/piggy-bank')) as unknown as {
      updatePiggyBank: ReturnType<typeof vi.fn>
      ensurePiggyBankRow: ReturnType<typeof vi.fn>
    }
    const transferMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    const savingsMod = (await import('@/lib/finance/budget-savings')) as unknown as {
      updateBudgetCumulatedSavings: ReturnType<typeof vi.fn>
    }
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> }
    }
    const { applyDecision } = await import('@/lib/recap/step1-persist')

    const op: AllocationOperation = {
      step: '1.1',
      type: 'excedent_to_piggy_bank',
      details: { excedent_amount: 100, old_piggy_bank: 1000, new_piggy_bank: 1100 },
    }
    const decision: ProcessStep1Decision = {
      case: 'excedent',
      operations: [op],
      newPiggyBank: 1100,
      newBudgetSavings: {},
      budgetsWithDeficitRefloated: [],
      secondPassRefloatOps: [],
    }

    const output = await applyDecision(buildInput(), buildSnapshot(), decision)

    expect(piggyMod.updatePiggyBank).toHaveBeenCalledTimes(1)
    expect(piggyMod.updatePiggyBank).toHaveBeenCalledWith({ profile_id: 'profile-1' }, 100)
    // ensurePiggyBankRow must fire BEFORE updatePiggyBank (regression guard
    // for Sprint Fix-Empty-Recap-Tirelire — first-time users have no row).
    expect(piggyMod.ensurePiggyBankRow).toHaveBeenCalledTimes(1)
    expect(piggyMod.ensurePiggyBankRow).toHaveBeenCalledWith({ profile_id: 'profile-1' })
    const ensureOrder = piggyMod.ensurePiggyBankRow.mock.invocationCallOrder[0]
    const updateOrder = piggyMod.updatePiggyBank.mock.invocationCallOrder[0]
    if (ensureOrder === undefined || updateOrder === undefined) {
      throw new Error('invocationCallOrder missing — mocks not called as expected')
    }
    expect(ensureOrder).toBeLessThan(updateOrder)
    expect(transferMod.transferWithSavingsDebit).not.toHaveBeenCalled()
    expect(savingsMod.updateBudgetCumulatedSavings).not.toHaveBeenCalled()
    expect(supabaseMock.__mocks.insert).not.toHaveBeenCalled()

    expect(output.success).toBe(true)
    expect(output.case).toBe('excedent')
    expect(output.operations_performed).toHaveLength(1)
  })

  it('CAS 1 with zero operations performs no RPC calls', async () => {
    const piggyMod = (await import('@/lib/finance/piggy-bank')) as unknown as {
      updatePiggyBank: ReturnType<typeof vi.fn>
    }
    const transferMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn> }
    }
    const { applyDecision } = await import('@/lib/recap/step1-persist')

    const decision: ProcessStep1Decision = {
      case: 'excedent',
      operations: [],
      newPiggyBank: 1000,
      newBudgetSavings: {},
      budgetsWithDeficitRefloated: [],
      secondPassRefloatOps: [],
    }

    const output = await applyDecision(buildInput(), buildSnapshot({ difference: 0 }), decision)

    expect(piggyMod.updatePiggyBank).not.toHaveBeenCalled()
    expect(transferMod.transferWithSavingsDebit).not.toHaveBeenCalled()
    expect(supabaseMock.__mocks.insert).not.toHaveBeenCalled()
    expect(output.case).toBe('excedent')
    expect(output.operations_performed).toHaveLength(0)
  })
})

describe('applyDecision — CAS 2 (déficit)', () => {
  it('2.4.2 happy path: transferWithSavingsDebit called once per op, no direct INSERT', async () => {
    const transferMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> }
    }
    const { applyDecision } = await import('@/lib/recap/step1-persist')

    const decision: ProcessStep1Decision = {
      case: 'deficit',
      operations: [],
      newPiggyBank: 1000,
      newBudgetSavings: {},
      budgetsWithDeficitRefloated: [],
      gapResiduel: 0,
      isFullyBalanced: true,
      secondPassRefloatOps: [
        {
          fromBudgetId: 'from-1',
          fromBudgetName: 'From 1',
          toBudgetId: 'to-1',
          toBudgetName: 'To 1',
          amount: 30,
          oldSavings: 100,
          newSavings: 70,
        },
        {
          fromBudgetId: 'from-2',
          fromBudgetName: 'From 2',
          toBudgetId: 'to-2',
          toBudgetName: 'To 2',
          amount: 50,
          oldSavings: 200,
          newSavings: 150,
        },
      ],
    }

    const output = await applyDecision(buildInput(), buildSnapshot(), decision)

    expect(transferMod.transferWithSavingsDebit).toHaveBeenCalledTimes(2)
    expect(transferMod.transferWithSavingsDebit).toHaveBeenNthCalledWith(
      1,
      { profile_id: 'profile-1' },
      { fromBudgetId: 'from-1', toBudgetId: 'to-1', amount: 30 },
    )
    expect(transferMod.transferWithSavingsDebit).toHaveBeenNthCalledWith(
      2,
      { profile_id: 'profile-1' },
      { fromBudgetId: 'from-2', toBudgetId: 'to-2', amount: 50 },
    )
    // The 2.4.2 path must NOT call supabaseServer.from('budget_transfers').insert
    // (the atomic helper owns the INSERT). The 2.3.1 path can, but our
    // decision has no 2.3.1 ops here.
    expect(supabaseMock.__mocks.insert).not.toHaveBeenCalled()
    expect(output.operations_performed).toHaveLength(2)
    expect(output.operations_performed[0]?.step).toBe('2.4.2.2')
  })

  it('2.4.2 fail-soft: a throwing op does not stop the next op (logger.warn + continue)', async () => {
    const transferMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    transferMod.transferWithSavingsDebit.mockImplementationOnce(async () => ({
      transfer_id: 'ok-1',
      cumulated_savings: 70,
    }))
    transferMod.transferWithSavingsDebit.mockImplementationOnce(async () => {
      throw new Error('simulated RPC failure')
    })
    transferMod.transferWithSavingsDebit.mockImplementationOnce(async () => ({
      transfer_id: 'ok-3',
      cumulated_savings: 40,
    }))

    const { applyDecision } = await import('@/lib/recap/step1-persist')

    const decision: ProcessStep1Decision = {
      case: 'deficit',
      operations: [],
      newPiggyBank: 1000,
      newBudgetSavings: {},
      budgetsWithDeficitRefloated: [],
      gapResiduel: 0,
      isFullyBalanced: true,
      secondPassRefloatOps: [
        {
          fromBudgetId: 'from-1',
          fromBudgetName: 'F1',
          toBudgetId: 'to-1',
          toBudgetName: 'T1',
          amount: 10,
          oldSavings: 80,
          newSavings: 70,
        },
        {
          fromBudgetId: 'from-2',
          fromBudgetName: 'F2',
          toBudgetId: 'to-2',
          toBudgetName: 'T2',
          amount: 20,
          oldSavings: 200,
          newSavings: 180,
        },
        {
          fromBudgetId: 'from-3',
          fromBudgetName: 'F3',
          toBudgetId: 'to-3',
          toBudgetName: 'T3',
          amount: 30,
          oldSavings: 70,
          newSavings: 40,
        },
      ],
    }

    const output = await applyDecision(buildInput(), buildSnapshot(), decision)

    // All three ops should have been attempted (fail-soft preserves order)
    expect(transferMod.transferWithSavingsDebit).toHaveBeenCalledTimes(3)
    // Only the two successful ones land in operations_performed
    expect(output.operations_performed).toHaveLength(2)
    expect(output.operations_performed.every((op) => op.step === '2.4.2.2')).toBe(true)
    const recordedAmounts = output.operations_performed
      .filter((op) => op.step === '2.4.2.2')
      .map((op) => (op.type === 'refloat_from_savings' ? op.details.amount : -1))
    expect(recordedAmounts).toEqual([10, 30])
  })

  it('2.2 RPC throw propagates (not fail-soft — algorithm invariant violation)', async () => {
    const savingsMod = (await import('@/lib/finance/budget-savings')) as unknown as {
      updateBudgetCumulatedSavings: ReturnType<typeof vi.fn>
    }
    savingsMod.updateBudgetCumulatedSavings.mockRejectedValueOnce(
      new Error('cumulated_savings cannot become negative'),
    )

    const { applyDecision } = await import('@/lib/recap/step1-persist')

    const decision: ProcessStep1Decision = {
      case: 'deficit',
      operations: [
        {
          step: '2.2',
          type: 'use_savings',
          details: {
            budget_id: 'b-1',
            budget_name: 'Budget 1',
            amount_used: 50,
            proportion: 1,
            old_savings: 30,
            new_savings: -20,
          },
        },
      ],
      newPiggyBank: 1000,
      newBudgetSavings: { 'b-1': -20 },
      budgetsWithDeficitRefloated: [],
      gapResiduel: 100,
      isFullyBalanced: false,
      secondPassRefloatOps: [],
    }

    await expect(applyDecision(buildInput(), buildSnapshot(), decision)).rejects.toThrow(
      /Erreur mise à jour économies/,
    )
  })

  it('2.3.1 INSERT fail-soft: a failing INSERT does not skip subsequent ops', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> }
    }
    // First INSERT errors out, second succeeds
    supabaseMock.__mocks.insert
      .mockResolvedValueOnce({ error: { message: 'simulated FK violation' } })
      .mockResolvedValueOnce({ error: null })

    const { applyDecision } = await import('@/lib/recap/step1-persist')

    const decision: ProcessStep1Decision = {
      case: 'deficit',
      operations: [
        {
          step: '2.3.1',
          type: 'transfer_to_deficit',
          details: {
            budget_id: 'b-1',
            budget_name: 'Deficit 1',
            transfer_amount: 50,
            deficit_remaining: 0,
          },
        },
        {
          step: '2.3.1',
          type: 'transfer_to_deficit',
          details: {
            budget_id: 'b-2',
            budget_name: 'Deficit 2',
            transfer_amount: 25,
            deficit_remaining: 10,
          },
        },
      ],
      newPiggyBank: 1000,
      newBudgetSavings: {},
      budgetsWithDeficitRefloated: [],
      gapResiduel: 10,
      isFullyBalanced: false,
      secondPassRefloatOps: [],
    }

    const output = await applyDecision(buildInput(), buildSnapshot(), decision)

    expect(supabaseMock.__mocks.insert).toHaveBeenCalledTimes(2)
    // Only the second op (which succeeded) lands in operations_performed
    expect(output.operations_performed).toHaveLength(1)
    expect(output.operations_performed[0]?.step).toBe('2.3.1')
    if (output.operations_performed[0]?.step === '2.3.1') {
      expect(output.operations_performed[0].details.budget_id).toBe('b-2')
    }
  })

  it('isFullyBalanced=true with empty secondPassRefloatOps performs 0 transfer calls', async () => {
    const transferMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn> }
    }
    const { applyDecision } = await import('@/lib/recap/step1-persist')

    const decision: ProcessStep1Decision = {
      case: 'deficit',
      operations: [],
      newPiggyBank: 1000,
      newBudgetSavings: {},
      budgetsWithDeficitRefloated: [],
      gapResiduel: 0,
      isFullyBalanced: true,
      secondPassRefloatOps: [],
    }

    const output = await applyDecision(buildInput(), buildSnapshot(), decision)

    expect(transferMod.transferWithSavingsDebit).not.toHaveBeenCalled()
    expect(supabaseMock.__mocks.insert).not.toHaveBeenCalled()
    expect(output.operations_performed).toHaveLength(0)
    expect(output.is_fully_balanced).toBe(true)
  })

  it('isFullyBalanced=false skips the 2.4.1 + 2.4.2 paths entirely', async () => {
    const piggyMod = (await import('@/lib/finance/piggy-bank')) as unknown as {
      updatePiggyBank: ReturnType<typeof vi.fn>
    }
    const transferMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    const { applyDecision } = await import('@/lib/recap/step1-persist')

    const decision: ProcessStep1Decision = {
      case: 'deficit',
      operations: [],
      newPiggyBank: 1000,
      newBudgetSavings: {},
      budgetsWithDeficitRefloated: [],
      gapResiduel: 50,
      isFullyBalanced: false,
      // Even with non-empty secondPassRefloatOps, the persist layer must not
      // apply them when isFullyBalanced is false — regression guard against
      // future re-routing.
      secondPassRefloatOps: [
        {
          fromBudgetId: 'from-x',
          fromBudgetName: 'X',
          toBudgetId: 'to-x',
          toBudgetName: 'Y',
          amount: 10,
          oldSavings: 50,
          newSavings: 40,
        },
      ],
    }

    const output = await applyDecision(buildInput(), buildSnapshot(), decision)

    expect(piggyMod.updatePiggyBank).not.toHaveBeenCalled()
    expect(transferMod.transferWithSavingsDebit).not.toHaveBeenCalled()
    expect(output.is_fully_balanced).toBe(false)
  })
})

// loadSnapshot tests --------------------------------------------------------
//
// Sprint Refactor-Test-Coverage (2026-05-12) — extends the file with direct
// coverage of `loadSnapshot`. Previously exercised only indirectly through
// the 8 applyDecision cases above. Each SELECT failure path is pinned with
// an assertion on the thrown error message containing the table name.

describe('loadSnapshot', () => {
  it('happy path: 3 SELECTs + financial-data all succeed → snapshot shape complete', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        single: ReturnType<typeof vi.fn>
        arrayAwait: ReturnType<typeof vi.fn>
      }
    }
    // 1st await chain → estimated_budgets list (2 budgets)
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [
        { id: 'b-1', name: 'Budget 1', estimated_amount: 200, cumulated_savings: 0 },
        { id: 'b-2', name: 'Budget 2', estimated_amount: 100, cumulated_savings: 20 },
      ],
      error: null,
    })
    // 2nd await chain → real_expenses list (one expense linked to b-1)
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [{ id: 'rx-1', estimated_budget_id: 'b-1', amount: 50 }],
      error: null,
    })
    // single() → piggy_bank
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: { amount: 1000 },
      error: null,
    })

    const { loadSnapshot } = await import('@/lib/recap/step1-persist')
    const snapshot = await loadSnapshot(buildInput())

    // From the mocked getProfileFinancialData (top of file):
    //   ravActuel = remainingToLive = 200
    //   ravBudgetaire = totalEstimatedIncome - totalEstimatedBudgets = 1000 - 800 = 200
    //   difference = 0
    expect(snapshot.context).toBe('profile')
    expect(snapshot.contextId).toBe('profile-1')
    expect(snapshot.ownerField).toBe('profile_id')
    expect(snapshot.piggyBank).toBe(1000)
    expect(snapshot.ravActuel).toBe(200)
    expect(snapshot.ravBudgetaire).toBe(200)
    expect(snapshot.difference).toBe(0)
    expect(snapshot.budgetAnalyses).toHaveLength(2)
    // Budget 1: estimated=200, spent=50 (from rx-1) → surplus=150, deficit=0
    expect(snapshot.budgetAnalyses[0]).toMatchObject({
      id: 'b-1',
      name: 'Budget 1',
      estimated_amount: 200,
      spent_amount: 50,
      surplus: 150,
      deficit: 0,
      cumulated_savings: 0,
    })
    // Budget 2: estimated=100, spent=0 → surplus=100, deficit=0
    expect(snapshot.budgetAnalyses[1]).toMatchObject({
      id: 'b-2',
      name: 'Budget 2',
      estimated_amount: 100,
      spent_amount: 0,
      surplus: 100,
      deficit: 0,
      cumulated_savings: 20,
    })
  })

  it('estimated_budgets SELECT fails → throws "Erreur récupération budgets"', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { arrayAwait: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated estimated_budgets failure' },
    })

    const { loadSnapshot } = await import('@/lib/recap/step1-persist')

    await expect(loadSnapshot(buildInput())).rejects.toThrow(/Erreur récupération budgets/)
  })

  it('real_expenses SELECT fails → throws "Erreur récupération dépenses"', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { arrayAwait: ReturnType<typeof vi.fn> }
    }
    // budgets OK
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    // real_expenses fails
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated real_expenses failure' },
    })

    const { loadSnapshot } = await import('@/lib/recap/step1-persist')

    await expect(loadSnapshot(buildInput())).rejects.toThrow(/Erreur récupération dépenses/)
  })

  it('piggy_bank row absent (maybeSingle returns null/null) → piggyBank defaults to 0, no throw', async () => {
    // Regression guard for Sprint Fix-Empty-Recap-Tirelire (2026-05-19).
    // A brand-new user without an accumulated piggy yet has 0 rows in the
    // piggy_bank table. Pre-fix, loadSnapshot used `.single()` which raises
    // PGRST116 "Cannot coerce the result to a single JSON object" and blocked
    // the entire monthly recap at Step 1. Post-fix, `.maybeSingle()` returns
    // { data: null, error: null } and the snapshot reports piggyBank = 0.
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        single: ReturnType<typeof vi.fn>
        arrayAwait: ReturnType<typeof vi.fn>
      }
    }
    // budgets + expenses OK
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    // piggy_bank maybeSingle() returns null/null (no row exists)
    supabaseMock.__mocks.single.mockResolvedValueOnce({ data: null, error: null })

    const { loadSnapshot } = await import('@/lib/recap/step1-persist')
    const snapshot = await loadSnapshot(buildInput())

    expect(snapshot.piggyBank).toBe(0)
    expect(snapshot.budgetAnalyses).toEqual([])
  })

  it('piggy_bank SELECT fails → throws "Erreur récupération tirelire"', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        single: ReturnType<typeof vi.fn>
        arrayAwait: ReturnType<typeof vi.fn>
      }
    }
    // budgets + expenses OK
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    // piggy_bank single() fails
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated piggy_bank failure' },
    })

    const { loadSnapshot } = await import('@/lib/recap/step1-persist')

    await expect(loadSnapshot(buildInput())).rejects.toThrow(/Erreur récupération tirelire/)
  })
})
