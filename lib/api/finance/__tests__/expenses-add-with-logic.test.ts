/**
 * Mocked unit tests for POST /api/finance/expenses/add-with-logic.
 *
 * Sprint Auto-Cascade-Piggy (2026-05-25) — la route a basculé sur
 * `calculateBreakdownWithAutoCascade` (piggy-first + proportionnel quand
 * overflow > 0) au lieu de `calculateBreakdown` legacy. Le dispatch RPC
 * suit : piggy > 0 ou cross_budget_debits non vide → composite RPC
 * `add_expense_with_cross_budget_cascade` ; sinon → `add_expense_with_breakdown`.
 *
 * `calculateBreakdownWithAutoCascade` est gardée REAL (pure-sync). Les
 * helpers RPC sont mockés. `addExpenseWithBreakdown` et
 * `addExpenseWithCrossBudgetCascade` ont chacune leur entry point selon
 * la présence de piggy/cross debits.
 */

import type { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@/lib/supabase-server', () => {
  const single = vi.fn(async () => ({ data: null, error: null }))
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  const matchAwait = vi.fn(async () => ({ data: [], error: null }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chain is intentionally thenable + chainable
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.neq = vi.fn(() => chain)
  chain.gt = vi.fn(() => chain)
  chain.match = vi.fn(() => chain)
  chain.insert = vi.fn(() => chain)
  chain.single = single
  chain.maybeSingle = maybeSingle
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
  addExpenseWithCrossBudgetCascade: vi.fn(async () => ({
    expense_id: 'rx-mock-cascade',
    cross_budget_total: 0,
    consolidated_savings: 0,
  })),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

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

type ExpensesMocks = {
  addExpenseWithBreakdown: ReturnType<typeof vi.fn>
  addExpenseWithCrossBudgetCascade: ReturnType<typeof vi.fn>
}
type LoggerMocks = { logger: { error: ReturnType<typeof vi.fn> } }

async function importMocks() {
  const supabase = (await import('@/lib/supabase-server')) as unknown as SupabaseMocks
  const expensesMod = (await import('@/lib/finance/expenses')) as unknown as ExpensesMocks
  const loggerMod = (await import('@/lib/logger')) as unknown as LoggerMocks
  return { supabase, expensesMod, loggerMod }
}

describe('POST /api/finance/expenses/add-with-logic — auto-cascade', () => {
  it('happy path no overflow: amount fits budget → addExpenseWithBreakdown, piggy untouched', async () => {
    const { supabase, expensesMod, loggerMod } = await importMocks()

    supabase.__mocks.maybeSingle.mockResolvedValueOnce({ data: { amount: 100 }, error: null })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Budget 1',
        estimated_amount: 200,
        cumulated_savings: 30,
      },
      error: null,
    })
    // real_expenses listing (no existing expenses)
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    // other budgets listing (no other budgets with savings)
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    expensesMod.addExpenseWithBreakdown.mockResolvedValueOnce({ expense_id: 'rx-1' })
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
      from_piggy_bank: 0,
      from_budget_savings: 0,
      from_budget: 150,
    })
    expect(expensesMod.addExpenseWithBreakdown).toHaveBeenCalledTimes(1)
    expect(expensesMod.addExpenseWithCrossBudgetCascade).not.toHaveBeenCalled()
    expect(loggerMod.logger.error).not.toHaveBeenCalled()
  })

  it('overflow with piggy auto-cascade: piggy covers entirely → addExpenseWithCrossBudgetCascade', async () => {
    const { supabase, expensesMod } = await importMocks()

    supabase.__mocks.maybeSingle.mockResolvedValueOnce({ data: { amount: 100 }, error: null })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Budget 1',
        estimated_amount: 200,
        cumulated_savings: 30,
      },
      error: null,
    })
    // real_expenses listing — 180 already spent → budgetRemaining=20
    supabase.__mocks.matchAwait.mockResolvedValueOnce({
      data: [{ amount: 180, amount_from_budget: 180 }],
      error: null,
    })
    // other budgets listing (empty — piggy alone will cover)
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    expensesMod.addExpenseWithCrossBudgetCascade.mockResolvedValueOnce({
      expense_id: 'rx-2',
      cross_budget_total: 0,
      consolidated_savings: 30,
    })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'rx-2', amount: 150, description: 'L', estimated_budget: { name: 'Budget 1' } },
      error: null,
    })

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    // amount=150, budgetRemaining=20, savings=30, piggy=100, others=[]
    // P4 strict local: budget=20 + savings=30 → overflow=100
    // Auto-cascade: piggy=min(100,100)=100, remaining=0 → fromBudget stays at 20
    const response = await POST(
      buildRequest({
        amount: 150,
        description: 'L',
        estimated_budget_id: '11111111-1111-4111-8111-111111111111',
        is_for_group: false,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.breakdown).toMatchObject({
      from_piggy_bank: 100,
      from_budget_savings: 30,
      from_budget: 20,
    })
    expect(expensesMod.addExpenseWithCrossBudgetCascade).toHaveBeenCalledWith(
      { profile_id: 'user-1' },
      expect.objectContaining({
        amount: 150,
        amountFromPiggyBank: 100,
        amountFromLocalSavings: 30,
        amountFromBudget: 20,
        crossBudgetDebits: [],
        createdByProfileId: 'user-1',
      }),
    )
    expect(expensesMod.addExpenseWithBreakdown).not.toHaveBeenCalled()
  })

  it('overflow with piggy partial + cross-budget proportional cascade', async () => {
    const { supabase, expensesMod } = await importMocks()

    supabase.__mocks.maybeSingle.mockResolvedValueOnce({ data: { amount: 50 }, error: null })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Loyer',
        estimated_amount: 800,
        cumulated_savings: 0,
      },
      error: null,
    })
    // 800 already spent → budgetRemaining=0
    supabase.__mocks.matchAwait.mockResolvedValueOnce({
      data: [{ amount: 800, amount_from_budget: 800 }],
      error: null,
    })
    // other budgets: Courses 100€, Loisirs 200€
    supabase.__mocks.matchAwait.mockResolvedValueOnce({
      data: [
        { id: 'b-courses', cumulated_savings: 100 },
        { id: 'b-loisirs', cumulated_savings: 200 },
      ],
      error: null,
    })
    expensesMod.addExpenseWithCrossBudgetCascade.mockResolvedValueOnce({
      expense_id: 'rx-3',
      cross_budget_total: 100,
      consolidated_savings: 100,
    })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'rx-3', amount: 150, description: 'L', estimated_budget: { name: 'Loyer' } },
      error: null,
    })

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    // amount=150, budgetRemaining=0, savings=0, piggy=50, others=[100,200]
    // Local: overflow=150
    // Piggy: 50 used, remaining=100
    // Cross proportional sum 300 → toAllocate=100 :
    //   Courses 100*100/300=33.33, Loisirs 100*200/300=66.67
    const response = await POST(
      buildRequest({
        amount: 150,
        description: 'L',
        estimated_budget_id: '11111111-1111-4111-8111-111111111111',
        is_for_group: false,
      }),
    )

    expect(response.status).toBe(200)
    expect(expensesMod.addExpenseWithCrossBudgetCascade).toHaveBeenCalledWith(
      { profile_id: 'user-1' },
      expect.objectContaining({
        amount: 150,
        amountFromPiggyBank: 50,
        amountFromLocalSavings: 0,
        amountFromBudget: 0,
        crossBudgetDebits: [
          { budget_id: 'b-courses', amount: 33.33 },
          { budget_id: 'b-loisirs', amount: 66.67 },
        ],
      }),
    )
  })

  it('overflow with no piggy and no cross sources → residual absorbed as fromBudget (deficit)', async () => {
    const { supabase, expensesMod } = await importMocks()

    supabase.__mocks.maybeSingle.mockResolvedValueOnce({ data: { amount: 0 }, error: null })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Budget',
        estimated_amount: 100,
        cumulated_savings: 0,
      },
      error: null,
    })
    supabase.__mocks.matchAwait.mockResolvedValueOnce({
      data: [{ amount: 100, amount_from_budget: 100 }],
      error: null,
    })
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    expensesMod.addExpenseWithBreakdown.mockResolvedValueOnce({ expense_id: 'rx-4' })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'rx-4', amount: 50, description: 'X', estimated_budget: { name: 'Budget' } },
      error: null,
    })

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    const response = await POST(
      buildRequest({
        amount: 50,
        description: 'X',
        estimated_budget_id: '11111111-1111-4111-8111-111111111111',
        is_for_group: false,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.breakdown).toMatchObject({
      from_piggy_bank: 0,
      from_budget_savings: 0,
      from_budget: 50,
    })
    // No piggy, no cross → addExpenseWithBreakdown (legacy single-budget path)
    expect(expensesMod.addExpenseWithBreakdown).toHaveBeenCalledTimes(1)
    expect(expensesMod.addExpenseWithCrossBudgetCascade).not.toHaveBeenCalled()
  })

  it('P5 toggle use_savings=true: savings consumed first, no overflow → addExpenseWithBreakdown', async () => {
    const { supabase, expensesMod } = await importMocks()

    supabase.__mocks.maybeSingle.mockResolvedValueOnce({ data: { amount: 100 }, error: null })
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
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    expensesMod.addExpenseWithBreakdown.mockResolvedValueOnce({ expense_id: 'rx-5' })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'rx-5', amount: 100, description: 'L', estimated_budget: { name: 'B' } },
      error: null,
    })

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    const response = await POST(
      buildRequest({
        amount: 100,
        description: 'L',
        estimated_budget_id: '11111111-1111-4111-8111-111111111111',
        is_for_group: false,
        use_savings: true,
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.breakdown).toMatchObject({
      from_piggy_bank: 0,
      from_budget_savings: 30,
      from_budget: 70,
    })
    expect(expensesMod.addExpenseWithBreakdown).toHaveBeenCalledWith(
      { profile_id: 'user-1' },
      expect.objectContaining({
        amountFromPiggyBank: 0,
        amountFromBudgetSavings: 30,
        amountFromBudget: 70,
      }),
    )
  })

  it('PIN ATOMIC CONTRACT: piggy>0 or cross>0 → cross-budget RPC is single entry; no breakdown RPC', async () => {
    const { supabase, expensesMod, loggerMod } = await importMocks()

    supabase.__mocks.maybeSingle.mockResolvedValueOnce({ data: { amount: 100 }, error: null })
    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Budget',
        estimated_amount: 100,
        cumulated_savings: 0,
      },
      error: null,
    })
    supabase.__mocks.matchAwait.mockResolvedValueOnce({
      data: [{ amount: 100, amount_from_budget: 100 }],
      error: null,
    })
    supabase.__mocks.matchAwait.mockResolvedValueOnce({ data: [], error: null })
    expensesMod.addExpenseWithCrossBudgetCascade.mockRejectedValueOnce(
      new Error('piggy_bank amount cannot become negative'),
    )

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    const response = await POST(
      buildRequest({
        amount: 50,
        description: 'L',
        estimated_budget_id: '11111111-1111-4111-8111-111111111111',
        is_for_group: false,
      }),
    )

    expect(response.status).toBe(500)
    // piggy=100, overflow=50 → cross-budget RPC chosen (piggy debit needs the
    // cascade RPC which accepts p_amount_from_piggy_bank > 0).
    expect(expensesMod.addExpenseWithCrossBudgetCascade).toHaveBeenCalledTimes(1)
    expect(expensesMod.addExpenseWithBreakdown).not.toHaveBeenCalled()
    expect(supabase.__mocks.insert).not.toHaveBeenCalled()
    const errorMessages = loggerMod.logger.error.mock.calls.map((args) => args[0] as string)
    expect(errorMessages.filter((m) => /atomique/.test(m))).toHaveLength(1)
  })

  it('exceptional path (no estimated_budget_id): single INSERT, no cascade RPC', async () => {
    const { supabase, expensesMod } = await importMocks()

    supabase.__mocks.single.mockResolvedValueOnce({
      data: { id: 'rx-exceptional', amount: 50, description: 'Coffee', is_exceptional: true },
      error: null,
    })

    const { POST } = await import('@/lib/api/finance/expenses-add-with-logic')
    const response = await POST(
      buildRequest({ amount: 50, description: 'Coffee', is_for_group: false }),
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.breakdown).toBeNull()
    expect(json.real_expense).toBeDefined()
    expect(supabase.__mocks.insert).toHaveBeenCalledTimes(1)
    expect(supabase.__mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50, is_exceptional: true }),
    )
    expect(expensesMod.addExpenseWithBreakdown).not.toHaveBeenCalled()
    expect(expensesMod.addExpenseWithCrossBudgetCascade).not.toHaveBeenCalled()
  })
})
