/**
 * Integration tests for POST /api/monthly-recap/advance-step (Sprint 11).
 * Gated by `SUPABASE_RECAP_TESTS=1`.
 *
 * Covers the 5 outcome shapes the route maps :
 *   - happy summary → manage_bilan : 200 + persisted current_step + summary reload
 *   - invalid_transition (welcome → welcome) : 400
 *   - stale_step (client says from=welcome, server has summary) : 409
 *   - not_initiator (group recap started by someone else) : 403
 *   - no_active_recap (no row for this period) : 404
 */

import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/database.types'

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

interface MockedAuth {
  userId: string
  groupId: string | null
}
const mockedAuth: MockedAuth = { userId: '', groupId: null }

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndProfile: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, {
        userId: mockedAuth.userId,
        profile: {
          id: mockedAuth.userId,
          group_id: mockedAuth.groupId,
          first_name: 'Test',
          last_name: 'User',
        },
      }),
    withAuth: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, { userId: mockedAuth.userId }),
  }
})

describe.skipIf(!ENABLED)('POST /api/monthly-recap/advance-step (gated)', () => {
  let admin: SupabaseClient<Database>
  let POST: (req: NextRequest) => Promise<Response>

  let userAId: string
  let userBId: string
  let groupAId: string

  const stamp = Date.now()
  const emailA = `recap-adv-a-${stamp}@popoth.test`
  const emailB = `recap-adv-b-${stamp}@popoth.test`

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Recap advance-step tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    const mod = await import('@/app/api/monthly-recap/advance-step/route')
    POST = mod.POST as (req: NextRequest) => Promise<Response>

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const [a, b] = await Promise.all([
      admin.auth.admin.createUser({ email: emailA, password: randomUUID(), email_confirm: true }),
      admin.auth.admin.createUser({ email: emailB, password: randomUUID(), email_confirm: true }),
    ])
    if (a.error || !a.data.user) throw a.error
    if (b.error || !b.data.user) throw b.error
    userAId = a.data.user.id
    userBId = b.data.user.id

    const { data: group, error: groupError } = await admin
      .from('groups')
      .insert({
        name: `recap-adv-group-${stamp}`,
        monthly_budget_estimate: 0,
        creator_id: userAId,
      })
      .select('id')
      .single()
    if (groupError || !group) throw groupError ?? new Error('group insert returned no row')
    groupAId = group.id

    const { error: profilesError } = await admin.from('profiles').upsert(
      [
        { id: userAId, first_name: 'Alice', last_name: 'Aaaa', group_id: groupAId },
        { id: userBId, first_name: 'Bob', last_name: 'Bbbb', group_id: groupAId },
      ],
      { onConflict: 'id' },
    )
    if (profilesError) throw profilesError
  })

  afterEach(async () => {
    await resetState()
  })

  afterAll(async () => {
    if (admin) {
      await resetState()
      if (groupAId) await admin.from('groups').delete().eq('id', groupAId)
      if (userAId) await admin.from('profiles').update({ group_id: null }).eq('id', userAId)
      if (userBId) await admin.from('profiles').update({ group_id: null }).eq('id', userBId)
      if (userAId) await admin.auth.admin.deleteUser(userAId)
      if (userBId) await admin.auth.admin.deleteUser(userBId)
    }
  })

  async function resetState() {
    if (userAId) {
      await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
      await admin.from('estimated_budgets').delete().eq('profile_id', userAId)
      await admin.from('piggy_bank').delete().eq('profile_id', userAId)
    }
    if (groupAId) {
      await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
      await admin.from('estimated_budgets').delete().eq('group_id', groupAId)
      await admin.from('piggy_bank').delete().eq('group_id', groupAId)
    }
  }

  function buildRequest(body: unknown): NextRequest {
    return new Request('http://localhost/api/monthly-recap/advance-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  }

  async function seedRecap(args: {
    ownerKind: 'profile' | 'group'
    currentStep?: string
    startedBy?: string
  }): Promise<{ id: string }> {
    const base = {
      recap_month: currentMonth,
      recap_year: currentYear,
      current_step: args.currentStep ?? 'summary',
      started_by_profile_id: args.startedBy ?? userAId,
      started_at: new Date().toISOString(),
      completed_at: null,
    }
    const payload: Database['public']['Tables']['monthly_recaps']['Insert'] =
      args.ownerKind === 'profile'
        ? { profile_id: userAId, ...base }
        : { group_id: groupAId, ...base }
    const { data, error } = await admin.from('monthly_recaps').insert(payload).select('id').single()
    if (error || !data) throw error ?? new Error('recap insert returned no row')
    return data
  }

  it('happy summary → manage_bilan: persists step and returns fresh summary', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile', currentStep: 'summary' })

    const response = await POST(
      buildRequest({ context: 'profile', fromStep: 'summary', toStep: 'manage_bilan' }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        recap: { id: string; current_step: string }
        summary: { bilan: number; bilanSign: string }
      }
    }
    expect(body.data.recap.current_step).toBe('manage_bilan')
    expect(typeof body.data.summary.bilan).toBe('number')
    expect(['positive', 'negative', 'zero']).toContain(body.data.summary.bilanSign)

    // Verify DB persistence
    const { data: recap } = await admin
      .from('monthly_recaps')
      .select('current_step')
      .eq('profile_id', userAId)
      .single()
    expect(recap?.current_step).toBe('manage_bilan')
  })

  it('happy welcome → summary (most common transition from WelcomeStep)', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile', currentStep: 'welcome' })

    const response = await POST(
      buildRequest({ context: 'profile', fromStep: 'welcome', toStep: 'summary' }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { recap: { current_step: string } } }
    expect(body.data.recap.current_step).toBe('summary')
  })

  it('invalid_transition: same step (welcome → welcome) returns 400', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile', currentStep: 'welcome' })

    const response = await POST(
      buildRequest({ context: 'profile', fromStep: 'welcome', toStep: 'welcome' }),
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid_transition')
  })

  it('stale_step: client claims from=welcome but server has summary → 409', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile', currentStep: 'summary' })

    const response = await POST(
      buildRequest({ context: 'profile', fromStep: 'welcome', toStep: 'summary' }),
    )
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; currentStep: string }
    expect(body.error).toBe('stale_step')
    expect(body.currentStep).toBe('summary')
  })

  it('not_initiator: group recap started by another → 403', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'group', currentStep: 'summary', startedBy: userBId })

    const response = await POST(
      buildRequest({ context: 'group', fromStep: 'summary', toStep: 'manage_bilan' }),
    )
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('not_initiator')
  })

  it('no_active_recap: no row for this period → 404', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    // No seedRecap call — state already clean from afterEach.

    const response = await POST(
      buildRequest({ context: 'profile', fromStep: 'welcome', toStep: 'summary' }),
    )
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('no_active_recap')
  })
})
