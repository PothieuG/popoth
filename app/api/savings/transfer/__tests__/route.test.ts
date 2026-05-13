/**
 * Mocked unit tests for POST /api/savings/transfer — rewritten in
 * Sprint Atomicity-Savings to mirror the new atomic surface.
 *
 * Pre-fix (Sprint Refactor-Test-Coverage): 8 cases regression-guarded
 * the 3 cleanup-attempts at L122/L321/L337 — manual compensating
 * rollbacks that could themselves fail.
 *
 * Post-fix: the 3 cleanup-attempts no longer exist in the route. Both
 * budget→budget and budget→piggy paths funnel through a single atomic
 * helper from @/lib/finance/savings. The 4 cases below pin the
 * architectural invariant (single mutation entry point, no manual
 * UPDATE/INSERT on piggy_bank in the handler). The atomicity proof
 * itself moves to the gated tests at
 * lib/finance/__tests__/transfer-savings.test.ts (8 cases against prod).
 *
 * Mock strategy: passthrough wrapper for withAuthAndProfile, then
 * dynamic `await import` of the SUT inside test bodies. @/lib/logger is
 * mocked directly. @/lib/finance/savings mocks the 2 new helpers;
 * piggy-bank kept mocked because handlePiggyBankAction (out of scope)
 * still calls updatePiggyBank.
 */

import type { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks ---------------------------------------------------------------

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

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

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

vi.mock('@/lib/finance/savings', () => ({
  transferSavingsBetweenBudgets: vi.fn(async () => ({ from_savings: 0, to_savings: 0 })),
  transferBudgetToPiggyBank: vi.fn(async () => ({ from_savings: 0, piggy_bank_amount: 0 })),
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

type SavingsMocks = {
  transferSavingsBetweenBudgets: ReturnType<typeof vi.fn>
  transferBudgetToPiggyBank: ReturnType<typeof vi.fn>
}
type PiggyMocks = { updatePiggyBank: ReturnType<typeof vi.fn> }
type LoggerMocks = { logger: { error: ReturnType<typeof vi.fn> } }

async function importMocks() {
  const supabase = (await import('@/lib/supabase-server')) as unknown as SupabaseMocks
  const savings = (await import('@/lib/finance/savings')) as unknown as SavingsMocks
  const piggy = (await import('@/lib/finance/piggy-bank')) as unknown as PiggyMocks
  const loggerMod = (await import('@/lib/logger')) as unknown as LoggerMocks
  return { supabase, savings, piggy, loggerMod }
}

// Tests ----------------------------------------------------------------------

describe('POST /api/savings/transfer — budget→budget', () => {
  it('happy path: single atomic helper call, returns 200', async () => {
    const { supabase, savings, loggerMod } = await importMocks()

    // FROM budget fetch
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: '11111111-1111-4111-8111-111111111111', name: 'From', estimated_amount: 200, cumulated_savings: 100 },
      error: null,
    })
    // TO budget fetch
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: '22222222-2222-4222-8222-222222222222', name: 'To', estimated_amount: 300, cumulated_savings: 50 },
      error: null,
    })
    savings.transferSavingsBetweenBudgets.mockResolvedValueOnce({
      from_savings: 70,
      to_savings: 80,
    })

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        from_budget_id: '11111111-1111-4111-8111-111111111111',
        to_budget_id: '22222222-2222-4222-8222-222222222222',
        amount: 30,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.from.new_savings).toBe(70)
    expect(json.to.new_savings).toBe(80)
    expect(savings.transferSavingsBetweenBudgets).toHaveBeenCalledTimes(1)
    expect(savings.transferSavingsBetweenBudgets).toHaveBeenCalledWith(
      { profile_id: 'profile-1' },
      { fromBudgetId: '11111111-1111-4111-8111-111111111111', toBudgetId: '22222222-2222-4222-8222-222222222222', amount: 30 },
    )
    expect(loggerMod.logger.error).not.toHaveBeenCalled()
  })

  it('PIN ATOMIC CONTRACT: single call site, no compensating rollback on failure', async () => {
    // PIN — pre-Sprint Atomicity-Savings (Sprint Refactor-Test-Coverage),
    // 4 cases regression-guarded 2 separate updateBudgetCumulatedSavings
    // calls + a manual rollback at L122 that could itself fail. This
    // case pins the architectural invariant of the post-fix route:
    //   1. Exactly ONE call to transferSavingsBetweenBudgets (composite RPC)
    //   2. Status 500 propagates the throw
    //   3. logger.error fires with the new generic message
    //   4. No manual UPDATE on estimated_budgets — atomicity is enforced
    //      by Postgres tx, proven by the gated tests against prod.
    const { supabase, savings, loggerMod } = await importMocks()

    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: '11111111-1111-4111-8111-111111111111', name: 'From', estimated_amount: 200, cumulated_savings: 100 },
      error: null,
    })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: '22222222-2222-4222-8222-222222222222', name: 'To', estimated_amount: 300, cumulated_savings: 50 },
      error: null,
    })
    savings.transferSavingsBetweenBudgets.mockRejectedValueOnce(new Error('atomic RPC fail'))

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        from_budget_id: '11111111-1111-4111-8111-111111111111',
        to_budget_id: '22222222-2222-4222-8222-222222222222',
        amount: 30,
      }),
    )

    expect(response.status).toBe(500)
    // ATOMIC INVARIANT — single call site, no rollback ceremony
    expect(savings.transferSavingsBetweenBudgets).toHaveBeenCalledTimes(1)
    const errorMessages = loggerMod.logger.error.mock.calls.map((args) => args[0] as string)
    expect(errorMessages).toEqual(
      expect.arrayContaining([expect.stringMatching(/Erreur transfert entre budgets/)]),
    )
    // Old L122 rollback log must NOT fire (cleanup-attempt is gone)
    expect(errorMessages).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/Erreur rollback budget source/)]),
    )
  })
})

describe('POST /api/savings/transfer — handleBudgetToPiggyBank', () => {
  it('happy path: single atomic helper call, no manual UPDATE/INSERT', async () => {
    const { supabase, savings, piggy, loggerMod } = await importMocks()

    // FROM budget fetch
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: '11111111-1111-4111-8111-111111111111', name: 'From', cumulated_savings: 100 },
      error: null,
    })
    // Pre-state piggy fetch (for response shape)
    supabase.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 200 },
      error: null,
    })
    savings.transferBudgetToPiggyBank.mockResolvedValueOnce({
      from_savings: 50,
      piggy_bank_amount: 250,
    })

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        action: 'budget_to_piggy_bank',
        from_budget_id: '11111111-1111-4111-8111-111111111111',
        amount: 50,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.from_budget.new_savings).toBe(50)
    expect(json.piggy_bank.old_amount).toBe(200)
    expect(json.piggy_bank.new_amount).toBe(250)
    expect(savings.transferBudgetToPiggyBank).toHaveBeenCalledTimes(1)
    expect(savings.transferBudgetToPiggyBank).toHaveBeenCalledWith(
      { profile_id: 'profile-1' },
      { fromBudgetId: '11111111-1111-4111-8111-111111111111', amount: 50 },
    )
    // Encapsulated inside the composite RPC — handler does NOT touch
    // piggy_bank directly anymore.
    expect(piggy.updatePiggyBank).not.toHaveBeenCalled()
    expect(supabase.__mocks.insert).not.toHaveBeenCalled()
    expect(loggerMod.logger.error).not.toHaveBeenCalled()
  })

  it('PIN ATOMIC CONTRACT: single call site, no manual UPDATE/INSERT on failure', async () => {
    // PIN — pre-Sprint Atomicity-Savings (Sprint Refactor-Test-Coverage),
    // 4 cases regression-guarded the UPDATE vs INSERT branch in the
    // handler + 2 cleanup-attempts at L321 + L337. Post-fix, both paths
    // collapse into transferBudgetToPiggyBank (UPSERT inside the RPC).
    // This case pins:
    //   1. Exactly ONE call to transferBudgetToPiggyBank
    //   2. Status 500 propagates the throw
    //   3. logger.error fires with the new generic message
    //   4. No piggy_bank.update / piggy_bank.insert in the handler —
    //      atomicity proven by gated tests.
    const { supabase, savings, piggy, loggerMod } = await importMocks()

    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: '11111111-1111-4111-8111-111111111111', name: 'From', cumulated_savings: 100 },
      error: null,
    })
    supabase.__mocks.maybeSingle.mockResolvedValueOnce({
      data: { amount: 200 },
      error: null,
    })
    savings.transferBudgetToPiggyBank.mockRejectedValueOnce(new Error('atomic RPC fail'))

    const { POST } = await import('@/app/api/savings/transfer/route')
    const response = await POST(
      buildRequest({
        context: 'profile',
        action: 'budget_to_piggy_bank',
        from_budget_id: '11111111-1111-4111-8111-111111111111',
        amount: 50,
      }),
    )

    expect(response.status).toBe(500)
    // ATOMIC INVARIANT — single call site, no compensating ceremony
    expect(savings.transferBudgetToPiggyBank).toHaveBeenCalledTimes(1)
    expect(piggy.updatePiggyBank).not.toHaveBeenCalled()
    expect(supabase.__mocks.insert).not.toHaveBeenCalled()
    const errorMessages = loggerMod.logger.error.mock.calls.map((args) => args[0] as string)
    expect(errorMessages).toEqual(
      expect.arrayContaining([expect.stringMatching(/Erreur transfert budget/)]),
    )
    // Old L321/L337 rollback logs must NOT fire (cleanup-attempts gone)
    expect(errorMessages).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/Rollback budget impossible/)]),
    )
  })
})
