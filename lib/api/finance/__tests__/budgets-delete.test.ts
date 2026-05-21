/**
 * Mocked unit tests for DELETE /api/finance/budgets (route handler in
 * lib/api/finance/budgets.ts:DELETE).
 *
 * Sprint Delete-Budget-Savings-Transfer — the handler now reads the
 * budget row to determine the context (profile/group), then delegates
 * to the composite atomic RPC `delete_budget_with_savings_transfer`
 * via `deleteBudgetWithSavingsTransfer` from @/lib/finance/savings.
 * The response shape gained `transferredAmount` + `piggyAmount` so the
 * UI can show a snackbar when economies were forwarded to the piggy.
 *
 * Mock strategy mirrors lib/api/finance/__tests__/expenses-add-with-logic.test.ts.
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

vi.mock('@/lib/supabase-server', () => {
  const single = vi.fn(async () => ({ data: null, error: null }))
  const maybeSingle = vi.fn(async () => ({ data: null, error: null }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chain mock matches existing budgets-add pattern
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.or = vi.fn(() => chain)
  chain.single = single
  chain.maybeSingle = maybeSingle
  const from = vi.fn(() => chain)
  return {
    supabaseServer: { from },
    __mocks: { from, single, maybeSingle },
  }
})

vi.mock('@/lib/finance', () => ({
  asContextFilter: vi.fn(({ profile_id, group_id }) => {
    if (group_id) return { group_id }
    if (profile_id) return { profile_id }
    throw new Error('Filter must contain either profile_id or group_id')
  }),
  saveRemainingToLiveSnapshot: vi.fn(async () => true),
}))

vi.mock('@/lib/finance/savings', () => ({
  deleteBudgetWithSavingsTransfer: vi.fn(async () => ({
    transferred_amount: 0,
    piggy_amount: null,
  })),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// Test helpers ---------------------------------------------------------------

function buildDeleteRequest(budgetId: string): NextRequest {
  return {
    url: `http://localhost/api/finance/budgets?id=${budgetId}`,
  } as unknown as NextRequest
}

type SupabaseMocks = {
  __mocks: {
    from: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
  }
}

type FinanceMocks = { saveRemainingToLiveSnapshot: ReturnType<typeof vi.fn> }
type SavingsMocks = { deleteBudgetWithSavingsTransfer: ReturnType<typeof vi.fn> }
type LoggerMocks = { logger: { error: ReturnType<typeof vi.fn> } }

async function importMocks() {
  const supabase = (await import('@/lib/supabase-server')) as unknown as SupabaseMocks
  const financeMod = (await import('@/lib/finance')) as unknown as FinanceMocks
  const savingsMod = (await import('@/lib/finance/savings')) as unknown as SavingsMocks
  const loggerMod = (await import('@/lib/logger')) as unknown as LoggerMocks
  return { supabase, financeMod, savingsMod, loggerMod }
}

// Tests ----------------------------------------------------------------------

describe('DELETE /api/finance/budgets — composite atomic deletion', () => {
  const BUDGET_ID = '11111111-1111-4111-8111-111111111111'

  it('happy with savings: RPC called, response includes transferredAmount + piggyAmount', async () => {
    const { supabase, savingsMod, financeMod } = await importMocks()

    // budget ownership lookup returns a profile-owned row with savings
    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: BUDGET_ID,
        profile_id: 'user-1',
        group_id: null,
        cumulated_savings: 47.5,
      },
      error: null,
    })
    savingsMod.deleteBudgetWithSavingsTransfer.mockResolvedValueOnce({
      transferred_amount: 47.5,
      piggy_amount: 67.5,
    })

    const { DELETE } = await import('@/lib/api/finance/budgets')
    const response = await DELETE(buildDeleteRequest(BUDGET_ID))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.transferredAmount).toBe(47.5)
    expect(json.piggyAmount).toBe(67.5)
    expect(savingsMod.deleteBudgetWithSavingsTransfer).toHaveBeenCalledTimes(1)
    expect(savingsMod.deleteBudgetWithSavingsTransfer).toHaveBeenCalledWith(
      { profile_id: 'user-1' },
      { budgetId: BUDGET_ID },
    )
    expect(financeMod.saveRemainingToLiveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'budget_deleted' }),
    )
  })

  it('happy without savings: RPC called with cumulated_savings=0, response transferredAmount=0', async () => {
    const { supabase, savingsMod } = await importMocks()

    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: BUDGET_ID,
        profile_id: 'user-1',
        group_id: null,
        cumulated_savings: 0,
      },
      error: null,
    })
    savingsMod.deleteBudgetWithSavingsTransfer.mockResolvedValueOnce({
      transferred_amount: 0,
      piggy_amount: null,
    })

    const { DELETE } = await import('@/lib/api/finance/budgets')
    const response = await DELETE(buildDeleteRequest(BUDGET_ID))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.transferredAmount).toBe(0)
    expect(json.piggyAmount).toBeNull()
    expect(savingsMod.deleteBudgetWithSavingsTransfer).toHaveBeenCalledTimes(1)
  })

  it('not found: ownership lookup returns null → 404, RPC not called', async () => {
    const { supabase, savingsMod, financeMod } = await importMocks()

    // ownership lookup returns null (budget either does not exist or
    // belongs to another user / group)
    supabase.__mocks.single.mockResolvedValueOnce({ data: null, error: null })

    const { DELETE } = await import('@/lib/api/finance/budgets')
    const response = await DELETE(buildDeleteRequest(BUDGET_ID))
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json.error).toMatch(/non trouvé|accès non autorisé/i)
    expect(savingsMod.deleteBudgetWithSavingsTransfer).not.toHaveBeenCalled()
    expect(financeMod.saveRemainingToLiveSnapshot).not.toHaveBeenCalled()
  })

  it('RPC throws: 500 + logger.error fired, snapshot not saved', async () => {
    const { supabase, savingsMod, financeMod, loggerMod } = await importMocks()

    supabase.__mocks.single.mockResolvedValueOnce({
      data: {
        id: BUDGET_ID,
        profile_id: 'user-1',
        group_id: null,
        cumulated_savings: 30,
      },
      error: null,
    })
    savingsMod.deleteBudgetWithSavingsTransfer.mockRejectedValueOnce(
      new Error('Budget not found or not owned by the given context'),
    )

    const { DELETE } = await import('@/lib/api/finance/budgets')
    const response = await DELETE(buildDeleteRequest(BUDGET_ID))

    expect(response.status).toBe(500)
    expect(savingsMod.deleteBudgetWithSavingsTransfer).toHaveBeenCalledTimes(1)
    expect(financeMod.saveRemainingToLiveSnapshot).not.toHaveBeenCalled()
    expect(loggerMod.logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/suppression du budget/i),
      expect.any(Error),
    )
  })
})
