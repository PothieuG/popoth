/**
 * Mocked unit tests for POST /api/finance/expenses/add-with-logic.
 *
 * Updated by Sprint Atomicity-Expenses: the smart-allocation path now
 * delegates piggy debit + savings debit + INSERT real_expenses to the
 * composite atomic RPC `add_expense_with_breakdown` via
 * `addExpenseWithBreakdown` from @/lib/finance/expenses. The pre-fix
 * REGRESSION-GUARD test (Cas 4) which pinned the atomicity gap is
 * reformulated as Cas 3 PIN ATOMIC CONTRACT — it now asserts the
 * handler trusts the RPC atomicity (single mutation entry point, no
 * fallback to direct piggy/savings ops, no compensating action needed
 * because Postgres rolls back the whole tx on overdraft / INSERT
 * failure).
 *
 * Mock strategy mirrors lib/recap/__tests__/step1-persist.test.ts —
 * `vi.mock` hoisted with withAuth passthrough, dynamic `await import`
 * in test bodies. `calculateBreakdown` is kept REAL (pure-sync, ~62 LOC,
 * mocking adds complexity for zero coverage gain). @/lib/logger is
 * mocked. @/lib/finance/piggy-bank and @/lib/finance/budget-savings
 * are no longer mocked — the handler no longer calls them directly.
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
  chain.then = (onResolve: any, onReject: any) => matchAwait().then(onResolve, onReject)

  const from = vi.fn(() => chain)
  return {
    supabaseServer: { from },
    __mocks: { from, single, maybeSingle, matchAwait, insert: chain.insert },
  }
})

vi.mock('@/lib/finance', () => ({
  saveRemainingToLiveSnapshot: vi.fn(async () => true),
}))

vi.mock('@/lib/finance/expenses', () => ({
  addExpenseWithBreakdown: vi.fn(async () => ({ expense_id: 'rx-mock' })),
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

type ExpensesMocks = { addExpenseWithBreakdown: ReturnType<typeof vi.fn> }
type LoggerMocks = { logger: { error: ReturnType<typeof vi.fn> } }

async function importMocks() {
  const supabase = (await import('@/lib/supabase-server')) as unknown as SupabaseMocks
  const expensesMod = (await import('@/lib/finance/expenses')) as unknown as ExpensesMocks
  const loggerMod = (await import('@/lib/logger')) as unknown as LoggerMocks
  return { supabase, expensesMod, loggerMod }
}

// Tests ----------------------------------------------------------------------

describe('POST /api/finance/expenses/add-with-logic — smart allocation (atomic)', () => {
  it('happy path: atomic RPC called once with full breakdown, response shape preserved', async () => {
    const { supabase, expensesMod, loggerMod } = await importMocks()

    // L129 piggy_bank fetch (maybeSingle)
    supabase.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 100 },
      error: null,
    })
    // L138 estimated_budgets fetch (single)
    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Budget 1',
        estimated_amount: 200,
        cumulated_savings: 30,
      },
      error: null,
    })
    // L153 real_expenses listing (awaited chain, no terminal)
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    // RPC resolves with the new expense id
    expensesMod.addExpenseWithBreakdown.mockResolvedValueOnce({ expense_id: 'rx-1' })
    // Re-fetch the inserted row + estimated_budget join
    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: 'rx-1',
        amount: 150,
        description: 'Lunch',
        estimated_budget: { name: 'Budget 1' },
      },
      error: null,
    })

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    // amount=150, piggy=100, savings=30 → breakdown {100, 30, 20}
    const response = await POST(
      buildRequest({
        amount: 150,
        description: 'Lunch',
        estimated_budget_id: '11111111-1111-4111-8111-111111111111',
        is_for_group: false,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.real_expense).toMatchObject({ id: 'rx-1', amount: 150 })
    expect(json.breakdown).toMatchObject({
      from_piggy_bank: 100,
      from_budget_savings: 30,
      from_budget: 20,
    })
    // Single mutation entry point — atomic RPC called exactly once with the
    // full breakdown (piggy debit + savings debit + INSERT all live inside).
    expect(expensesMod.addExpenseWithBreakdown).toHaveBeenCalledTimes(1)
    expect(expensesMod.addExpenseWithBreakdown).toHaveBeenCalledWith(
      { profile_id: 'user-1' },
      expect.objectContaining({
        amount: 150,
        description: 'Lunch',
        estimatedBudgetId: '11111111-1111-4111-8111-111111111111',
        amountFromPiggyBank: 100,
        amountFromBudgetSavings: 30,
        amountFromBudget: 20,
      }),
    )
    // The handler does NOT INSERT real_expenses directly — the INSERT lives
    // inside the RPC (mocked here).
    expect(supabase.__mocks.insert).not.toHaveBeenCalled()
    expect(loggerMod.logger.error).not.toHaveBeenCalled()
  })

  it('atomic RPC throws (overdraft or INSERT failure): 500, no fallback ops', async () => {
    // Consolidates the pre-fix Cas 2 ("piggy RPC throws") and Cas 3 ("savings
    // RPC throws") — post-fix all overdraft / INSERT failures funnel through
    // a single throw from addExpenseWithBreakdown, which the handler maps to
    // a 500. There is no compensating action needed because the entire
    // composite RPC rolled back as one Postgres tx.
    const { supabase, expensesMod, loggerMod } = await importMocks()

    supabase.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 100 },
      error: null,
    })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Budget 1',
        estimated_amount: 200,
        cumulated_savings: 30,
      },
      error: null,
    })
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    expensesMod.addExpenseWithBreakdown.mockRejectedValueOnce(
      new Error('piggy_bank amount cannot become negative (current: -50)'),
    )

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    const response = await POST(
      buildRequest({
        amount: 150,
        description: 'Lunch',
        estimated_budget_id: '11111111-1111-4111-8111-111111111111',
        is_for_group: false,
      }),
    )

    expect(response.status).toBe(500)
    expect(expensesMod.addExpenseWithBreakdown).toHaveBeenCalledTimes(1)
    // No direct INSERT, no re-fetch — handler bails on the RPC throw.
    expect(supabase.__mocks.insert).not.toHaveBeenCalled()
    // logger.error fired with the atomic-op message
    const errorMessages = loggerMod.logger.error.mock.calls.map((args) => args[0] as string)
    expect(errorMessages).toEqual(
      expect.arrayContaining([expect.stringMatching(/Erreur création dépense atomique/)]),
    )
  })

  it('PIN ATOMIC CONTRACT: single mutation entry point, no compensating action on failure', async () => {
    // Was Cas 4 REGRESSION-GUARD pre-fix — pinned the atomicity gap (piggy +
    // savings debited but INSERT failed with no rollback). Post-fix the gap
    // is closed at the DB level: the composite RPC wraps all three ops in one
    // Postgres tx, so a thrown RPC means nothing was committed.
    //
    // This test now PINS the architectural invariant: the handler exposes
    // a single mutation call site (addExpenseWithBreakdown) and does not
    // attempt any per-resource rollback / compensating action on failure.
    // If a future refactor reintroduces split mutation paths (e.g. calling
    // updatePiggyBank or updateBudgetCumulatedSavings directly again), this
    // test will likely still pass — but the gated DB-level atomicity tests
    // in lib/finance/__tests__/add-expense-with-breakdown.test.ts will fail
    // by proving partial state can leak. Keep both layers.
    const { supabase, expensesMod, loggerMod } = await importMocks()

    supabase.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 100 },
      error: null,
    })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Budget 1',
        estimated_amount: 200,
        cumulated_savings: 30,
      },
      error: null,
    })
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    // Atomic RPC throws as if the INSERT (final step inside the RPC) failed.
    // In production, this also rolls back any prior debits in the same tx.
    expensesMod.addExpenseWithBreakdown.mockRejectedValueOnce(
      new Error('insert or update on table "real_expenses" violates check constraint'),
    )

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    const response = await POST(
      buildRequest({
        amount: 150,
        description: 'Lunch',
        estimated_budget_id: '11111111-1111-4111-8111-111111111111',
        is_for_group: false,
      }),
    )

    expect(response.status).toBe(500)
    // Single call site invariant
    expect(expensesMod.addExpenseWithBreakdown).toHaveBeenCalledTimes(1)
    // No compensating actions: handler does NOT call any restore RPC nor a
    // second mutation path. INSERT is not attempted directly.
    expect(supabase.__mocks.insert).not.toHaveBeenCalled()
    // Single logger.error site (atomic-op label)
    const errorMessages = loggerMod.logger.error.mock.calls.map((args) => args[0] as string)
    expect(errorMessages.filter((m) => /atomique/.test(m))).toHaveLength(1)
  })

  it('exceptional path (no estimated_budget_id): single INSERT, atomic RPC not called', async () => {
    const { supabase, expensesMod } = await importMocks()

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
    // INSERT called once (the exceptional path — direct INSERT, no RPC)
    expect(supabase.__mocks.insert).toHaveBeenCalledTimes(1)
    expect(supabase.__mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50, is_exceptional: true }),
    )
    // Atomic RPC NOT called for exceptional path
    expect(expensesMod.addExpenseWithBreakdown).not.toHaveBeenCalled()
  })
})
