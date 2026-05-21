/**
 * Mocked unit tests for POST /api/bank-balance.
 *
 * Sprint P7 adds a creator-only authz check on the group context branch
 * (defense in depth — the UI bouton is hidden for non-creators via
 * `useGroups().isCreator`, but the API must also gate).
 *
 * Cases:
 *  1. group + creator → 200 happy path (UPDATE existing)
 *  2. group + non-creator → 403 'Action réservée au créateur du groupe'
 *  3. profile context → unchanged behavior (no creator check fires)
 *
 * Mock strategy mirror app/api/savings/transfer/__tests__/route.test.ts:
 * passthrough withAuth, spy-friendly logger, chain supabase with
 * queueable single() / insert() per .from() call sequence.
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
        profile: { id: 'profile-1', group_id: null, first_name: 'T', last_name: 'U' },
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
  const insert = vi.fn(() => chain)
  type Chain = {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    match: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    insert: typeof insert
    single: typeof single
  }
  const chain: Chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    match: vi.fn(() => chain),
    update: vi.fn(() => chain),
    insert,
    single,
  }
  const from = vi.fn(() => chain)
  return {
    supabaseServer: { from },
    __mocks: { from, single, insert },
  }
})

// Helpers ---------------------------------------------------------------------

type SupabaseMocks = {
  from: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
}

async function getMocks(): Promise<SupabaseMocks> {
  const mod = (await import('@/lib/supabase-server')) as unknown as {
    __mocks: SupabaseMocks
  }
  return mod.__mocks
}

function buildPostRequest(context: 'group' | 'profile' | null, balance: number): NextRequest {
  const url =
    context === null
      ? 'http://localhost/api/bank-balance'
      : `http://localhost/api/bank-balance?context=${context}`
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify({ balance }),
    headers: { 'Content-Type': 'application/json' },
  }) as unknown as NextRequest
}

// Tests -----------------------------------------------------------------------

describe('POST /api/bank-balance — creator-only on group context (Sprint P7)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 when group creator updates the group balance', async () => {
    const mocks = await getMocks()
    // single() call sequence : profile.group_id → groups.creator_id → checkQuery → update.select
    mocks.single
      .mockResolvedValueOnce({ data: { group_id: 'g1' }, error: null })
      .mockResolvedValueOnce({ data: { creator_id: 'user-1' }, error: null })
      .mockResolvedValueOnce({ data: { id: 'bb1' }, error: null })
      .mockResolvedValueOnce({ data: { balance: 1500 }, error: null })

    const { POST } = await import('../route')
    const response = await POST(buildPostRequest('group', 1500))

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.balance).toBe(1500)
    expect(json.message).toMatch(/mis à jour/i)
  })

  it('returns 403 when a non-creator member tries to update the group balance', async () => {
    const mocks = await getMocks()
    // single() call sequence stops at groups.creator_id mismatch
    mocks.single
      .mockResolvedValueOnce({ data: { group_id: 'g1' }, error: null })
      .mockResolvedValueOnce({ data: { creator_id: 'other-user' }, error: null })

    const { POST } = await import('../route')
    const response = await POST(buildPostRequest('group', 1500))

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.error).toMatch(/créateur du groupe/i)
    // Confirm no INSERT / UPDATE fired — handler returned before reaching writes
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('does not fire the creator check for profile context (unchanged behavior)', async () => {
    const mocks = await getMocks()
    // single() call sequence : checkQuery → update.select (no group fetch)
    mocks.single
      .mockResolvedValueOnce({ data: { id: 'bb1' }, error: null })
      .mockResolvedValueOnce({ data: { balance: 800 }, error: null })

    const { POST } = await import('../route')
    const response = await POST(buildPostRequest('profile', 800))

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.balance).toBe(800)
    // 0 calls to .from('groups') — the creator check guard never fires for profile context
    const groupsCalls = mocks.from.mock.calls.filter((call) => call[0] === 'groups')
    expect(groupsCalls).toHaveLength(0)
  })
})
