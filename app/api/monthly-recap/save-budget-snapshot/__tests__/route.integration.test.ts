/**
 * Integration tests for POST /api/monthly-recap/save-budget-snapshot
 * (Sprint 07 Monthly Recap V3 — negative flow action 3).
 *
 * Gated by `SUPABASE_RECAP_TESTS=1`. Body `{ context }` only — server
 * computes proportional snapshot via `computeProportionalBudgetSnapshot`
 * (pool = `estimated_amount`). OVERWRITE semantics: the JSONB column is
 * fully replaced each call, computed from the deficit AFTER piggy + savings
 * refloats (the existing snapshot is deliberately excluded so re-clicks
 * are idempotent at unchanged piggy/savings state).
 *
 * This is the ONLY negative-flow endpoint that advances `current_step` —
 * to `'salary_update'` iff `newDeficit ≤ 0.01`.
 */

import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/lib/database.types'

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

describe.skipIf(!ENABLED)('POST /api/monthly-recap/save-budget-snapshot (gated)', () => {
  let admin: SupabaseClient<Database>
  let POST: (req: NextRequest) => Promise<Response>

  let userAId: string
  let userBId: string
  let groupAId: string

  const stamp = Date.now()
  const emailA = `recap-sbs-a-${stamp}@popoth.test`
  const emailB = `recap-sbs-b-${stamp}@popoth.test`

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Recap save-budget-snapshot tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    const mod = await import('@/app/api/monthly-recap/save-budget-snapshot/route')
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
        name: `recap-sbs-group-${stamp}`,
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
    return new Request('http://localhost/api/monthly-recap/save-budget-snapshot', {
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
    budgetSnapshotData?: Record<string, number>
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
      budget_snapshot_data: (args.budgetSnapshotData ?? {}) as unknown as Json,
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

  it('happy — pool > deficit, deficit fully absorbed, current_step → salary_update', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // Σ estimated = 50 → bilan=-100, deficit=100. Pool=50 → only partial cover.
    // Need pool > deficit: Σ estimated must be > 100 to host the snapshot.
    // With sum=200 (4 budgets×50): bilan=-400, deficit=400, pool=200 → still pool<deficit.
    // bilan = -2 × Σ estimated → we can't have pool > deficit with this engineering.
    // INSTEAD: pre-credit refloat_from_piggy to reduce deficitRemaining vs the pool.
    const idA = await seedBudget({ estimated: 200 })
    const idB = await seedBudget({ estimated: 300 })
    const idC = await seedBudget({ estimated: 500 })
    // bilan = -2000, but refloat_from_piggy = 1900 → deficitRemaining = 100, pool = 1000.
    await admin
      .from('monthly_recaps')
      .update({ refloated_from_piggy: 1900 })
      .eq('profile_id', userAId)

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        newDeficit: number
        snapshot: Record<string, number>
        perBudget: Array<{ budgetId: string; amount: number }>
        shortfall: number
        nextStep: string | null
      }
    }
    expect(body.data.newDeficit).toBe(0)
    expect(body.data.shortfall).toBe(0)
    expect(body.data.nextStep).toBe('salary_update')

    // Proportional shares on pool 1000 for target 100: A=20, B=30, last=50.
    const sum = body.data.perBudget.reduce((s, p) => s + p.amount, 0)
    expect(Math.round(sum * 100) / 100).toBe(100)
    expect(body.data.snapshot[idA]).toBe(20)
    expect(body.data.snapshot[idB]).toBe(30)
    expect(body.data.snapshot[idC]).toBe(50)

    const { data: recap } = await admin
      .from('monthly_recaps')
      .select('current_step, budget_snapshot_data')
      .eq('profile_id', userAId)
      .single()
    expect(recap?.current_step).toBe('salary_update')
    const persisted = recap?.budget_snapshot_data as Record<string, number>
    expect(Object.keys(persisted)).toHaveLength(3)
    const persistedSum = Object.values(persisted).reduce((s, v) => s + Number(v), 0)
    expect(Math.round(persistedSum * 100) / 100).toBe(100)
  })

  it('partial — pool < deficit, snapshot drains all pool, shortfall remains', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // Σ estimated = 50 → bilan=-100, deficit=100, pool=50 → shortfall=50.
    await seedBudget({ estimated: 50 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        newDeficit: number
        snapshot: Record<string, number>
        shortfall: number
        nextStep: string | null
      }
    }
    expect(body.data.shortfall).toBe(50)
    expect(body.data.newDeficit).toBe(50)
    expect(body.data.nextStep).toBeNull()

    const { data: recap } = await admin
      .from('monthly_recaps')
      .select('current_step')
      .eq('profile_id', userAId)
      .single()
    expect(recap?.current_step).toBe('summary') // not advanced
  })

  it('overwrite — second call replaces the first snapshot (idempotent at unchanged state)', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    await seedBudget({ estimated: 200 })
    await seedBudget({ estimated: 300 })
    await seedBudget({ estimated: 500 })
    await admin
      .from('monthly_recaps')
      .update({ refloated_from_piggy: 1900 })
      .eq('profile_id', userAId)

    const r1 = await POST(buildRequest({ context: 'profile' }))
    expect(r1.status).toBe(200)
    // After first call, current_step has advanced to salary_update — second
    // call will hit invalid_step. To test overwrite of the JSONB column, reset
    // the step back to 'manage_bilan' and run again.
    await admin
      .from('monthly_recaps')
      .update({ current_step: 'manage_bilan' })
      .eq('profile_id', userAId)

    const r2 = await POST(buildRequest({ context: 'profile' }))
    expect(r2.status).toBe(200)
    const b2 = (await r2.json()) as {
      data: { snapshot: Record<string, number>; newDeficit: number; nextStep: string | null }
    }
    expect(b2.data.newDeficit).toBe(0)
    expect(b2.data.nextStep).toBe('salary_update')
    // Snapshot recomputed from the same state → identical shape (idempotent).
    const sum2 = Object.values(b2.data.snapshot).reduce((s, v) => s + Number(v), 0)
    expect(Math.round(sum2 * 100) / 100).toBe(100)
  })

  it('cents precision — 3 budgets of similar size, target=100, sum exact', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    await seedBudget({ estimated: 100 })
    await seedBudget({ estimated: 100 })
    await seedBudget({ estimated: 100 })
    // bilan=-600 (Σ=300, 2×300=600). refloat 500 → deficitRemaining=100, pool=300.
    await admin
      .from('monthly_recaps')
      .update({ refloated_from_piggy: 500 })
      .eq('profile_id', userAId)

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { snapshot: Record<string, number>; newDeficit: number }
    }
    const sum = Object.values(body.data.snapshot).reduce((s, v) => s + Number(v), 0)
    expect(Math.round(sum * 100) / 100).toBe(100)
    expect(body.data.newDeficit).toBe(0)
    for (const v of Object.values(body.data.snapshot)) {
      expect(Number(v)).toBeGreaterThanOrEqual(33.33)
      expect(Number(v)).toBeLessThanOrEqual(33.34)
    }
  })

  it('bilan positive — 409 no_deficit', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // No budgets → bilan=0 (sign 'zero', triggers no_deficit)

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('no_deficit')
  })

  it('deficit already covered by piggy + savings — 409 no_deficit', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({
      ownerKind: 'profile',
      refloatedFromPiggy: 80,
      refloatedFromSavings: 20,
    })
    // bilan=-100, refloated=100 → deficitRemaining=0
    await seedBudget({ estimated: 50 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('no_deficit')
  })

  it('group recap started by another — 403 not_initiator', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'group', startedBy: userBId })
    await seedBudget({ estimated: 40, ownerKind: 'group' })

    const response = await POST(buildRequest({ context: 'group' }))
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('not_initiator')
  })

  it("current_step='salary_update' — 409 invalid_step", async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile', currentStep: 'salary_update' })
    await seedBudget({ estimated: 40 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; currentStep: string }
    expect(body.error).toBe('invalid_step')
    expect(body.currentStep).toBe('salary_update')
  })
})
