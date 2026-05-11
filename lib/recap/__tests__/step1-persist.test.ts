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
vi.mock('@/lib/supabase-server', () => {
  const insert = vi.fn(async () => ({ error: null }))
  const from = vi.fn(() => ({ insert }))
  return {
    supabaseServer: { from },
    __mocks: { insert, from },
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
    expect(
      output.operations_performed.every((op) => op.step === '2.4.2.2'),
    ).toBe(true)
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
