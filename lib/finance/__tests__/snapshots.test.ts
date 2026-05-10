/**
 * Unit tests for the snapshot dispatcher — chantier I4 commit #7.
 *
 * Mocked Supabase + mocked get*FinancialData (the real ones require a
 * live DB and aren't relevant to dispatcher behavior). Pins:
 * 1. Validation: no-IDs returns false
 * 2. Validation: both-IDs returns false (mutual exclusion)
 * 3. Success path: profile dispatch inserts with profile_id
 * 4. Insert error returns false (R1 fail-soft contract)
 * 5. Group dispatch inserts with group_id
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted mocks: vi.mock is rewritten to before any import.
vi.mock('@/lib/supabase-server', () => {
  const insert = vi.fn(async () => ({ error: null }))
  const from = vi.fn(() => ({ insert }))
  return {
    supabaseServer: { from },
    // expose the spies for assertions via dynamic import
    __mocks: { insert, from },
  }
})

vi.mock('@/lib/financial-calculations', () => ({
  getProfileFinancialData: vi.fn(async () => ({
    availableBalance: 100,
    remainingToLive: 200,
    totalSavings: 50,
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

// Silence logger.error noise during validation/error tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('saveRemainingToLiveSnapshot', () => {
  it('returns false when neither profileId nor groupId is provided', async () => {
    const { saveRemainingToLiveSnapshot } = await import('@/lib/finance/snapshots')
    const result = await saveRemainingToLiveSnapshot({ reason: 'test-no-ids' })
    expect(result).toBe(false)
  })

  it('returns false when both profileId and groupId are provided (mutual exclusion)', async () => {
    const { saveRemainingToLiveSnapshot } = await import('@/lib/finance/snapshots')
    const result = await saveRemainingToLiveSnapshot({
      profileId: 'p-1',
      groupId: 'g-1',
      reason: 'test-both-ids',
    })
    expect(result).toBe(false)
  })

  it('returns true and inserts a snapshot row with profile_id when profileId is provided', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> }
    }
    const { saveRemainingToLiveSnapshot } = await import('@/lib/finance/snapshots')
    const result = await saveRemainingToLiveSnapshot({
      profileId: 'p-success',
      reason: 'planning-update',
    })
    expect(result).toBe(true)
    expect(supabaseMock.__mocks.from).toHaveBeenCalledWith('remaining_to_live_snapshots')
    expect(supabaseMock.__mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: 'p-success',
        group_id: null,
        remaining_to_live: 200,
        snapshot_reason: 'planning-update',
      }),
    )
  })

  it('returns false when the insert errors out (R1 fail-soft contract — never throws)', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> }
    }
    supabaseMock.__mocks.insert.mockResolvedValueOnce({
      error: { message: 'simulated insert failure', code: '23505' },
    })
    const { saveRemainingToLiveSnapshot } = await import('@/lib/finance/snapshots')
    const result = await saveRemainingToLiveSnapshot({
      profileId: 'p-error',
      reason: 'will-fail',
    })
    expect(result).toBe(false)
  })

  it('routes to group inserter and uses group_id when groupId is provided', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as {
      __mocks: { insert: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> }
    }
    const { saveRemainingToLiveSnapshot } = await import('@/lib/finance/snapshots')
    const result = await saveRemainingToLiveSnapshot({
      groupId: 'g-success',
      reason: 'group-planning-update',
    })
    expect(result).toBe(true)
    expect(supabaseMock.__mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: null,
        group_id: 'g-success',
        remaining_to_live: 1500,
        snapshot_reason: 'group-planning-update',
      }),
    )
  })
})
