/**
 * Mocked unit tests for POST /api/finance/expenses/add-with-logic —
 * Sprint Refactor-Test-Coverage.
 *
 * Pins the smart-allocation orchestration (piggy → savings → budget) and
 * REGRESSION-GUARDS the atomicity gap: when the final INSERT real_expenses
 * fails, piggy + cumulated_savings are already debited and the route has
 * NO compensating action. This test pins the current behavior — if a future
 * sprint adds rollback, this test breaks and forces an explicit update.
 *
 * Mock strategy mirrors lib/recap/__tests__/step1-persist.test.ts —
 * `vi.mock` hoisted with withAuth passthrough, dynamic `await import`
 * in test bodies. calculateBreakdown is kept REAL (pure-sync, ~62 LOC,
 * mocking adds complexity for zero coverage gain). @/lib/logger is mocked.
 */

import type { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks ---------------------------------------------------------------

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuth: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, { userId: 'user-1' }),
    withAuthAndProfile: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, {
        userId: 'user-1',
        profile: { id: 'user-1', group_id: null, first_name: 'T', last_name: 'U' },
      }),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

// Supabase chain mock: thenable so `await chain.match(...)` (no terminal)
// resolves a separate matchAwait queue; terminal `.single()` / `.maybeSingle()`
// use their own queues. All chain methods return the chain itself.
vi.mock('@/lib/supabase-server', () => {
  const single = vi.fn(async () => ({ data: null, error: null }))
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  const matchAwait = vi.fn(async () => ({ data: [], error: null }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chain is intentionally thenable + chainable; precise typing wouldn't help
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.match = vi.fn(() => chain)
  chain.insert = vi.fn(() => chain)
  chain.single = single
  chain.maybeSingle = maybeSingle
  // Thenable: enables `await chain.match(...)` returning the matchAwait queue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary onResolve/onReject signatures
  chain.then = (onResolve: any, onReject: any) =>
    matchAwait().then(onResolve, onReject)

  const from = vi.fn(() => chain)
  return {
    supabaseServer: { from },
    __mocks: { from, single, maybeSingle, matchAwait, insert: chain.insert },
  }
})

vi.mock('@/lib/finance', () => ({
  saveRemainingToLiveSnapshot: vi.fn(async () => true),
}))

vi.mock('@/lib/finance/piggy-bank', () => ({
  updatePiggyBank: vi.fn(async () => 0),
}))

vi.mock('@/lib/finance/budget-savings', () => ({
  updateBudgetCumulatedSavings: vi.fn(async () => 0),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// Test helpers ---------------------------------------------------------------

function buildRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

type SupabaseMocks = {
  __mocks: {
    from: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
    matchAwait: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
  }
}

type PiggyMocks = { updatePiggyBank: ReturnType<typeof vi.fn> }
type SavingsMocks = { updateBudgetCumulatedSavings: ReturnType<typeof vi.fn> }
type LoggerMocks = { logger: { error: ReturnType<typeof vi.fn> } }

async function importMocks() {
  const supabase = (await import('@/lib/supabase-server')) as unknown as SupabaseMocks
  const piggy = (await import('@/lib/finance/piggy-bank')) as unknown as PiggyMocks
  const savings = (await import('@/lib/finance/budget-savings')) as unknown as SavingsMocks
  const loggerMod = (await import('@/lib/logger')) as unknown as LoggerMocks
  return { supabase, piggy, savings, loggerMod }
}

// Tests ----------------------------------------------------------------------

describe('POST /api/finance/expenses/add-with-logic — smart allocation', () => {
  it('happy path: piggy + savings + INSERT all succeed, 3 writes in order', async () => {
    const { supabase, piggy, savings, loggerMod } = await importMocks()

    // L129 piggy_bank fetch (maybeSingle)
    supabase.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 100 },
      error: null,
    })
    // L138 estimated_budgets fetch (single)
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-1', name: 'Budget 1', estimated_amount: 200, cumulated_savings: 30 },
      error: null,
    })
    // L153 real_expenses listing (awaited chain, no terminal)
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    // L221 INSERT result (single after insert+select)
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'rx-1', amount: 150, description: 'Lunch' },
      error: null,
    })

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    // amount=150, piggy=100, savings=30 → breakdown {100, 30, 20}
    const response = await POST(
      buildRequest({
        amount: 150,
        description: 'Lunch',
        estimated_budget_id: 'b-1',
        is_for_group: false,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.real_expense).toBeDefined()
    expect(json.breakdown).toMatchObject({
      from_piggy_bank: 100,
      from_budget_savings: 30,
      from_budget: 20,
    })
    // Piggy RPC called once with -100
    expect(piggy.updatePiggyBank).toHaveBeenCalledTimes(1)
    expect(piggy.updatePiggyBank).toHaveBeenCalledWith({ profile_id: 'user-1' }, -100)
    // Savings RPC called once with -30
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledTimes(1)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledWith('b-1', -30)
    // INSERT real_expenses called once with full amount + breakdown breakdown
    expect(supabase.__mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 150,
        amount_from_piggy_bank: 100,
        amount_from_budget_savings: 30,
        amount_from_budget: 20,
      }),
    )
    expect(loggerMod.logger.error).not.toHaveBeenCalled()
  })

  it('piggy RPC throws: fail-fast 500, savings + INSERT not called', async () => {
    const { supabase, piggy, savings } = await importMocks()

    supabase.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 100 },
      error: null,
    })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-1', name: 'Budget 1', estimated_amount: 200, cumulated_savings: 30 },
      error: null,
    })
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    piggy.updatePiggyBank.mockRejectedValueOnce(new Error('piggy RPC fail'))

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    const response = await POST(
      buildRequest({
        amount: 150,
        description: 'Lunch',
        estimated_budget_id: 'b-1',
        is_for_group: false,
      }),
    )

    expect(response.status).toBe(500)
    expect(piggy.updatePiggyBank).toHaveBeenCalledTimes(1)
    // Savings RPC NOT called (fail-fast)
    expect(savings.updateBudgetCumulatedSavings).not.toHaveBeenCalled()
    // INSERT NOT called
    expect(supabase.__mocks.insert).not.toHaveBeenCalled()
  })

  it('savings RPC throws: piggy already debited, no compensating, INSERT not called', async () => {
    const { supabase, piggy, savings } = await importMocks()

    supabase.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 100 },
      error: null,
    })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-1', name: 'Budget 1', estimated_amount: 200, cumulated_savings: 30 },
      error: null,
    })
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    // Piggy debit succeeds, savings throws
    piggy.updatePiggyBank.mockResolvedValueOnce(0)
    savings.updateBudgetCumulatedSavings.mockRejectedValueOnce(new Error('savings RPC fail'))

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    const response = await POST(
      buildRequest({
        amount: 150,
        description: 'Lunch',
        estimated_budget_id: 'b-1',
        is_for_group: false,
      }),
    )

    expect(response.status).toBe(500)
    // Piggy called ONCE (debit). No compensating restore.
    expect(piggy.updatePiggyBank).toHaveBeenCalledTimes(1)
    expect(piggy.updatePiggyBank).toHaveBeenCalledWith({ profile_id: 'user-1' }, -100)
    // Savings called ONCE (debit attempt, threw)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledTimes(1)
    // INSERT NOT called
    expect(supabase.__mocks.insert).not.toHaveBeenCalled()
  })

  it('REGRESSION-GUARD atomicity gap: INSERT real_expenses fails but piggy + savings already debited (no compensating action)', async () => {
    // This test pins the CURRENT BEHAVIOR — not the desired one. The route
    // debits piggy + cumulated_savings via atomic RPCs, then performs a
    // direct INSERT real_expenses. If the INSERT fails, both debits stay
    // committed and the user perceives a magic money loss on next refresh.
    //
    // When a future Sprint Atomicity-Expenses fixes this (e.g. via a
    // composite RPC mirroring transfer_with_savings_debit from Sprint
    // Refactor-I5-followup-v2, or via compensating logger.error +
    // cleanup-attempt calls), this test will break — which is the signal
    // to update both the test and CLAUDE.md §11.
    const { supabase, piggy, savings, loggerMod } = await importMocks()

    supabase.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 100 },
      error: null,
    })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-1', name: 'Budget 1', estimated_amount: 200, cumulated_savings: 30 },
      error: null,
    })
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    // Piggy + savings debits succeed
    piggy.updatePiggyBank.mockResolvedValueOnce(0)
    savings.updateBudgetCumulatedSavings.mockResolvedValueOnce(0)
    // INSERT fails (FK violation, NOT NULL violation, etc.)
    supabase.__mocks.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated INSERT failure', code: '23505' },
    })

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    const response = await POST(
      buildRequest({
        amount: 150,
        description: 'Lunch',
        estimated_budget_id: 'b-1',
        is_for_group: false,
      }),
    )

    expect(response.status).toBe(500)
    // INSERT was attempted
    expect(supabase.__mocks.insert).toHaveBeenCalledTimes(1)
    // ATOMICITY GAP: piggy + savings were each called EXACTLY ONCE (debit only).
    // No restore. No compensating action. Piggy/savings remain debited in DB.
    expect(piggy.updatePiggyBank).toHaveBeenCalledTimes(1)
    expect(piggy.updatePiggyBank).toHaveBeenCalledWith({ profile_id: 'user-1' }, -100)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledTimes(1)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledWith('b-1', -30)
    // logger.error fired (L233 'Erreur création dépense')
    const errorMessages = loggerMod.logger.error.mock.calls.map((args) => args[0] as string)
    expect(errorMessages).toEqual(
      expect.arrayContaining([expect.stringMatching(/Erreur création dépense/)]),
    )
  })

  it('exceptional path (no estimated_budget_id): single INSERT, no piggy/savings RPC', async () => {
    const { supabase, piggy, savings } = await importMocks()

    // Exceptional INSERT result (single after insert+select)
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'rx-exceptional', amount: 50, description: 'Coffee', is_exceptional: true },
      error: null,
    })

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    const response = await POST(
      buildRequest({
        amount: 50,
        description: 'Coffee',
        is_for_group: false,
        // no estimated_budget_id → exceptional path
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.breakdown).toBeNull()
    expect(json.real_expense).toBeDefined()
    // INSERT called once (the exceptional path)
    expect(supabase.__mocks.insert).toHaveBeenCalledTimes(1)
    expect(supabase.__mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50, is_exceptional: true }),
    )
    // No piggy/savings RPC for exceptional path
    expect(piggy.updatePiggyBank).not.toHaveBeenCalled()
    expect(savings.updateBudgetCumulatedSavings).not.toHaveBeenCalled()
  })
})
