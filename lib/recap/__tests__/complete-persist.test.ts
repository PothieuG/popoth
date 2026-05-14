/**
 * Mocked unit tests for `applyCompleteDecision` + `loadCompleteSnapshot`
 * — Sprint Refactor-I6.
 *
 * Pins the orchestration contract that the gated caract tests can't
 * easily cover: per-step RPC dispatch, fail-soft semantics on cleanup
 * / carryover / surplus / last_monthly_update / reset, throw
 * propagation on recap INSERT/UPDATE, and the loader's error mapping
 * to RecapBudgetNotFoundError + thrown Errors.
 *
 * Mock strategy mirrors lib/recap/__tests__/step1-persist.test.ts:
 * `vi.mock` hoisted with a __mocks registry on the supabaseServer mock,
 * dynamic `await import` of the SUT inside test bodies so the mocks
 * are installed before module load. The chain is extended to support
 * `.insert(...).select(...).single()`, `.update(...).eq(...).select(...).single()`,
 * `.update(...).eq(...)` (direct await), `.delete().eq(...)` (direct await),
 * and `.maybeSingle()`, in addition to step1's `.select(...).eq(...).then`
 * thenable for SELECTs without terminal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  BudgetSnapshot,
  ProcessCompleteDecision,
  ProcessCompleteInput,
  ProcessCompleteSnapshot,
} from '@/lib/recap/complete-types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase-server', () => {
  // Top-level terminal vi.fns the tests queue responses on.
  const single = vi.fn(async () => ({ data: null, error: null }))
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  const arrayAwait = vi.fn(async () => ({ data: [], error: null }))
  const insertAwait = vi.fn(async () => ({ data: null, error: null }))
  const updateAwait = vi.fn(async () => ({ data: null, error: null }))
  const deleteAwait = vi.fn(async () => ({ data: null, error: null }))

  // insertChain is what chain.insert(...) returns. Chainable (.select returns
  // same) AND thenable (await insertChain → insertAwait). Calling .single
  // hits the top-level `single` vi.fn.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chain is intentionally thenable + chainable
  const insertChain: any = {}
  insertChain.select = vi.fn(() => insertChain)
  insertChain.single = single
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary onResolve/onReject signatures
  insertChain.then = (onResolve: any, onReject: any) => insertAwait().then(onResolve, onReject)

  // updateEqChain is what chain.update(...) returns. .eq returns same, .select
  // returns same, .single hits the top-level `single`. Thenable for direct
  // await without .select.single.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateEqChain: any = {}
  updateEqChain.eq = vi.fn(() => updateEqChain)
  updateEqChain.select = vi.fn(() => updateEqChain)
  updateEqChain.single = single
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateEqChain.then = (onResolve: any, onReject: any) => updateAwait().then(onResolve, onReject)

  // deleteEqChain is what chain.delete() returns. .eq returns same. Thenable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deleteEqChain: any = {}
  deleteEqChain.eq = vi.fn(() => deleteEqChain)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteEqChain.then = (onResolve: any, onReject: any) => deleteAwait().then(onResolve, onReject)

  // Top-level chain returned by from(...). Chainable + thenable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.not = vi.fn(() => chain)
  chain.match = vi.fn(() => chain)
  chain.single = single
  chain.maybeSingle = maybeSingle
  chain.insert = vi.fn(() => insertChain)
  chain.update = vi.fn(() => updateEqChain)
  chain.delete = vi.fn(() => deleteEqChain)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain.then = (onResolve: any, onReject: any) => arrayAwait().then(onResolve, onReject)

  const from = vi.fn(() => chain)
  return {
    supabaseServer: { from },
    __mocks: {
      from,
      single,
      maybeSingle,
      arrayAwait,
      insertAwait,
      updateAwait,
      deleteAwait,
      chainInsert: chain.insert,
      chainUpdate: chain.update,
      chainDelete: chain.delete,
    },
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

vi.mock('@/lib/finance/budget-savings', () => ({
  updateBudgetCumulatedSavings: vi.fn(async () => 0),
}))

beforeEach(() => {
  // logger.warn / logger.error route through console under the hood; silence.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInput(overrides: Partial<ProcessCompleteInput> = {}): ProcessCompleteInput {
  return {
    userId: 'user-1',
    context: 'profile',
    contextId: 'profile-1',
    ownerField: 'profile_id',
    sessionId: 'profile_1_5_2026_123',
    finalAmount: 100,
    action: 'carry_forward',
    currentDate: new Date('2026-05-14T12:00:00.000Z'),
    ...overrides,
  }
}

function buildBudget(overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Budget A',
    estimated_amount: 100,
    cumulated_savings: 0,
    monthly_surplus: 0,
    monthly_deficit: 0,
    ...overrides,
  }
}

function buildSnapshot(overrides: Partial<ProcessCompleteSnapshot> = {}): ProcessCompleteSnapshot {
  return {
    context: 'profile',
    contextId: 'profile-1',
    ownerField: 'profile_id',
    initialRemainingToLive: 100,
    totalEstimatedIncome: 200,
    totalEstimatedBudgets: 100,
    bankCurrentRemainingToLive: 100,
    budgets: [buildBudget()],
    realExpensesByBudget: new Map(),
    transfers: [],
    existingRecapId: null,
    ...overrides,
  }
}

function buildDecision(overrides: Partial<ProcessCompleteDecision> = {}): ProcessCompleteDecision {
  return {
    recapOperation: 'insert',
    recapData: {
      recap_month: 5,
      recap_year: 2026,
      initial_remaining_to_live: 100,
      final_remaining_to_live: 100,
      total_surplus: 0,
      total_deficit: 0,
      current_step: 3,
      completed_at: '2026-05-14T12:00:00.000Z',
      profile_id: 'profile-1',
      remaining_to_live_source: 'carried_forward',
      remaining_to_live_amount: 100,
    },
    existingRecapId: null,
    carryoverUpdates: [],
    preTransferBudgetDeficit: 0,
    postTransferBudgetDeficit: 0,
    surplusTransfers: [],
    totalSurplus: 0,
    totalDeficit: 0,
    selectedBudgetName: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// applyCompleteDecision tests
// ---------------------------------------------------------------------------

describe('applyCompleteDecision — happy paths', () => {
  it('CAS 1 carry_forward INSERT path: monthly_recaps.insert + cleanup + final updates', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        single: ReturnType<typeof vi.fn>
        deleteAwait: ReturnType<typeof vi.fn>
        updateAwait: ReturnType<typeof vi.fn>
        chainInsert: ReturnType<typeof vi.fn>
        chainDelete: ReturnType<typeof vi.fn>
        chainUpdate: ReturnType<typeof vi.fn>
        from: ReturnType<typeof vi.fn>
      }
    }
    // INSERT recap returns the new id
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: { id: 'recap-1' },
      error: null,
    })

    const { applyCompleteDecision } = await import('@/lib/recap/complete-persist')
    const output = await applyCompleteDecision(buildInput(), buildSnapshot(), buildDecision())

    // Response shape
    expect(output.success).toBe(true)
    expect(output.summary.recap_id).toBe('recap-1')
    expect(output.summary.action_taken).toBe('carry_forward')
    expect(output.summary.budget_used).toBe(null)
    expect(output.summary.month).toBe(5)
    expect(output.summary.year).toBe(2026)
    expect(output.redirect_to_dashboard).toBe(true)

    // INSERT path: chain.insert called once on monthly_recaps
    expect(supabaseMock.__mocks.chainInsert).toHaveBeenCalledTimes(1)
    // chain.update is called 2× for the final last_monthly_update + reset on all budgets
    expect(supabaseMock.__mocks.chainUpdate).toHaveBeenCalledTimes(2)

    // Cleanup: 3 DELETEs (real_income_entries, real_expenses, budget_transfers)
    expect(supabaseMock.__mocks.deleteAwait).toHaveBeenCalledTimes(3)

    // Final updates: 2 UPDATEs on all budgets (last_monthly_update + reset)
    // Plus 0 carryover updates (empty array) + 0 surplus transfers
    expect(supabaseMock.__mocks.updateAwait).toHaveBeenCalledTimes(2)
  })

  it('CAS 2 deduct_from_budget UPDATE path: monthly_recaps.update().eq() + budget_used in summary', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        single: ReturnType<typeof vi.fn>
        chainInsert: ReturnType<typeof vi.fn>
        chainUpdate: ReturnType<typeof vi.fn>
      }
    }
    // UPDATE recap returns id
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: { id: 'recap-existing' },
      error: null,
    })

    const { applyCompleteDecision } = await import('@/lib/recap/complete-persist')
    const output = await applyCompleteDecision(
      buildInput({ action: 'deduct_from_budget', budgetId: 'b-1', finalAmount: 50 }),
      buildSnapshot(),
      buildDecision({
        recapOperation: 'update',
        existingRecapId: 'recap-existing',
        selectedBudgetName: 'Compte courant',
      }),
    )

    expect(output.summary.recap_id).toBe('recap-existing')
    expect(output.summary.budget_used).toBe('Compte courant')
    expect(output.summary.action_taken).toBe('deduct_from_budget')

    // UPDATE path: chain.insert NOT called for recap; chainUpdate called
    // (1× for recap + 2× for last_monthly_update + reset, no carryover/surplus)
    expect(supabaseMock.__mocks.chainInsert).not.toHaveBeenCalled()
    expect(supabaseMock.__mocks.chainUpdate).toHaveBeenCalledTimes(3)
  })

  it('happy path with surplus + carryover: applies all atomic RPCs + UPDATEs in order', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { single: ReturnType<typeof vi.fn>; updateAwait: ReturnType<typeof vi.fn> }
    }
    const savingsMod = (await import('@/lib/finance/budget-savings')) as unknown as {
      updateBudgetCumulatedSavings: ReturnType<typeof vi.fn>
    }
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: { id: 'recap-1' },
      error: null,
    })

    const { applyCompleteDecision } = await import('@/lib/recap/complete-persist')
    await applyCompleteDecision(
      buildInput(),
      buildSnapshot(),
      buildDecision({
        carryoverUpdates: [
          { budget_id: 'b-1', budget_name: 'A', carryover_amount: 50 },
          { budget_id: 'b-2', budget_name: 'B', carryover_amount: 0 },
        ],
        surplusTransfers: [
          { budget_id: 'b-3', budget_name: 'C', surplus: 30, old_savings: 10, new_savings: 40 },
        ],
      }),
    )

    // Surplus transfer: 1 RPC call with (budget_id, +surplus)
    expect(savingsMod.updateBudgetCumulatedSavings).toHaveBeenCalledTimes(1)
    expect(savingsMod.updateBudgetCumulatedSavings).toHaveBeenCalledWith('b-3', 30)

    // 2 carryover UPDATEs + 2 final UPDATEs (last_monthly + reset) = 4 total
    expect(supabaseMock.__mocks.updateAwait).toHaveBeenCalledTimes(4)
  })

  it('happy path with exceptional expense: INSERTs into real_expenses', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        single: ReturnType<typeof vi.fn>
        insertAwait: ReturnType<typeof vi.fn>
      }
    }
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: { id: 'recap-1' },
      error: null,
    })

    const { applyCompleteDecision } = await import('@/lib/recap/complete-persist')
    await applyCompleteDecision(
      buildInput(),
      buildSnapshot(),
      buildDecision({
        exceptionalExpense: {
          amount: 50,
          description: 'Écart de reste à vivre reporté du récap 5/2026',
          expense_date: '2026-05-14',
          is_exceptional: true,
          estimated_budget_id: null,
          created_at: '2026-05-14T12:00:00.000Z',
          profile_id: 'profile-1',
          group_id: null,
        },
      }),
    )

    // Exceptional expense INSERT (await chain.insert without .select.single
    // → insertAwait fires)
    expect(supabaseMock.__mocks.insertAwait).toHaveBeenCalledTimes(1)
  })
})

describe('applyCompleteDecision — fail-soft per-step', () => {
  it('surplus transfer RPC throws → logger.warn + flow continues', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { single: ReturnType<typeof vi.fn>; updateAwait: ReturnType<typeof vi.fn> }
    }
    const savingsMod = (await import('@/lib/finance/budget-savings')) as unknown as {
      updateBudgetCumulatedSavings: ReturnType<typeof vi.fn>
    }
    const loggerMod = await import('@/lib/logger')
    const warnSpy = vi.spyOn(loggerMod.logger, 'warn').mockImplementation(() => {})

    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: { id: 'recap-1' },
      error: null,
    })
    savingsMod.updateBudgetCumulatedSavings.mockRejectedValueOnce(new Error('simulated RPC fail'))

    const { applyCompleteDecision } = await import('@/lib/recap/complete-persist')
    const output = await applyCompleteDecision(
      buildInput(),
      buildSnapshot(),
      buildDecision({
        surplusTransfers: [
          { budget_id: 'b-1', budget_name: 'A', surplus: 30, old_savings: 0, new_savings: 30 },
        ],
      }),
    )

    expect(output.success).toBe(true) // flow continues
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[complete savings]'),
      expect.objectContaining({ budget_id: 'b-1', surplus: 30 }),
    )
    // Final UPDATEs still happen (cleanup + last_monthly + reset = 2 awaits after deletes)
    expect(supabaseMock.__mocks.updateAwait).toHaveBeenCalledTimes(2)
  })

  it('cleanup DELETE on real_income_entries fails → logger.warn + real_expenses delete still attempted', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { single: ReturnType<typeof vi.fn>; deleteAwait: ReturnType<typeof vi.fn> }
    }
    const loggerMod = await import('@/lib/logger')
    const warnSpy = vi.spyOn(loggerMod.logger, 'warn').mockImplementation(() => {})

    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: { id: 'recap-1' },
      error: null,
    })
    supabaseMock.__mocks.deleteAwait
      .mockResolvedValueOnce({ error: { message: 'simulated incomes delete fail' } })
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null })

    const { applyCompleteDecision } = await import('@/lib/recap/complete-persist')
    const output = await applyCompleteDecision(buildInput(), buildSnapshot(), buildDecision())

    expect(output.success).toBe(true) // flow continues
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[complete cleanup]'),
      expect.objectContaining({ table: 'real_income_entries' }),
    )
    // All 3 deletes attempted (incomes, expenses, transfers)
    expect(supabaseMock.__mocks.deleteAwait).toHaveBeenCalledTimes(3)
  })

  it('carryover UPDATE fail-soft: a failing budget does not skip subsequent ones', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { single: ReturnType<typeof vi.fn>; updateAwait: ReturnType<typeof vi.fn> }
    }
    const loggerMod = await import('@/lib/logger')
    const warnSpy = vi.spyOn(loggerMod.logger, 'warn').mockImplementation(() => {})

    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: { id: 'recap-1' },
      error: null,
    })
    // 1st carryover update fails, 2nd succeeds, then 2 final updates succeed
    supabaseMock.__mocks.updateAwait
      .mockResolvedValueOnce({ error: { message: 'simulated carryover-1 fail' } })
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null })

    const { applyCompleteDecision } = await import('@/lib/recap/complete-persist')
    await applyCompleteDecision(
      buildInput(),
      buildSnapshot(),
      buildDecision({
        carryoverUpdates: [
          { budget_id: 'b-1', budget_name: 'A', carryover_amount: 50 },
          { budget_id: 'b-2', budget_name: 'B', carryover_amount: 30 },
        ],
      }),
    )

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[complete carryover]'),
      expect.objectContaining({ budget_id: 'b-1', budget_name: 'A' }),
    )
    // All 4 updates attempted (2 carryover + 2 final)
    expect(supabaseMock.__mocks.updateAwait).toHaveBeenCalledTimes(4)
  })

  it('exceptional expense INSERT fails → logger.warn + flow continues', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { single: ReturnType<typeof vi.fn>; insertAwait: ReturnType<typeof vi.fn> }
    }
    const loggerMod = await import('@/lib/logger')
    const warnSpy = vi.spyOn(loggerMod.logger, 'warn').mockImplementation(() => {})

    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: { id: 'recap-1' },
      error: null,
    })
    supabaseMock.__mocks.insertAwait.mockResolvedValueOnce({
      error: { message: 'simulated exceptional insert fail' },
    })

    const { applyCompleteDecision } = await import('@/lib/recap/complete-persist')
    const output = await applyCompleteDecision(
      buildInput(),
      buildSnapshot(),
      buildDecision({
        exceptionalExpense: {
          amount: 42,
          description: 'test',
          expense_date: '2026-05-14',
          is_exceptional: true,
          estimated_budget_id: null,
          created_at: '2026-05-14T12:00:00.000Z',
          profile_id: 'profile-1',
          group_id: null,
        },
      }),
    )

    expect(output.success).toBe(true) // flow continues
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[complete exceptional]'),
      expect.objectContaining({ amount: 42 }),
    )
  })

  it('last_monthly_update UPDATE fails → logger.warn + reset still attempted', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { single: ReturnType<typeof vi.fn>; updateAwait: ReturnType<typeof vi.fn> }
    }
    const loggerMod = await import('@/lib/logger')
    const warnSpy = vi.spyOn(loggerMod.logger, 'warn').mockImplementation(() => {})

    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: { id: 'recap-1' },
      error: null,
    })
    // last_monthly_update fails (1st updateAwait call), reset succeeds (2nd)
    supabaseMock.__mocks.updateAwait
      .mockResolvedValueOnce({ error: { message: 'simulated last_monthly fail' } })
      .mockResolvedValueOnce({ error: null })

    const { applyCompleteDecision } = await import('@/lib/recap/complete-persist')
    const output = await applyCompleteDecision(buildInput(), buildSnapshot(), buildDecision())

    expect(output.success).toBe(true) // flow continues
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[complete last_monthly_update]'),
      expect.anything(),
    )
    expect(supabaseMock.__mocks.updateAwait).toHaveBeenCalledTimes(2) // both UPDATEs attempted
  })
})

describe('applyCompleteDecision — CRITICAL throws on recap persist failure', () => {
  it('recap INSERT fails → throws "Erreur insertion récap"', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { single: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated insert fail' },
    })

    const { applyCompleteDecision } = await import('@/lib/recap/complete-persist')
    await expect(
      applyCompleteDecision(buildInput(), buildSnapshot(), buildDecision()),
    ).rejects.toThrow(/Erreur insertion récap/)
  })

  it('recap UPDATE fails → throws "Erreur mise à jour récap"', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { single: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated update fail' },
    })

    const { applyCompleteDecision } = await import('@/lib/recap/complete-persist')
    await expect(
      applyCompleteDecision(
        buildInput(),
        buildSnapshot(),
        buildDecision({ recapOperation: 'update', existingRecapId: 'r-existing' }),
      ),
    ).rejects.toThrow(/Erreur mise à jour récap/)
  })
})

// ---------------------------------------------------------------------------
// loadCompleteSnapshot tests
// ---------------------------------------------------------------------------

describe('loadCompleteSnapshot — happy path + error mapping', () => {
  it('happy path: 3 SELECTs + bank + existing recap → snapshot shape complete', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        arrayAwait: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
      }
    }
    // 1: budgets (arrayAwait #1)
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [
        {
          id: 'b-1',
          name: 'Budget 1',
          estimated_amount: 200,
          cumulated_savings: 50,
          monthly_surplus: 10,
          monthly_deficit: 0,
        },
      ],
      error: null,
    })
    // 2: real_expenses (arrayAwait #2)
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [{ estimated_budget_id: 'b-1', amount: 30 }],
      error: null,
    })
    // 3: budget_transfers (arrayAwait #3)
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: [{ from_budget_id: 'b-1', to_budget_id: null, transfer_amount: 5 }],
      error: null,
    })
    // 4: bank_balances (maybeSingle #1)
    supabaseMock.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { current_remaining_to_live: 400 },
      error: null,
    })
    // 5: monthly_recaps existence (maybeSingle #2)
    supabaseMock.__mocks.maybeSingle.mockResolvedValueOnce({
      data: null, // no existing recap
      error: null,
    })

    const { loadCompleteSnapshot } = await import('@/lib/recap/complete-persist')
    const snapshot = await loadCompleteSnapshot(buildInput())

    // financialData mocked at top of file:
    //   remainingToLive=200, totalEstimatedIncome=1000, totalEstimatedBudgets=800
    expect(snapshot.context).toBe('profile')
    expect(snapshot.contextId).toBe('profile-1')
    expect(snapshot.initialRemainingToLive).toBe(200)
    expect(snapshot.totalEstimatedIncome).toBe(1000)
    expect(snapshot.totalEstimatedBudgets).toBe(800)
    expect(snapshot.bankCurrentRemainingToLive).toBe(400)
    expect(snapshot.budgets).toHaveLength(1)
    expect(snapshot.budgets[0]?.id).toBe('b-1')
    expect(snapshot.realExpensesByBudget.get('b-1')).toBe(30)
    expect(snapshot.transfers).toHaveLength(1)
    expect(snapshot.existingRecapId).toBe(null)
  })

  it('existing recap row present → existingRecapId set, recapOperation will be update', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        arrayAwait: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
      }
    }
    supabaseMock.__mocks.arrayAwait
      .mockResolvedValueOnce({ data: [], error: null }) // budgets
      .mockResolvedValueOnce({ data: [], error: null }) // expenses
      .mockResolvedValueOnce({ data: [], error: null }) // transfers
    supabaseMock.__mocks.maybeSingle
      .mockResolvedValueOnce({ data: { current_remaining_to_live: 0 }, error: null }) // bank
      .mockResolvedValueOnce({ data: { id: 'recap-existing' }, error: null }) // existing recap

    const { loadCompleteSnapshot } = await import('@/lib/recap/complete-persist')
    const snapshot = await loadCompleteSnapshot(buildInput())

    expect(snapshot.existingRecapId).toBe('recap-existing')
  })

  it('bank_balances maybeSingle returns null → bankCurrentRemainingToLive defaults to 0', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        arrayAwait: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
      }
    }
    supabaseMock.__mocks.arrayAwait
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    supabaseMock.__mocks.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // bank missing
      .mockResolvedValueOnce({ data: null, error: null }) // no existing recap

    const { loadCompleteSnapshot } = await import('@/lib/recap/complete-persist')
    const snapshot = await loadCompleteSnapshot(buildInput())

    expect(snapshot.bankCurrentRemainingToLive).toBe(0)
  })

  it('budgets SELECT fails → throws "Erreur récupération budgets"', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { arrayAwait: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.arrayAwait.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated budgets fail' },
    })

    const { loadCompleteSnapshot } = await import('@/lib/recap/complete-persist')
    await expect(loadCompleteSnapshot(buildInput())).rejects.toThrow(/Erreur récupération budgets/)
  })

  it('real_expenses SELECT fails → throws "Erreur récupération dépenses"', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { arrayAwait: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.arrayAwait
      .mockResolvedValueOnce({ data: [], error: null }) // budgets OK
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'simulated expenses fail' },
      })

    const { loadCompleteSnapshot } = await import('@/lib/recap/complete-persist')
    await expect(loadCompleteSnapshot(buildInput())).rejects.toThrow(/Erreur récupération dépenses/)
  })

  it('budget_transfers SELECT fails → throws "Erreur récupération transferts"', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { arrayAwait: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.arrayAwait
      .mockResolvedValueOnce({ data: [], error: null }) // budgets
      .mockResolvedValueOnce({ data: [], error: null }) // expenses
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'simulated transfers fail' },
      })

    const { loadCompleteSnapshot } = await import('@/lib/recap/complete-persist')
    await expect(loadCompleteSnapshot(buildInput())).rejects.toThrow(
      /Erreur récupération transferts/,
    )
  })

  it('deduct_from_budget budget not in snapshot → throws RecapBudgetNotFoundError', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: {
        arrayAwait: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
      }
    }
    supabaseMock.__mocks.arrayAwait
      .mockResolvedValueOnce({ data: [], error: null }) // empty budgets
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    supabaseMock.__mocks.maybeSingle
      .mockResolvedValueOnce({ data: { current_remaining_to_live: 0 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })

    const { loadCompleteSnapshot } = await import('@/lib/recap/complete-persist')
    const { RecapBudgetNotFoundError } = await import('@/lib/recap/complete-types')
    await expect(
      loadCompleteSnapshot(
        buildInput({ action: 'deduct_from_budget', budgetId: 'missing-budget-id' }),
      ),
    ).rejects.toThrow(RecapBudgetNotFoundError)
  })
})
