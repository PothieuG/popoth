/**
 * Mocked unit tests for `applyAutoBalanceDecision` + `loadAutoBalanceSnapshot` +
 * `processAutoBalance` — Sprint Refactor-Auto-Balance Commit 6.
 *
 * Pattern mirror lib/recap/__tests__/step1-persist.test.ts — vi.mock hoisted +
 * `__mocks` registry + dynamic `await import` of the SUT in test bodies so the
 * mocks are installed before module load.
 *
 * 18 cases non-gated (~1s):
 *   - applyAutoBalanceDecision happy (4): PHASE 0 only / PHASE 1 only /
 *     PHASE 2 only / mixed all 3 phases
 *   - applyAutoBalanceDecision fail-soft (3): savings mid-flight throw /
 *     piggy mid-flight throw / surplus batched INSERT failure (hard error)
 *   - loadAutoBalanceSnapshot (7): happy path, empty budgets → RecapNoBudgetsError,
 *     3 SELECT failure paths, piggy maybeSingle error (fail-soft), piggy null
 *     data (fail-soft)
 *   - processAutoBalance orchestration (3): happy / no_deficit early /
 *     no_resources early
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AutoBalanceTransfer,
  BudgetAnalysis,
  ProcessAutoBalanceDecision,
  ProcessAutoBalanceInput,
} from '@/lib/recap/auto-balance-types'

// Hoisted mocks ------------------------------------------------------------

vi.mock('@/lib/supabase-server', () => {
  const insert = vi.fn(async () => ({ error: null }))
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  const arrayAwait = vi.fn(async () => ({ data: [], error: null }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chain is intentionally thenable + chainable
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.not = vi.fn(() => chain)
  chain.maybeSingle = maybeSingle
  chain.insert = insert
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary onResolve/onReject signatures
  chain.then = (onResolve: any, onReject: any) => arrayAwait().then(onResolve, onReject)

  const from = vi.fn(() => chain)
  return {
    supabaseServer: { from },
    __mocks: { insert, from, maybeSingle, arrayAwait },
  }
})

vi.mock('@/lib/finance/budget-transfers', () => ({
  transferWithSavingsDebit: vi.fn(async () => ({
    transfer_id: 'mock-transfer-id',
    cumulated_savings: 0,
  })),
}))

vi.mock('@/lib/finance/piggy-bank', () => ({
  transferPiggyToBudgetWithInsert: vi.fn(async () => ({
    transfer_id: 'mock-piggy-transfer-id',
    piggy_bank_amount: 0,
  })),
}))

beforeEach(() => {
  // logger.warn / logger.error / logger.info go through console.* under the hood
  // (lib/logger.ts); silence them per the existing snapshots.test.ts pattern.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// Helpers ------------------------------------------------------------------

function buildInput(
  overrides: Partial<ProcessAutoBalanceInput> = {},
): ProcessAutoBalanceInput {
  return {
    userId: 'user-1',
    context: 'profile',
    contextId: 'profile-1',
    ownerField: 'profile_id',
    ...overrides,
  }
}

function buildPiggyTransfer(overrides: Partial<AutoBalanceTransfer> = {}): AutoBalanceTransfer {
  return {
    from_budget_id: null,
    from_budget_name: 'Tirelire 🐷',
    to_budget_id: 'b-1',
    to_budget_name: 'Budget 1',
    amount: 50,
    source: 'piggy_bank',
    ...overrides,
  }
}

function buildSavingsTransfer(
  overrides: Partial<AutoBalanceTransfer> = {},
): AutoBalanceTransfer {
  return {
    from_budget_id: 'b-from',
    from_budget_name: 'From',
    to_budget_id: 'b-to',
    to_budget_name: 'To',
    amount: 100,
    source: 'savings',
    ...overrides,
  }
}

function buildSurplusTransfer(
  overrides: Partial<AutoBalanceTransfer> = {},
): AutoBalanceTransfer {
  return {
    from_budget_id: 'b-from',
    from_budget_name: 'From',
    to_budget_id: 'b-to',
    to_budget_name: 'To',
    amount: 150,
    source: 'surplus',
    ...overrides,
  }
}

function buildDecision(
  overrides: Partial<ProcessAutoBalanceDecision> = {},
): ProcessAutoBalanceDecision {
  return {
    transfers: [],
    totalPiggyBankUsed: 0,
    totalSavingsUsed: 0,
    totalSurplusUsed: 0,
    totalPiggyBank: 0,
    totalSavings: 0,
    totalSurplus: 0,
    totalDeficit: 0,
    operations: [],
    ...overrides,
  }
}

// Tests --------------------------------------------------------------------

describe('applyAutoBalanceDecision — happy paths', () => {
  it('PHASE 0 only: 1 piggy transfer → transferPiggyToBudgetWithInsert called once, no savings/surplus', async () => {
    const piggyMod = (await import('@/lib/finance/piggy-bank')) as unknown as {
      transferPiggyToBudgetWithInsert: ReturnType<typeof vi.fn>
    }
    const savingsMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn> }
    }
    const { applyAutoBalanceDecision } = await import('@/lib/recap/auto-balance-persist')

    const decision = buildDecision({
      transfers: [buildPiggyTransfer({ amount: 100 })],
      totalPiggyBankUsed: 100,
      totalPiggyBank: 200,
      totalDeficit: 100,
    })

    const output = await applyAutoBalanceDecision(buildInput(), decision)

    expect(piggyMod.transferPiggyToBudgetWithInsert).toHaveBeenCalledTimes(1)
    expect(piggyMod.transferPiggyToBudgetWithInsert).toHaveBeenCalledWith(
      { profile_id: 'profile-1' },
      expect.objectContaining({ toBudgetId: 'b-1', amount: 100 }),
    )
    expect(savingsMod.transferWithSavingsDebit).not.toHaveBeenCalled()
    expect(supabaseMock.__mocks.insert).not.toHaveBeenCalled()

    expect('success' in output && output.success).toBe(true)
    if ('success' in output) {
      expect(output.piggy_bank_used).toBe(100)
      expect(output.savings_used).toBe(0)
      expect(output.surplus_used).toBe(0)
      expect(output.transfers_count).toBe(1)
      expect(output.remaining_piggy_bank).toBe(100)
      expect(output.remaining_deficit).toBe(0)
    }
  })

  it('PHASE 1 only: 1 savings transfer → transferWithSavingsDebit called once, no piggy/surplus INSERT', async () => {
    const piggyMod = (await import('@/lib/finance/piggy-bank')) as unknown as {
      transferPiggyToBudgetWithInsert: ReturnType<typeof vi.fn>
    }
    const savingsMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn> }
    }
    const { applyAutoBalanceDecision } = await import('@/lib/recap/auto-balance-persist')

    const decision = buildDecision({
      transfers: [
        buildSavingsTransfer({
          from_budget_id: 'b-from',
          to_budget_id: 'b-to',
          amount: 150,
        }),
      ],
      totalSavingsUsed: 150,
      totalSavings: 150,
      totalDeficit: 150,
    })

    const output = await applyAutoBalanceDecision(buildInput(), decision)

    expect(savingsMod.transferWithSavingsDebit).toHaveBeenCalledTimes(1)
    expect(savingsMod.transferWithSavingsDebit).toHaveBeenCalledWith(
      { profile_id: 'profile-1' },
      expect.objectContaining({
        fromBudgetId: 'b-from',
        toBudgetId: 'b-to',
        amount: 150,
      }),
    )
    expect(piggyMod.transferPiggyToBudgetWithInsert).not.toHaveBeenCalled()
    expect(supabaseMock.__mocks.insert).not.toHaveBeenCalled()

    if ('success' in output) {
      expect(output.savings_used).toBe(150)
      expect(output.remaining_savings).toBe(0)
    }
  })

  it('PHASE 2 only: 2 surplus transfers → 1 batched INSERT call with 2 rows, no debit', async () => {
    const piggyMod = (await import('@/lib/finance/piggy-bank')) as unknown as {
      transferPiggyToBudgetWithInsert: ReturnType<typeof vi.fn>
    }
    const savingsMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> }
    }
    const { applyAutoBalanceDecision } = await import('@/lib/recap/auto-balance-persist')

    const decision = buildDecision({
      transfers: [
        buildSurplusTransfer({ from_budget_id: 'b-1', to_budget_id: 'b-c', amount: 75 }),
        buildSurplusTransfer({ from_budget_id: 'b-2', to_budget_id: 'b-c', amount: 25 }),
      ],
      totalSurplusUsed: 100,
      totalSurplus: 200,
      totalDeficit: 100,
    })

    const output = await applyAutoBalanceDecision(buildInput(), decision)

    expect(piggyMod.transferPiggyToBudgetWithInsert).not.toHaveBeenCalled()
    expect(savingsMod.transferWithSavingsDebit).not.toHaveBeenCalled()
    expect(supabaseMock.__mocks.insert).toHaveBeenCalledTimes(1)
    // Verify the batched INSERT payload includes both transfers
    const insertArg = supabaseMock.__mocks.insert.mock.calls[0]?.[0] as unknown[]
    expect(insertArg).toHaveLength(2)

    if ('success' in output) {
      expect(output.surplus_used).toBe(100)
      expect(output.transfers_count).toBe(2)
    }
  })

  it('mixed all 3 phases: 1 piggy + 1 savings + 1 surplus → 1 piggy RPC + 1 savings RPC + 1 INSERT (surplus only)', async () => {
    const piggyMod = (await import('@/lib/finance/piggy-bank')) as unknown as {
      transferPiggyToBudgetWithInsert: ReturnType<typeof vi.fn>
    }
    const savingsMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn> }
    }
    const { applyAutoBalanceDecision } = await import('@/lib/recap/auto-balance-persist')

    const decision = buildDecision({
      transfers: [
        buildPiggyTransfer({ to_budget_id: 'b-c', amount: 50 }),
        buildSavingsTransfer({ from_budget_id: 'b-a', to_budget_id: 'b-c', amount: 100 }),
        buildSurplusTransfer({ from_budget_id: 'b-b', to_budget_id: 'b-c', amount: 150 }),
      ],
      totalPiggyBankUsed: 50,
      totalSavingsUsed: 100,
      totalSurplusUsed: 150,
      totalPiggyBank: 50,
      totalSavings: 100,
      totalSurplus: 150,
      totalDeficit: 300,
    })

    const output = await applyAutoBalanceDecision(buildInput(), decision)

    expect(piggyMod.transferPiggyToBudgetWithInsert).toHaveBeenCalledTimes(1)
    expect(savingsMod.transferWithSavingsDebit).toHaveBeenCalledTimes(1)
    expect(supabaseMock.__mocks.insert).toHaveBeenCalledTimes(1)
    // The batched INSERT carries only the surplus row(s) — piggy + savings
    // went through their composite RPCs which own the INSERT themselves.
    const insertArg = supabaseMock.__mocks.insert.mock.calls[0]?.[0] as unknown[]
    expect(insertArg).toHaveLength(1)

    if ('success' in output) {
      expect(output.total_transferred).toBe(300)
      expect(output.piggy_bank_used).toBe(50)
      expect(output.savings_used).toBe(100)
      expect(output.surplus_used).toBe(150)
      expect(output.transfers_count).toBe(3)
      expect(output.remaining_deficit).toBe(0)
      expect(output.message).toMatch(/300€/)
    }
  })
})

describe('applyAutoBalanceDecision — fail-soft', () => {
  it('savings mid-flight throw: 2nd op throws, 3rd op still fires (fail-soft per-pair)', async () => {
    const savingsMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    savingsMod.transferWithSavingsDebit.mockImplementationOnce(async () => ({
      transfer_id: 'ok-1',
      cumulated_savings: 90,
    }))
    savingsMod.transferWithSavingsDebit.mockImplementationOnce(async () => {
      throw new Error('simulated RPC failure on pair 2')
    })
    savingsMod.transferWithSavingsDebit.mockImplementationOnce(async () => ({
      transfer_id: 'ok-3',
      cumulated_savings: 60,
    }))

    const { applyAutoBalanceDecision } = await import('@/lib/recap/auto-balance-persist')

    const decision = buildDecision({
      transfers: [
        buildSavingsTransfer({ from_budget_id: 'a', to_budget_id: 'x', amount: 10 }),
        buildSavingsTransfer({ from_budget_id: 'b', to_budget_id: 'x', amount: 20 }),
        buildSavingsTransfer({ from_budget_id: 'c', to_budget_id: 'x', amount: 30 }),
      ],
      totalSavingsUsed: 60,
      totalSavings: 60,
      totalDeficit: 60,
    })

    const output = await applyAutoBalanceDecision(buildInput(), decision)

    // All 3 ops attempted (fail-soft preserves order)
    expect(savingsMod.transferWithSavingsDebit).toHaveBeenCalledTimes(3)
    // Output still returned with success (the route doesn't track which ops
    // succeeded; the message reports the planned totals)
    expect('success' in output && output.success).toBe(true)
  })

  it('piggy mid-flight throw: 2nd op throws, 3rd op still fires (fail-soft per-pair)', async () => {
    const piggyMod = (await import('@/lib/finance/piggy-bank')) as unknown as {
      transferPiggyToBudgetWithInsert: ReturnType<typeof vi.fn>
    }
    piggyMod.transferPiggyToBudgetWithInsert.mockImplementationOnce(async () => ({
      transfer_id: 'ok-1',
      piggy_bank_amount: 50,
    }))
    piggyMod.transferPiggyToBudgetWithInsert.mockImplementationOnce(async () => {
      throw new Error('simulated piggy RPC failure on pair 2')
    })
    piggyMod.transferPiggyToBudgetWithInsert.mockImplementationOnce(async () => ({
      transfer_id: 'ok-3',
      piggy_bank_amount: 20,
    }))

    const { applyAutoBalanceDecision } = await import('@/lib/recap/auto-balance-persist')

    const decision = buildDecision({
      transfers: [
        buildPiggyTransfer({ to_budget_id: 'x', amount: 10 }),
        buildPiggyTransfer({ to_budget_id: 'y', amount: 20 }),
        buildPiggyTransfer({ to_budget_id: 'z', amount: 30 }),
      ],
      totalPiggyBankUsed: 60,
      totalPiggyBank: 60,
      totalDeficit: 60,
    })

    const output = await applyAutoBalanceDecision(buildInput(), decision)

    expect(piggyMod.transferPiggyToBudgetWithInsert).toHaveBeenCalledTimes(3)
    expect('success' in output && output.success).toBe(true)
  })

  it('surplus batched INSERT failure → throws (HARD error, not fail-soft)', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.insert.mockResolvedValueOnce({
      error: { message: 'simulated FK violation on surplus batch' },
    })

    const { applyAutoBalanceDecision } = await import('@/lib/recap/auto-balance-persist')

    const decision = buildDecision({
      transfers: [
        buildSurplusTransfer({ from_budget_id: 'a', to_budget_id: 'c', amount: 50 }),
        buildSurplusTransfer({ from_budget_id: 'b', to_budget_id: 'c', amount: 50 }),
      ],
      totalSurplusUsed: 100,
      totalSurplus: 100,
      totalDeficit: 100,
    })

    await expect(applyAutoBalanceDecision(buildInput(), decision)).rejects.toThrow(
      /Erreur lors de l'enregistrement des transferts surplus/,
    )
  })
})

describe('loadAutoBalanceSnapshot', () => {
  it('happy path: 3 SELECTs + piggy maybeSingle → snapshot shape complete', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        arrayAwait: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
      }
    }
    // 1. estimated_budgets
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [
        { id: 'b-1', name: 'Budget 1', estimated_amount: 100, cumulated_savings: 0 },
        { id: 'b-2', name: 'Budget 2', estimated_amount: 200, cumulated_savings: 50 },
      ],
      error: null,
    })
    // 2. real_expenses (one expense linked to b-1)
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [{ estimated_budget_id: 'b-1', amount: 150 }],
      error: null,
    })
    // 3. existing budget_transfers (none)
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    // 4. piggy_bank maybeSingle
    supabaseMock.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 1000 },
      error: null,
    })

    const { loadAutoBalanceSnapshot } = await import('@/lib/recap/auto-balance-persist')
    const snapshot = await loadAutoBalanceSnapshot(buildInput())

    expect(snapshot.context).toBe('profile')
    expect(snapshot.contextId).toBe('profile-1')
    expect(snapshot.ownerField).toBe('profile_id')
    expect(snapshot.piggyBank).toBe(1000)
    expect(snapshot.budgetAnalyses).toHaveLength(2)

    // Budget 1: estimated=100, spent=150 → deficit=50, surplus=0
    const b1 = snapshot.budgetAnalyses.find((b) => b.id === 'b-1')
    expect(b1).toMatchObject({
      id: 'b-1',
      name: 'Budget 1',
      estimated_amount: 100,
      spent_amount: 150,
      monthly_surplus: 0,
      monthly_deficit: 50,
      cumulated_savings: 0,
    })
    // Budget 2: estimated=200, spent=0 → surplus=200, deficit=0
    const b2 = snapshot.budgetAnalyses.find((b) => b.id === 'b-2')
    expect(b2).toMatchObject({
      id: 'b-2',
      estimated_amount: 200,
      spent_amount: 0,
      monthly_surplus: 200,
      monthly_deficit: 0,
      cumulated_savings: 50,
    })
  })

  it('empty estimated_budgets → throws RecapNoBudgetsError', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { arrayAwait: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })

    const { loadAutoBalanceSnapshot } = await import('@/lib/recap/auto-balance-persist')
    const { RecapNoBudgetsError } = await import('@/lib/recap/auto-balance-types')

    await expect(loadAutoBalanceSnapshot(buildInput())).rejects.toBeInstanceOf(
      RecapNoBudgetsError,
    )
  })

  it('estimated_budgets SELECT fails → throws "Erreur ... budgets"', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { arrayAwait: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated estimated_budgets failure' },
    })

    const { loadAutoBalanceSnapshot } = await import('@/lib/recap/auto-balance-persist')

    await expect(loadAutoBalanceSnapshot(buildInput())).rejects.toThrow(
      /Erreur lors de la récupération des budgets/,
    )
  })

  it('real_expenses SELECT fails → throws "Erreur ... dépenses"', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { arrayAwait: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [{ id: 'b-1', name: 'B', estimated_amount: 100, cumulated_savings: 0 }],
      error: null,
    })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated real_expenses failure' },
    })

    const { loadAutoBalanceSnapshot } = await import('@/lib/recap/auto-balance-persist')

    await expect(loadAutoBalanceSnapshot(buildInput())).rejects.toThrow(
      /Erreur lors de la récupération des dépenses/,
    )
  })

  it('budget_transfers SELECT fails → throws "Erreur ... transferts"', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { arrayAwait: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [{ id: 'b-1', name: 'B', estimated_amount: 100, cumulated_savings: 0 }],
      error: null,
    })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated budget_transfers failure' },
    })

    const { loadAutoBalanceSnapshot } = await import('@/lib/recap/auto-balance-persist')

    await expect(loadAutoBalanceSnapshot(buildInput())).rejects.toThrow(
      /Erreur lors de la récupération des transferts/,
    )
  })

  it('piggy_bank maybeSingle error → fail-soft (snapshot.piggyBank = 0, no throw)', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        arrayAwait: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
      }
    }
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [{ id: 'b-1', name: 'B', estimated_amount: 100, cumulated_savings: 0 }],
      error: null,
    })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    supabaseMock.__mocks.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated piggy_bank failure' },
    })

    const { loadAutoBalanceSnapshot } = await import('@/lib/recap/auto-balance-persist')
    const snapshot = await loadAutoBalanceSnapshot(buildInput())

    // Fail-soft: load completes, piggyBank=0
    expect(snapshot.piggyBank).toBe(0)
  })

  it('piggy_bank null data with no error → snapshot.piggyBank = 0', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        arrayAwait: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
      }
    }
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [{ id: 'b-1', name: 'B', estimated_amount: 100, cumulated_savings: 0 }],
      error: null,
    })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    supabaseMock.__mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const { loadAutoBalanceSnapshot } = await import('@/lib/recap/auto-balance-persist')
    const snapshot = await loadAutoBalanceSnapshot(buildInput())

    expect(snapshot.piggyBank).toBe(0)
  })
})

describe('processAutoBalance — orchestration', () => {
  it('happy path: loadSnapshot → decide (decision) → apply → success output', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        arrayAwait: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
      }
    }
    const piggyMod = (await import('@/lib/finance/piggy-bank')) as unknown as {
      transferPiggyToBudgetWithInsert: ReturnType<typeof vi.fn>
    }
    // estimated_budgets: 2 budgets, one deficit, one savings-source
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [
        { id: 'b-deficit', name: 'D', estimated_amount: 50, cumulated_savings: 0 },
      ],
      error: null,
    })
    // real_expenses: 1 expense > estimated → deficit
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [{ estimated_budget_id: 'b-deficit', amount: 100 }],
      error: null,
    })
    // existing budget_transfers
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    // piggy_bank
    supabaseMock.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 50 },
      error: null,
    })

    const { processAutoBalance } = await import('@/lib/recap/auto-balance-persist')
    const output = await processAutoBalance(buildInput())

    // PHASE 0 fires: piggy=50 covers deficit=50
    expect(piggyMod.transferPiggyToBudgetWithInsert).toHaveBeenCalledTimes(1)
    expect('success' in output && output.success).toBe(true)
    if ('success' in output) {
      expect(output.piggy_bank_used).toBe(50)
      expect(output.transfers_count).toBe(1)
    }
  })

  it('no_deficit early-return: no apply calls, empty output', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        arrayAwait: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
      }
    }
    const piggyMod = (await import('@/lib/finance/piggy-bank')) as unknown as {
      transferPiggyToBudgetWithInsert: ReturnType<typeof vi.fn>
    }
    const savingsMod = (await import('@/lib/finance/budget-transfers')) as unknown as {
      transferWithSavingsDebit: ReturnType<typeof vi.fn>
    }
    // Budget with surplus but no deficit
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [
        { id: 'b-1', name: 'B', estimated_amount: 200, cumulated_savings: 0 },
      ],
      error: null,
    })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [{ estimated_budget_id: 'b-1', amount: 50 }], // spent < estimated → surplus
      error: null,
    })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    supabaseMock.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 100 },
      error: null,
    })

    const { processAutoBalance } = await import('@/lib/recap/auto-balance-persist')
    const output = await processAutoBalance(buildInput())

    expect(piggyMod.transferPiggyToBudgetWithInsert).not.toHaveBeenCalled()
    expect(savingsMod.transferWithSavingsDebit).not.toHaveBeenCalled()
    expect('success' in output).toBe(false)
    expect(output.message).toMatch(/Aucun budget déficitaire/)
    expect(output.transfers).toEqual([])
  })

  it('no_resources early-return: no piggy/savings/surplus → no apply, empty output', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        arrayAwait: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
      }
    }
    const piggyMod = (await import('@/lib/finance/piggy-bank')) as unknown as {
      transferPiggyToBudgetWithInsert: ReturnType<typeof vi.fn>
    }
    // 1 deficit budget, spent=estimated (no surplus possible elsewhere)
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [
        { id: 'b-1', name: 'B', estimated_amount: 50, cumulated_savings: 0 },
      ],
      error: null,
    })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [{ estimated_budget_id: 'b-1', amount: 100 }], // overspend → deficit
      error: null,
    })
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({ data: [], error: null })
    // piggy=0, no savings on this budget, no surplus
    supabaseMock.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 0 },
      error: null,
    })

    const { processAutoBalance } = await import('@/lib/recap/auto-balance-persist')
    const output = await processAutoBalance(buildInput())

    expect(piggyMod.transferPiggyToBudgetWithInsert).not.toHaveBeenCalled()
    expect('success' in output).toBe(false)
    expect(output.message).toMatch(/Aucune tirelire/)
    expect(output.transfers).toEqual([])
  })
})
