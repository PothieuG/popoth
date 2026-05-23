/**
 * Integration tests for GET /api/monthly-recap/status (Sprint 05 V3).
 *
 * Gated `SUPABASE_RECAP_TESTS=1`. Same auth-mock pattern as the start route
 * tests : injecte `userId` + `profile.group_id` côté wrapper, le reste tape
 * Supabase pour de vrai.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
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

describe.skipIf(!ENABLED)('GET /api/monthly-recap/status (gated)', () => {
  let admin: SupabaseClient<Database>
  let GET: (req: NextRequest) => Promise<Response>

  let userAId: string
  let userBId: string
  let userCId: string
  let groupAId: string

  const stamp = Date.now()
  const emailA = `recap-status-route-a-${stamp}@popoth.test`
  const emailB = `recap-status-route-b-${stamp}@popoth.test`
  const emailC = `recap-status-route-c-${stamp}@popoth.test`

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Recap status route tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    const mod = await import('@/app/api/monthly-recap/status/route')
    GET = mod.GET as (req: NextRequest) => Promise<Response>

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const [a, b, c] = await Promise.all([
      admin.auth.admin.createUser({
        email: emailA,
        password: randomUUID(),
        email_confirm: true,
      }),
      admin.auth.admin.createUser({
        email: emailB,
        password: randomUUID(),
        email_confirm: true,
      }),
      admin.auth.admin.createUser({
        email: emailC,
        password: randomUUID(),
        email_confirm: true,
      }),
    ])
    if (a.error || !a.data.user) throw a.error
    if (b.error || !b.data.user) throw b.error
    if (c.error || !c.data.user) throw c.error
    userAId = a.data.user.id
    userBId = b.data.user.id
    userCId = c.data.user.id

    const { data: group, error: groupError } = await admin
      .from('groups')
      .insert({
        name: `recap-status-route-group-${stamp}`,
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
        { id: userCId, first_name: 'Carla', last_name: 'Cccc', group_id: null },
      ],
      { onConflict: 'id' },
    )
    if (profilesError) throw profilesError
  })

  afterAll(async () => {
    if (admin) {
      if (userAId) await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
      if (groupAId) await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
      if (groupAId) await admin.from('groups').delete().eq('id', groupAId)
      if (userAId) await admin.from('profiles').update({ group_id: null }).eq('id', userAId)
      if (userBId) await admin.from('profiles').update({ group_id: null }).eq('id', userBId)
      if (userAId) await admin.auth.admin.deleteUser(userAId)
      if (userBId) await admin.auth.admin.deleteUser(userBId)
      if (userCId) await admin.auth.admin.deleteUser(userCId)
    }
  })

  async function resetRecaps() {
    if (userAId) await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
    if (groupAId) await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
  }

  function buildRequest(context: string | null): NextRequest {
    const url = context
      ? `http://localhost/api/monthly-recap/status?context=${context}`
      : 'http://localhost/api/monthly-recap/status'
    return new Request(url, { method: 'GET' }) as unknown as NextRequest
  }

  beforeEach(async () => {
    await resetRecaps()
  })

  it('context=profile, no row → 200 + kind=no_recap, summary=null', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const response = await GET(buildRequest('profile'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { status: { kind: string }; summary: unknown }
    }
    expect(body.data.status.kind).toBe('no_recap')
    expect(body.data.summary).toBeNull()
  })

  it('context=profile, row in_progress → 200 + kind=in_progress + summary populated', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    await admin
      .from('monthly_recaps')
      .insert({
        profile_id: userAId,
        recap_month: currentMonth,
        recap_year: currentYear,
        current_step: 'summary',
        started_by_profile_id: userAId,
        started_at: new Date().toISOString(),
      })
      .throwOnError()

    const response = await GET(buildRequest('profile'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        status: { kind: string; step?: string }
        summary: { budgets: unknown[]; bilanSign: string } | null
      }
    }
    expect(body.data.status.kind).toBe('in_progress')
    expect(body.data.status.step).toBe('summary')
    expect(body.data.summary).not.toBeNull()
    expect(Array.isArray(body.data.summary!.budgets)).toBe(true)
  })

  it('context=profile, row completed → 200 + kind=completed, summary=null', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const completedAt = new Date().toISOString()
    await admin
      .from('monthly_recaps')
      .insert({
        profile_id: userAId,
        recap_month: currentMonth,
        recap_year: currentYear,
        current_step: 'completed',
        started_by_profile_id: userAId,
        started_at: completedAt,
        completed_at: completedAt,
      })
      .throwOnError()

    const response = await GET(buildRequest('profile'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { status: { kind: string }; summary: unknown }
    }
    expect(body.data.status.kind).toBe('completed')
    expect(body.data.summary).toBeNull()
  })

  it('context=group, locked by other member → 200 + kind=locked_by_other, summary=null', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    await admin
      .from('monthly_recaps')
      .insert({
        group_id: groupAId,
        recap_month: currentMonth,
        recap_year: currentYear,
        current_step: 'summary',
        started_by_profile_id: userBId,
        started_at: new Date().toISOString(),
      })
      .throwOnError()

    const response = await GET(buildRequest('group'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        status: { kind: string; startedByName?: string | null }
        summary: unknown
      }
    }
    expect(body.data.status.kind).toBe('locked_by_other')
    expect(body.data.status.startedByName).toBe('Bob Bbbb')
    expect(body.data.summary).toBeNull()
  })

  it('context=group, user without group_id → 400 + body NO_GROUP message', async () => {
    mockedAuth.userId = userCId
    mockedAuth.groupId = null

    const response = await GET(buildRequest('group'))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toMatch(/groupe/i)
  })

  it('missing context query param → 400 + Query invalide', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const response = await GET(buildRequest(null))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('Query invalide')
  })
})
