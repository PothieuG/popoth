/**
 * Mocked unit tests for POST /api/savings/transfer — Sprint Refactor-Test-Coverage.
 *
 * Regression-guards the 3 CRITICAL cleanup-attempts preserved at Lot 4d:
 * - route.ts L122 (POST budget→budget): rollback fail after RPC 2 (TO) fail
 * - route.ts L321 (handleBudgetToPiggyBank): rollback fail after piggy UPDATE fail
 * - route.ts L337 (handleBudgetToPiggyBank): rollback fail after piggy INSERT fail
 *
 * Mock strategy mirrors lib/recap/__tests__/step1-persist.test.ts —
 * `vi.mock` hoisted with passthrough wrapper for withAuthAndProfile, then
 * dynamic `await import` of the SUT inside test bodies. @/lib/logger is
 * mocked directly (the SUT calls logger.error, not console.error), so
 * cleanup-attempt assertions read off the mock spy without capturing console.
 */

import type { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks ---------------------------------------------------------------

// Passthrough wrapper: bypass session validation, inject a fixed profile.
// withAuth is also exposed in case future versions add a withAuth call site.
vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndProfile: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, {
        userId: 'user-1',
        profile: { id: 'profile-1', group_id: null, first_name: 'T', last_name: 'U' },
      }),
    withAuth: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, { userId: 'user-1' }),
  }
})

// Logger mock: spy-friendly, no console under the hood.
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

// Supabase server: from() returns a chainable mock. Terminal methods are
// shared vi.fn() across all from() calls — tests use mockResolvedValueOnce
// to queue sequential responses.
vi.mock('@/lib/supabase-server', () => {
  const single = vi.fn(async () => ({ data: null, error: null }))
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  const insert = vi.fn(async () => ({ error: null }))
  type Chain = {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    match: ReturnType<typeof vi.fn>
    single: typeof single
    maybeSingle: typeof maybeSingle
    insert: typeof insert
  }
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    match: vi.fn(() => chain),
    single,
    maybeSingle,
    insert,
  }
  const from = vi.fn(() => chain)
  return {
    supabaseServer: { from },
    __mocks: { from, single, maybeSingle, insert },
  }
})

vi.mock('@/lib/finance/budget-savings', () => ({
  updateBudgetCumulatedSavings: vi.fn(async () => 0),
}))

vi.mock('@/lib/finance/piggy-bank', () => ({
  updatePiggyBank: vi.fn(async () => 0),
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
    insert: ReturnType<typeof vi.fn>
  }
}

type SavingsMocks = { updateBudgetCumulatedSavings: ReturnType<typeof vi.fn> }
type PiggyMocks = { updatePiggyBank: ReturnType<typeof vi.fn> }
type LoggerMocks = { logger: { error: ReturnType<typeof vi.fn> } }

async function importMocks() {
  const supabase = (await import('@/lib/supabase-server')) as unknown as SupabaseMocks
  const savings = (await import('@/lib/finance/budget-savings')) as unknown as SavingsMocks
  const piggy = (await import('@/lib/finance/piggy-bank')) as unknown as PiggyMocks
  const loggerMod = (await import('@/lib/logger')) as unknown as LoggerMocks
  return { supabase, savings, piggy, loggerMod }
}

// Tests ----------------------------------------------------------------------

describe('POST /api/savings/transfer — budget→budget', () => {
  it('happy path: RPC 1 + RPC 2 succeed, returns 200', async () => {
    const { supabase, savings, loggerMod } = await importMocks()

    // FROM budget fetch
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-from', name: 'From', estimated_amount: 200, cumulated_savings: 100 },
      error: null,
    })
    // TO budget fetch
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-to', name: 'To', estimated_amount: 300, cumulated_savings: 50 },
      error: null,
    })
    savings.updateBudgetCumulatedSavings.mockResolvedValueOnce(70)
    savings.updateBudgetCumulatedSavings.mockResolvedValueOnce(80)

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        from_budget_id: 'b-from',
        to_budget_id: 'b-to',
        amount: 30,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledTimes(2)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenNthCalledWith(1, 'b-from', -30)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenNthCalledWith(2, 'b-to', 30)
    expect(loggerMod.logger.error).not.toHaveBeenCalled()
  })

  it('RPC 1 fail: early 500, RPC 2 not called, no rollback', async () => {
    const { supabase, savings } = await importMocks()

    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-from', name: 'From', estimated_amount: 200, cumulated_savings: 100 },
      error: null,
    })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-to', name: 'To', estimated_amount: 300, cumulated_savings: 50 },
      error: null,
    })
    savings.updateBudgetCumulatedSavings.mockRejectedValueOnce(new Error('RPC 1 fail'))

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        from_budget_id: 'b-from',
        to_budget_id: 'b-to',
        amount: 30,
      }),
    )

    expect(response.status).toBe(500)
    // Only the first RPC call (which failed) — no rollback, no RPC 2
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledTimes(1)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledWith('b-from', -30)
  })

  it('RPC 2 fail + rollback succeeds: compensating call with +amount, returns 500', async () => {
    const { supabase, savings, loggerMod } = await importMocks()

    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-from', name: 'From', estimated_amount: 200, cumulated_savings: 100 },
      error: null,
    })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-to', name: 'To', estimated_amount: 300, cumulated_savings: 50 },
      error: null,
    })
    // RPC 1 (debit FROM) succeeds
    savings.updateBudgetCumulatedSavings.mockResolvedValueOnce(70)
    // RPC 2 (credit TO) fails
    savings.updateBudgetCumulatedSavings.mockRejectedValueOnce(new Error('RPC 2 fail'))
    // Rollback (re-add to FROM) succeeds
    savings.updateBudgetCumulatedSavings.mockResolvedValueOnce(100)

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        from_budget_id: 'b-from',
        to_budget_id: 'b-to',
        amount: 30,
      }),
    )

    expect(response.status).toBe(500)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledTimes(3)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenNthCalledWith(3, 'b-from', 30)
    // L122 cleanup-attempt did NOT fire (rollback succeeded)
    expect(loggerMod.logger.error).toHaveBeenCalled() // updateToError logged at L118
    // Verify L122 (rollbackError) was NOT one of the calls
    const errorCalls = loggerMod.logger.error.mock.calls.map((args) => args[0])
    expect(errorCalls).toEqual(
      expect.arrayContaining([expect.stringMatching(/Erreur mise à jour budget destination/)]),
    )
    expect(errorCalls).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/Erreur rollback budget source/)]),
    )
  })

  it('CRITIQUE L122: RPC 2 fail + rollback fails → logger.error fires (regression-guard)', async () => {
    const { supabase, savings, loggerMod } = await importMocks()

    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-from', name: 'From', estimated_amount: 200, cumulated_savings: 100 },
      error: null,
    })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-to', name: 'To', estimated_amount: 300, cumulated_savings: 50 },
      error: null,
    })
    savings.updateBudgetCumulatedSavings.mockResolvedValueOnce(70)
    savings.updateBudgetCumulatedSavings.mockRejectedValueOnce(new Error('RPC 2 fail'))
    savings.updateBudgetCumulatedSavings.mockRejectedValueOnce(new Error('Rollback also fails'))

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        from_budget_id: 'b-from',
        to_budget_id: 'b-to',
        amount: 30,
      }),
    )

    expect(response.status).toBe(500)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledTimes(3)
    // Regression-guard: route.ts:123 logger.error('❌ Erreur rollback budget source:', ...)
    const errorMessages = loggerMod.logger.error.mock.calls.map((args) => args[0] as string)
    expect(errorMessages).toEqual(
      expect.arrayContaining([expect.stringMatching(/Erreur rollback budget source/)]),
    )
  })
})

describe('POST /api/savings/transfer — handleBudgetToPiggyBank', () => {
  it('UPDATE happy path: budget debited + piggy_bank UPDATE called', async () => {
    const { supabase, savings, piggy, loggerMod } = await importMocks()

    // FROM budget fetch
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-from', name: 'From', cumulated_savings: 100 },
      error: null,
    })
    // Debit budget RPC
    savings.updateBudgetCumulatedSavings.mockResolvedValueOnce(50)
    // Existing piggy_bank row
    supabase.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { id: 'p-1', amount: 200 },
      error: null,
    })
    // Piggy update RPC
    piggy.updatePiggyBank.mockResolvedValueOnce(250)

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        action: 'budget_to_piggy_bank',
        from_budget_id: 'b-from',
        amount: 50,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledTimes(1)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledWith('b-from', -50)
    expect(piggy.updatePiggyBank).toHaveBeenCalledTimes(1)
    expect(piggy.updatePiggyBank).toHaveBeenCalledWith({ profile_id: 'profile-1' }, 50)
    expect(loggerMod.logger.error).not.toHaveBeenCalled()
  })

  it('INSERT happy path: budget debited + piggy_bank INSERT called (no existing row)', async () => {
    const { supabase, savings, piggy, loggerMod } = await importMocks()

    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-from', name: 'From', cumulated_savings: 100 },
      error: null,
    })
    savings.updateBudgetCumulatedSavings.mockResolvedValueOnce(50)
    supabase.__mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    supabase.__mocks.insert.mockResolvedValueOnce({ error: null })

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        action: 'budget_to_piggy_bank',
        from_budget_id: 'b-from',
        amount: 50,
      }),
    )

    expect(response.status).toBe(200)
    expect(piggy.updatePiggyBank).not.toHaveBeenCalled()
    expect(supabase.__mocks.insert).toHaveBeenCalledTimes(1)
    expect(supabase.__mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ profile_id: 'profile-1', group_id: null, amount: 50 }),
    )
    expect(loggerMod.logger.error).not.toHaveBeenCalled()
  })

  it('CRITIQUE L321: piggy UPDATE fail + rollback fail → logger.error fires (regression-guard)', async () => {
    const { supabase, savings, piggy, loggerMod } = await importMocks()

    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-from', name: 'From', cumulated_savings: 100 },
      error: null,
    })
    // Debit budget succeeds
    savings.updateBudgetCumulatedSavings.mockResolvedValueOnce(50)
    // Existing piggy
    supabase.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { id: 'p-1', amount: 200 },
      error: null,
    })
    // Piggy update RPC throws
    piggy.updatePiggyBank.mockRejectedValueOnce(new Error('piggy update fail'))
    // Rollback RPC throws too
    savings.updateBudgetCumulatedSavings.mockRejectedValueOnce(new Error('rollback fail'))

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        action: 'budget_to_piggy_bank',
        from_budget_id: 'b-from',
        amount: 50,
      }),
    )

    expect(response.status).toBe(500)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledTimes(2)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenNthCalledWith(2, 'b-from', 50)
    // Regression-guard: route.ts:322 logger.error('❌ Rollback budget impossible:', ...)
    const errorMessages = loggerMod.logger.error.mock.calls.map((args) => args[0] as string)
    expect(errorMessages).toEqual(
      expect.arrayContaining([expect.stringMatching(/Rollback budget impossible/)]),
    )
  })

  it('CRITIQUE L337: piggy INSERT fail + rollback fail → logger.error fires (regression-guard)', async () => {
    const { supabase, savings, loggerMod } = await importMocks()

    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'b-from', name: 'From', cumulated_savings: 100 },
      error: null,
    })
    savings.updateBudgetCumulatedSavings.mockResolvedValueOnce(50)
    // No existing piggy
    supabase.__mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    // INSERT fails
    supabase.__mocks.insert.mockResolvedValueOnce({
      error: { message: 'simulated FK violation' },
    })
    // Rollback throws
    savings.updateBudgetCumulatedSavings.mockRejectedValueOnce(new Error('rollback fail'))

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        action: 'budget_to_piggy_bank',
        from_budget_id: 'b-from',
        amount: 50,
      }),
    )

    expect(response.status).toBe(500)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenCalledTimes(2)
    expect(savings.updateBudgetCumulatedSavings).toHaveBeenNthCalledWith(2, 'b-from', 50)
    // Regression-guard: route.ts:338 logger.error('❌ Rollback budget impossible:', ...)
    const errorMessages = loggerMod.logger.error.mock.calls.map((args) => args[0] as string)
    expect(errorMessages).toEqual(
      expect.arrayContaining([expect.stringMatching(/Rollback budget impossible/)]),
    )
  })
})
