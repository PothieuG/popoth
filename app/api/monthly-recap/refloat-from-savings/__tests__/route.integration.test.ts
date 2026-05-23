/**
 * Integration tests for POST /api/monthly-recap/refloat-from-savings
 * (Sprint 07 Monthly Recap V3 — negative flow action 2).
 *
 * Gated by `SUPABASE_RECAP_TESTS=1`. Server-side proportional allocation —
 * body carries only `{ context }`. Bilan engineering follows the same rule
 * as refloat-from-piggy tests (bilan = -2 × Σ estimated_amount for a fresh
 * profile).
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

describe.skipIf(!ENABLED)('POST /api/monthly-recap/refloat-from-savings (gated)', () => {
  let admin: SupabaseClient<Database>
  let POST: (req: NextRequest) => Promise<Response>

  let userAId: string
  let userBId: string
  let groupAId: string

  const stamp = Date.now()
  const emailA = `recap-rfs-a-${stamp}@popoth.test`
  const emailB = `recap-rfs-b-${stamp}@popoth.test`

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Recap refloat-from-savings tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    const mod = await import('@/app/api/monthly-recap/refloat-from-savings/route')
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
        name: `recap-rfs-group-${stamp}`,
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
    return new Request('http://localhost/api/monthly-recap/refloat-from-savings', {
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

  async function seedBudget(args: {
    estimated: number
    cumulatedSavings?: number
    ownerKind?: 'profile' | 'group'
  }): Promise<string> {
    const ownerKind = args.ownerKind ?? 'profile'
    const base = {
      name: `budget-${randomUUID().slice(0, 8)}`,
      estimated_amount: args.estimated,
      cumulated_savings: args.cumulatedSavings ?? 0,
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

  it('happy proportional — 3 budgets, deficit=120 → savings drained proportionally', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // bilan = -2 × Σ estimated = -2 × 60 = -120 → deficit = 120
    const idA = await seedBudget({ estimated: 20, cumulatedSavings: 100 })
    const idB = await seedBudget({ estimated: 20, cumulatedSavings: 200 })
    const idC = await seedBudget({ estimated: 20, cumulatedSavings: 300 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        newDeficit: number
        refloatedFromSavings: number
        perBudget: Array<{ budgetId: string; amount: number }>
        shortfall: number
      }
    }
    expect(body.data.newDeficit).toBe(0)
    expect(body.data.refloatedFromSavings).toBe(120)
    expect(body.data.shortfall).toBe(0)
    expect(body.data.perBudget).toHaveLength(3)
    const sum = body.data.perBudget.reduce((s, p) => s + p.amount, 0)
    expect(Math.round(sum * 100) / 100).toBe(120)

    // Per-budget proportional shares: 100×120/600=20, 200×120/600=40, 300×120/600=60.
    const { data: budgets } = await admin
      .from('estimated_budgets')
      .select('id, cumulated_savings')
      .eq('profile_id', userAId)
    const map = new Map(budgets?.map((b) => [b.id, Number(b.cumulated_savings ?? 0)]))
    expect(map.get(idA)).toBe(80)
    expect(map.get(idB)).toBe(160)
    expect(map.get(idC)).toBe(240)

    const { data: recap } = await admin
      .from('monthly_recaps')
      .select('refloated_from_savings, current_step')
      .eq('profile_id', userAId)
      .single()
    expect(Number(recap?.refloated_from_savings)).toBe(120)
    expect(recap?.current_step).toBe('summary') // not advanced
  })

  it('pool < deficit — drains everything, shortfall = deficit − pool', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // bilan = -200, deficit=200, savings pool = 20 + 30 = 50
    await seedBudget({ estimated: 50, cumulatedSavings: 20 })
    await seedBudget({ estimated: 50, cumulatedSavings: 30 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { newDeficit: number; refloatedFromSavings: number; shortfall: number }
    }
    expect(body.data.refloatedFromSavings).toBe(50)
    expect(body.data.newDeficit).toBe(150)
    expect(body.data.shortfall).toBe(150)

    const { data: budgets } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('profile_id', userAId)
    expect(budgets?.every((b) => Number(b.cumulated_savings) === 0)).toBe(true)
  })

  it('pool = 0 — no-op, shortfall = deficit, no DB writes to refloated_from_savings', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    await seedBudget({ estimated: 50, cumulatedSavings: 0 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        newDeficit: number
        refloatedFromSavings: number
        perBudget: unknown[]
        shortfall: number
      }
    }
    expect(body.data.refloatedFromSavings).toBe(0)
    expect(body.data.newDeficit).toBe(100)
    expect(body.data.shortfall).toBe(100)
    expect(body.data.perBudget).toEqual([])
  })

  it('pool exactly = deficit — drains everything, shortfall=0, newDeficit=0', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // bilan=-100, deficit=100, pool=100 (single budget)
    await seedBudget({ estimated: 50, cumulatedSavings: 100 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { newDeficit: number; refloatedFromSavings: number; shortfall: number }
    }
    expect(body.data.newDeficit).toBe(0)
    expect(body.data.refloatedFromSavings).toBe(100)
    expect(body.data.shortfall).toBe(0)
  })

  it('bilan zero (no deficit) — 409 no_deficit', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // No budgets, bilan=0

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('no_deficit')
  })

  it('group recap started by another — 403 not_initiator', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'group', startedBy: userBId })
    await seedBudget({ estimated: 40, cumulatedSavings: 50, ownerKind: 'group' })

    const response = await POST(buildRequest({ context: 'group' }))
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('not_initiator')
  })

  it("current_step='salary_update' — 409 invalid_step", async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile', currentStep: 'salary_update' })
    await seedBudget({ estimated: 40, cumulatedSavings: 50 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; currentStep: string }
    expect(body.error).toBe('invalid_step')
    expect(body.currentStep).toBe('salary_update')
  })

  it('cents precision — 3 equal savings with rounding-imperfect target', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // Σ estimated = 50 → bilan = -100, deficit = 100.
    await seedBudget({ estimated: 20, cumulatedSavings: 100 })
    await seedBudget({ estimated: 15, cumulatedSavings: 100 })
    await seedBudget({ estimated: 15, cumulatedSavings: 100 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        newDeficit: number
        refloatedFromSavings: number
        perBudget: Array<{ budgetId: string; amount: number }>
      }
    }
    // Sum is exact 100 (last absorbs remainder)
    const sum = body.data.perBudget.reduce((s, p) => s + p.amount, 0)
    expect(Math.round(sum * 100) / 100).toBe(100)
    expect(body.data.newDeficit).toBe(0)
    expect(body.data.refloatedFromSavings).toBe(100)
    // All 3 shares are within [33.33, 33.34]
    for (const p of body.data.perBudget) {
      expect(p.amount).toBeGreaterThanOrEqual(33.33)
      expect(p.amount).toBeLessThanOrEqual(33.34)
    }
  })
})
