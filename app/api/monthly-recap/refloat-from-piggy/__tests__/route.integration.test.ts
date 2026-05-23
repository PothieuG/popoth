/**
 * Integration tests for POST /api/monthly-recap/refloat-from-piggy
 * (Sprint 07 Monthly Recap V3 — negative flow action 1).
 *
 * Gated by `SUPABASE_RECAP_TESTS=1`. Mocks `@/lib/api/with-auth` so the
 * handler runs without a real JWT; the piggy debit + recap tracker update
 * hit real Supabase.
 *
 * Bilan engineering — for a fresh profile with no incomes / no real
 * expenses, the bilan equals `-2 × Σ estimated_amount` (cf. load-summary.ts
 * `ravEstime = -X` and `ravEffectif = -X` where X is the budgets total).
 * Tests seed estimated_budgets so that `|bilan|` matches the expected
 * deficit; piggy fixture is seeded directly via INSERT.
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

describe.skipIf(!ENABLED)('POST /api/monthly-recap/refloat-from-piggy (gated)', () => {
  let admin: SupabaseClient<Database>
  let POST: (req: NextRequest) => Promise<Response>

  let userAId: string
  let userBId: string
  let groupAId: string

  const stamp = Date.now()
  const emailA = `recap-rfp-a-${stamp}@popoth.test`
  const emailB = `recap-rfp-b-${stamp}@popoth.test`

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Recap refloat-from-piggy tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    const mod = await import('@/app/api/monthly-recap/refloat-from-piggy/route')
    POST = mod.POST as (req: NextRequest) => Promise<Response>

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const [a, b] = await Promise.all([
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
    ])
    if (a.error || !a.data.user) throw a.error
    if (b.error || !b.data.user) throw b.error
    userAId = a.data.user.id
    userBId = b.data.user.id

    const { data: group, error: groupError } = await admin
      .from('groups')
      .insert({
        name: `recap-rfp-group-${stamp}`,
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
      await admin.from('real_expenses').delete().eq('profile_id', userAId)
      await admin.from('estimated_budgets').delete().eq('profile_id', userAId)
      await admin.from('piggy_bank').delete().eq('profile_id', userAId)
    }
    if (groupAId) {
      await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
      await admin.from('real_expenses').delete().eq('group_id', groupAId)
      await admin.from('estimated_budgets').delete().eq('group_id', groupAId)
      await admin.from('piggy_bank').delete().eq('group_id', groupAId)
    }
  }

  function buildRequest(body: unknown): NextRequest {
    return new Request('http://localhost/api/monthly-recap/refloat-from-piggy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  }

  async function seedRecap(args: {
    ownerKind: 'profile' | 'group'
    currentStep?: string
    startedBy?: string
    completedAt?: string | null
    refloatedFromPiggy?: number
    refloatedFromSavings?: number
  }): Promise<{ id: string }> {
    const base = {
      recap_month: currentMonth,
      recap_year: currentYear,
      current_step: args.currentStep ?? 'summary',
      started_by_profile_id: args.startedBy ?? userAId,
      started_at: new Date().toISOString(),
      completed_at: args.completedAt ?? null,
      refloated_from_piggy: args.refloatedFromPiggy ?? 0,
      refloated_from_savings: args.refloatedFromSavings ?? 0,
    }
    const payload: Database['public']['Tables']['monthly_recaps']['Insert'] =
      args.ownerKind === 'profile'
        ? { profile_id: userAId, ...base }
        : { group_id: groupAId, ...base }
    const { data, error } = await admin.from('monthly_recaps').insert(payload).select('id').single()
    if (error || !data) throw error ?? new Error('recap insert returned no row')
    return data
  }

  /**
   * Seed a budget without cumulated_savings (no real expenses either).
   * For a fresh profile with 0 incomes: bilan = -2 × Σ estimated_amount.
   * So `seedBudget({ estimated: 40 })` → bilan = -80.
   */
  async function seedBudget(args: {
    estimated: number
    ownerKind?: 'profile' | 'group'
  }): Promise<string> {
    const ownerKind = args.ownerKind ?? 'profile'
    const base = {
      name: `budget-${randomUUID().slice(0, 8)}`,
      estimated_amount: args.estimated,
      cumulated_savings: 0,
      is_monthly_recurring: false,
    }
    const payload: Database['public']['Tables']['estimated_budgets']['Insert'] =
      ownerKind === 'profile' ? { profile_id: userAId, ...base } : { group_id: groupAId, ...base }
    const { data, error } = await admin
      .from('estimated_budgets')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error('budget insert returned no row')
    return data.id
  }

  async function seedPiggy(amount: number, ownerKind: 'profile' | 'group' = 'profile') {
    const payload: Database['public']['Tables']['piggy_bank']['Insert'] =
      ownerKind === 'profile'
        ? { profile_id: userAId, group_id: null, amount }
        : { profile_id: null, group_id: groupAId, amount }
    const { error } = await admin.from('piggy_bank').insert(payload)
    if (error) throw error
  }

  it('happy — piggy=100, deficit=80, amount=80 → newDeficit=0, refloated=80, piggy=20', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    await seedBudget({ estimated: 40 }) // bilan = -80
    await seedPiggy(100)

    const response = await POST(buildRequest({ context: 'profile', amount: 80 }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { newDeficit: number; refloatedFromPiggy: number; summary: { piggyAmount: number } }
    }
    expect(body.data.newDeficit).toBe(0)
    expect(body.data.refloatedFromPiggy).toBe(80)
    expect(body.data.summary.piggyAmount).toBe(20)

    const { data: piggy } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', userAId)
      .maybeSingle()
    expect(piggy?.amount).toBe(20)

    const { data: recap } = await admin
      .from('monthly_recaps')
      .select('refloated_from_piggy, current_step')
      .eq('profile_id', userAId)
      .single()
    expect(Number(recap?.refloated_from_piggy)).toBe(80)
    // current_step NOT advanced (negative flow only advances via save-budget-snapshot)
    expect(recap?.current_step).toBe('summary')
  })

  it('partial — piggy=50, deficit=80, amount=50 → newDeficit=30, piggy=0', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    await seedBudget({ estimated: 40 })
    await seedPiggy(50)

    const response = await POST(buildRequest({ context: 'profile', amount: 50 }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { newDeficit: number } }
    expect(body.data.newDeficit).toBe(30)

    const { data: piggy } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', userAId)
      .maybeSingle()
    expect(piggy?.amount).toBe(0)
  })

  it('amount > deficit — 400 overflow', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    await seedBudget({ estimated: 40 }) // deficit=80
    await seedPiggy(200)

    const response = await POST(buildRequest({ context: 'profile', amount: 150 }))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; deficitRemaining: number }
    expect(body.error).toBe('overflow')
    expect(body.deficitRemaining).toBe(80)
  })

  it('amount > piggy — 400 piggy_insufficient', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    await seedBudget({ estimated: 100 }) // deficit=200
    await seedPiggy(20)

    const response = await POST(buildRequest({ context: 'profile', amount: 50 }))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; available: number }
    expect(body.error).toBe('piggy_insufficient')
    expect(body.available).toBe(20)
  })

  it('bilan positive (no deficit) — 409 no_deficit', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // No budgets, no incomes → bilan = 0 (sign 'zero', not 'negative')
    await seedPiggy(50)

    const response = await POST(buildRequest({ context: 'profile', amount: 10 }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('no_deficit')
  })

  it('recap completed — 404 no_active_recap', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({
      ownerKind: 'profile',
      currentStep: 'completed',
      completedAt: new Date().toISOString(),
    })
    await seedBudget({ estimated: 40 })
    await seedPiggy(100)

    const response = await POST(buildRequest({ context: 'profile', amount: 50 }))
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('no_active_recap')
  })

  it('group recap started by another user — 403 not_initiator', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'group', startedBy: userBId })
    await seedBudget({ estimated: 40, ownerKind: 'group' })
    await seedPiggy(100, 'group')

    const response = await POST(buildRequest({ context: 'group', amount: 50 }))
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('not_initiator')
  })

  it("current_step='salary_update' — 409 invalid_step", async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile', currentStep: 'salary_update' })
    await seedBudget({ estimated: 40 })
    await seedPiggy(100)

    const response = await POST(buildRequest({ context: 'profile', amount: 50 }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; currentStep: string }
    expect(body.error).toBe('invalid_step')
    expect(body.currentStep).toBe('salary_update')
  })
})
