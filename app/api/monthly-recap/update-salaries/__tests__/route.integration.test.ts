/**
 * Integration tests for POST /api/monthly-recap/update-salaries
 * (Sprint 08 Monthly Recap V3 — écran 4).
 *
 * Gated by `SUPABASE_RECAP_TESTS=1`. Body `{ context, salaries: [...] }`.
 * Validates target authority server-side via `fetchGroupMemberIds` (group
 * context) or strict caller-id check (profile context), UPDATEs each salary,
 * invokes `calculate_group_contributions` RPC (group only, fail-soft), and
 * advances `current_step` to `'final_recap'`.
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

describe.skipIf(!ENABLED)('POST /api/monthly-recap/update-salaries (gated)', () => {
  let admin: SupabaseClient<Database>
  let POST: (req: NextRequest) => Promise<Response>

  let userAId: string
  let userBId: string
  let userCId: string
  let userDId: string // outside groupA — for invalid_target group case
  let groupAId: string

  const stamp = Date.now()
  const emailA = `recap-us-a-${stamp}@popoth.test`
  const emailB = `recap-us-b-${stamp}@popoth.test`
  const emailC = `recap-us-c-${stamp}@popoth.test`
  const emailD = `recap-us-d-${stamp}@popoth.test`

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Recap update-salaries tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    const mod = await import('@/app/api/monthly-recap/update-salaries/route')
    POST = mod.POST as (req: NextRequest) => Promise<Response>

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const [a, b, c, d] = await Promise.all([
      admin.auth.admin.createUser({ email: emailA, password: randomUUID(), email_confirm: true }),
      admin.auth.admin.createUser({ email: emailB, password: randomUUID(), email_confirm: true }),
      admin.auth.admin.createUser({ email: emailC, password: randomUUID(), email_confirm: true }),
      admin.auth.admin.createUser({ email: emailD, password: randomUUID(), email_confirm: true }),
    ])
    if (a.error || !a.data.user) throw a.error
    if (b.error || !b.data.user) throw b.error
    if (c.error || !c.data.user) throw c.error
    if (d.error || !d.data.user) throw d.error
    userAId = a.data.user.id
    userBId = b.data.user.id
    userCId = c.data.user.id
    userDId = d.data.user.id

    const { data: group, error: groupError } = await admin
      .from('groups')
      .insert({
        name: `recap-us-group-${stamp}`,
        monthly_budget_estimate: 0,
        creator_id: userAId,
      })
      .select('id')
      .single()
    if (groupError || !group) throw groupError ?? new Error('group insert returned no row')
    groupAId = group.id

    const { error: profilesError } = await admin.from('profiles').upsert(
      [
        {
          id: userAId,
          first_name: 'Alice',
          last_name: 'Aaaa',
          group_id: groupAId,
          salary: 1000,
        },
        { id: userBId, first_name: 'Bob', last_name: 'Bbbb', group_id: groupAId, salary: 1500 },
        {
          id: userCId,
          first_name: 'Carol',
          last_name: 'Cccc',
          group_id: groupAId,
          salary: 2000,
        },
        // Dave is outside groupA → used for invalid_target test
        { id: userDId, first_name: 'Dave', last_name: 'Dddd', group_id: null, salary: 999 },
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
      for (const id of [userAId, userBId, userCId, userDId]) {
        if (id) {
          await admin.from('profiles').update({ group_id: null }).eq('id', id)
          await admin.auth.admin.deleteUser(id)
        }
      }
    }
  })

  async function resetState() {
    if (userAId) {
      await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
    }
    if (groupAId) {
      await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
      await admin.from('group_contributions').delete().eq('group_id', groupAId)
    }
    // Reset salaries to baseline so each test starts fresh.
    await admin.from('profiles').update({ salary: 1000 }).eq('id', userAId)
    await admin.from('profiles').update({ salary: 1500 }).eq('id', userBId)
    await admin.from('profiles').update({ salary: 2000 }).eq('id', userCId)
  }

  function buildRequest(body: unknown): NextRequest {
    return new Request('http://localhost/api/monthly-recap/update-salaries', {
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
      current_step: args.currentStep ?? 'salary_update',
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

  it('happy profile — single salary matching caller → updated + step advanced', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })

    const response = await POST(
      buildRequest({
        context: 'profile',
        salaries: [{ profileId: userAId, salary: 3500 }],
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { updated: number; nextStep: string; contributionsRecalculated: boolean }
    }
    expect(body.data.updated).toBe(1)
    expect(body.data.nextStep).toBe('final_recap')
    expect(body.data.contributionsRecalculated).toBe(false)

    const { data: prof } = await admin.from('profiles').select('salary').eq('id', userAId).single()
    expect(Number(prof?.salary)).toBe(3500)

    const { data: recap } = await admin
      .from('monthly_recaps')
      .select('current_step')
      .eq('profile_id', userAId)
      .single()
    expect(recap?.current_step).toBe('final_recap')
  })

  it('profile salaries.length > 1 → 400 invalid_target', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })

    const response = await POST(
      buildRequest({
        context: 'profile',
        salaries: [
          { profileId: userAId, salary: 3500 },
          { profileId: userBId, salary: 2500 },
        ],
      }),
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid_target')

    // Salaries unchanged
    const { data: prof } = await admin.from('profiles').select('salary').eq('id', userAId).single()
    expect(Number(prof?.salary)).toBe(1000)
  })

  it('profile salaries[0].profileId != userId → 400 invalid_target', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })

    const response = await POST(
      buildRequest({
        context: 'profile',
        salaries: [{ profileId: userBId, salary: 2500 }],
      }),
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid_target')
  })

  it('happy group — 3 members in group → all updated + contributions recalculated', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'group' })

    const response = await POST(
      buildRequest({
        context: 'group',
        salaries: [
          { profileId: userAId, salary: 1100 },
          { profileId: userBId, salary: 1600 },
          { profileId: userCId, salary: 2100 },
        ],
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { updated: number; nextStep: string; contributionsRecalculated: boolean }
    }
    expect(body.data.updated).toBe(3)
    expect(body.data.nextStep).toBe('final_recap')
    expect(body.data.contributionsRecalculated).toBe(true)

    const { data: profs } = await admin
      .from('profiles')
      .select('id, salary')
      .in('id', [userAId, userBId, userCId])
    const byId = new Map((profs ?? []).map((p) => [p.id, Number(p.salary)]))
    expect(byId.get(userAId)).toBe(1100)
    expect(byId.get(userBId)).toBe(1600)
    expect(byId.get(userCId)).toBe(2100)

    const { data: recap } = await admin
      .from('monthly_recaps')
      .select('current_step')
      .eq('group_id', groupAId)
      .single()
    expect(recap?.current_step).toBe('final_recap')
  })

  it('group with 1 profileId outside the group → 400 invalid_target with extras.invalid', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'group' })

    const response = await POST(
      buildRequest({
        context: 'group',
        salaries: [
          { profileId: userAId, salary: 1100 },
          { profileId: userDId, salary: 2222 }, // outsider
        ],
      }),
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; invalid?: string[] }
    expect(body.error).toBe('invalid_target')
    expect(body.invalid).toEqual([userDId])

    // No salary mutation happened (Dave's salary unchanged)
    const { data: dave } = await admin.from('profiles').select('salary').eq('id', userDId).single()
    expect(Number(dave?.salary)).toBe(999)
  })

  it('not initiator (group started by userB) → 403', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'group', startedBy: userBId })

    const response = await POST(
      buildRequest({
        context: 'group',
        salaries: [{ profileId: userAId, salary: 1100 }],
      }),
    )
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('not_initiator')
  })

  it("current_step='manage_bilan' → 409 invalid_step", async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile', currentStep: 'manage_bilan' })

    const response = await POST(
      buildRequest({
        context: 'profile',
        salaries: [{ profileId: userAId, salary: 3500 }],
      }),
    )
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; currentStep: string }
    expect(body.error).toBe('invalid_step')
    expect(body.currentStep).toBe('manage_bilan')
  })

  it('empty body → 400 (Zod handleBadRequest)', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })

    const response = await POST(buildRequest({}))
    expect(response.status).toBe(400)
  })
})
