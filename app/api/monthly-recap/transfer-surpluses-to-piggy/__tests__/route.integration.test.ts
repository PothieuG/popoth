/**
 * Integration tests for POST /api/monthly-recap/transfer-surpluses-to-piggy
 * (Sprint 06 Monthly Recap V3 — positive flow action 1).
 *
 * Gated by `SUPABASE_RECAP_TESTS=1` — hits the real Supabase project (dev via
 * SUPABASE_PROJECT_REF override, prod default per scripts convention). Mocks
 * `@/lib/api/with-auth` so the handler runs without a real session JWT; the
 * RPCs + table writes happen for real.
 *
 * Fixtures :
 *   - userA : profile context owner (also initiator for group recaps).
 *   - userB : second group member used for the not_initiator case.
 *   - groupA : groupe shared by userA and userB.
 *
 * Each test seeds budgets + recap fresh and tears them down in `afterEach`.
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

describe.skipIf(!ENABLED)('POST /api/monthly-recap/transfer-surpluses-to-piggy (gated)', () => {
  let admin: SupabaseClient<Database>
  let POST: (req: NextRequest) => Promise<Response>

  let userAId: string
  let userBId: string
  let groupAId: string

  const stamp = Date.now()
  const emailA = `recap-tsp-a-${stamp}@popoth.test`
  const emailB = `recap-tsp-b-${stamp}@popoth.test`

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Recap transfer-surpluses-to-piggy tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    const mod = await import('@/app/api/monthly-recap/transfer-surpluses-to-piggy/route')
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
        name: `recap-tsp-group-${stamp}`,
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
    return new Request('http://localhost/api/monthly-recap/transfer-surpluses-to-piggy', {
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
  }): Promise<{ id: string }> {
    const base = {
      recap_month: currentMonth,
      recap_year: currentYear,
      current_step: args.currentStep ?? 'summary',
      started_by_profile_id: args.startedBy ?? userAId,
      started_at: new Date().toISOString(),
      completed_at: args.completedAt ?? null,
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
    cumulatedSavings: number
    ownerKind?: 'profile' | 'group'
  }): Promise<string> {
    const ownerKind = args.ownerKind ?? 'profile'
    const base = {
      name: `budget-${randomUUID().slice(0, 8)}`,
      estimated_amount: args.estimated,
      cumulated_savings: args.cumulatedSavings,
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

  it('happy 3 budgets — credits piggy with each monthly surplus, leaves cumulated_savings untouched', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // Realistic monthly-surplus scenario: cumulated_savings = 0 (the surplus
    // is virtual — `estimated - spent` — and has never been credited to
    // savings). The credit-only implementation does NOT touch cumulated_savings.
    const id1 = await seedBudget({ estimated: 100, cumulatedSavings: 0 })
    const id2 = await seedBudget({ estimated: 50, cumulatedSavings: 0 })
    const id3 = await seedBudget({ estimated: 150, cumulatedSavings: 0 })

    const response = await POST(buildRequest({ context: 'profile', budgetIds: [id1, id2, id3] }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        transferred: Array<{ budgetId: string; amount: number }>
        failed: unknown[]
        summary: { piggyAmount: number }
      }
    }
    expect(body.data.failed).toEqual([])
    expect(body.data.transferred).toHaveLength(3)
    const sum = body.data.transferred.reduce((s, t) => s + t.amount, 0)
    expect(sum).toBe(300)

    const { data: piggy } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', userAId)
      .maybeSingle()
    expect(piggy?.amount).toBe(300)

    // cumulated_savings stays at 0 — the new implementation only credits the
    // piggy bank; consuming the virtual surplus on the UI side is done via
    // the piggy_transfers_data tracker, not by debiting savings.
    const { data: budgets } = await admin
      .from('estimated_budgets')
      .select('id, cumulated_savings')
      .eq('profile_id', userAId)
    expect(budgets?.every((b) => Number(b.cumulated_savings ?? 0) === 0)).toBe(true)

    expect(body.data.summary.piggyAmount).toBe(300)
  })

  it('partial selection — only the selected budget credits the piggy, others untouched', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    const id1 = await seedBudget({ estimated: 100, cumulatedSavings: 0 })
    const id2 = await seedBudget({ estimated: 50, cumulatedSavings: 0 })
    const id3 = await seedBudget({ estimated: 150, cumulatedSavings: 0 })

    const response = await POST(buildRequest({ context: 'profile', budgetIds: [id1] }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { transferred: Array<{ budgetId: string }>; failed: unknown[] }
    }
    expect(body.data.transferred).toHaveLength(1)
    expect(body.data.transferred[0]?.budgetId).toBe(id1)
    expect(body.data.failed).toEqual([])

    const { data: piggy } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', userAId)
      .maybeSingle()
    expect(piggy?.amount).toBe(100)

    // cumulated_savings of every budget stays at its seed value (0 here) — the
    // monthly surplus is only mirrored in piggy_transfers_data, never written
    // to the savings column.
    const { data: budgets } = await admin
      .from('estimated_budgets')
      .select('id, cumulated_savings')
      .eq('profile_id', userAId)
    const map = new Map(budgets?.map((b) => [b.id, Number(b.cumulated_savings ?? 0)]))
    expect(map.get(id1)).toBe(0)
    expect(map.get(id2)).toBe(0)
    expect(map.get(id3)).toBe(0)
  })

  it('budget without surplus in budgetIds — filtered out, no RPC call for it', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    const idZero = await seedBudget({ estimated: 0, cumulatedSavings: 0 })
    const idPositive = await seedBudget({ estimated: 50, cumulatedSavings: 0 })

    const response = await POST(
      buildRequest({ context: 'profile', budgetIds: [idZero, idPositive] }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { transferred: Array<{ budgetId: string }>; failed: unknown[] }
    }
    expect(body.data.transferred).toHaveLength(1)
    expect(body.data.transferred[0]?.budgetId).toBe(idPositive)
    expect(body.data.failed).toEqual([])

    const { data: piggy } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', userAId)
      .maybeSingle()
    expect(piggy?.amount).toBe(50)
  })

  it('recap completed (completed_at set) — 404 no_active_recap', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const completedAt = new Date().toISOString()
    await seedRecap({
      ownerKind: 'profile',
      currentStep: 'completed',
      completedAt,
    })
    const id1 = await seedBudget({ estimated: 100, cumulatedSavings: 100 })

    const response = await POST(buildRequest({ context: 'profile', budgetIds: [id1] }))
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('no_active_recap')
  })

  it('no recap row — 404 no_active_recap', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const id1 = await seedBudget({ estimated: 100, cumulatedSavings: 100 })

    const response = await POST(buildRequest({ context: 'profile', budgetIds: [id1] }))
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('no_active_recap')
  })

  it('recap started by another user (group context) — 403 not_initiator', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'group', startedBy: userBId })
    const id1 = await seedBudget({
      estimated: 100,
      cumulatedSavings: 100,
      ownerKind: 'group',
    })

    const response = await POST(buildRequest({ context: 'group', budgetIds: [id1] }))
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('not_initiator')
  })

  it("current_step='salary_update' — 409 invalid_step + currentStep echoed back", async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile', currentStep: 'salary_update' })
    const id1 = await seedBudget({ estimated: 100, cumulatedSavings: 100 })

    const response = await POST(buildRequest({ context: 'profile', budgetIds: [id1] }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; currentStep: string }
    expect(body.error).toBe('invalid_step')
    expect(body.currentStep).toBe('salary_update')
  })

  it('empty body — 400 BadRequest from Zod', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const response = await POST(buildRequest({}))
    expect(response.status).toBe(400)
  })

  it('empty budgetIds array — 400 BadRequest (Zod min(1))', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const response = await POST(buildRequest({ context: 'profile', budgetIds: [] }))
    expect(response.status).toBe(400)
  })

  // Sprint Recap-Positive-Consume-Surplus (2026-05-25) — piggy_transfers_data
  // tracker persists per-budget transfers so the recomputed summary no longer
  // re-lists already-handled budgets in BilanPositiveStep.

  it('persists transferred amounts into monthly_recaps.piggy_transfers_data', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const recap = await seedRecap({ ownerKind: 'profile' })
    const id1 = await seedBudget({ estimated: 100, cumulatedSavings: 100 })
    const id2 = await seedBudget({ estimated: 50, cumulatedSavings: 50 })

    const response = await POST(buildRequest({ context: 'profile', budgetIds: [id1, id2] }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        piggyTransfersData: Record<string, number>
        summary: { budgets: Array<{ budgetId: string; surplus: number }> }
      }
    }
    expect(body.data.piggyTransfersData).toEqual({ [id1]: 100, [id2]: 50 })
    // Returned summary already discounts the tracker — surplus reaches 0 for
    // the budgets that were just swept.
    const surplusById = new Map(body.data.summary.budgets.map((b) => [b.budgetId, b.surplus]))
    expect(surplusById.get(id1)).toBe(0)
    expect(surplusById.get(id2)).toBe(0)

    // Cross-check the column was UPDATEd, not just echoed by the route.
    const { data: row } = await admin
      .from('monthly_recaps')
      .select('piggy_transfers_data')
      .eq('id', recap.id)
      .maybeSingle()
    expect(row?.piggy_transfers_data).toEqual({ [id1]: 100, [id2]: 50 })
  })

  it('idempotent re-call on already-transferred budget — no-op (filter on surplus > 0)', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const recap = await seedRecap({ ownerKind: 'profile' })
    const id1 = await seedBudget({ estimated: 100, cumulatedSavings: 100 })

    const first = await POST(buildRequest({ context: 'profile', budgetIds: [id1] }))
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as {
      data: { transferred: Array<{ budgetId: string }> }
    }
    expect(firstBody.data.transferred).toHaveLength(1)

    // Second call on the same budget — the tracker now claims the surplus is
    // consumed, so loadRecapSummary returns surplus=0 and the loop filters
    // the target out before invoking the RPC (which would otherwise raise
    // "cumulated_savings would become negative" since the first call drove it
    // to 0).
    const second = await POST(buildRequest({ context: 'profile', budgetIds: [id1] }))
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as {
      data: { transferred: unknown[]; failed: unknown[] }
    }
    expect(secondBody.data.transferred).toEqual([])
    expect(secondBody.data.failed).toEqual([])

    // Tracker stays at the first-call value (no double-credit).
    const { data: row } = await admin
      .from('monthly_recaps')
      .select('piggy_transfers_data')
      .eq('id', recap.id)
      .maybeSingle()
    expect(row?.piggy_transfers_data).toEqual({ [id1]: 100 })

    // Piggy bank also reflects a single credit, not two.
    const { data: piggy } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', userAId)
      .maybeSingle()
    expect(piggy?.amount).toBe(100)
  })

  it('merges across multiple sessions — A in call 1, B in call 2 → tracker holds both', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const recap = await seedRecap({ ownerKind: 'profile' })
    const idA = await seedBudget({ estimated: 100, cumulatedSavings: 100 })
    const idB = await seedBudget({ estimated: 50, cumulatedSavings: 50 })

    const first = await POST(buildRequest({ context: 'profile', budgetIds: [idA] }))
    expect(first.status).toBe(200)

    const second = await POST(buildRequest({ context: 'profile', budgetIds: [idB] }))
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as {
      data: { piggyTransfersData: Record<string, number> }
    }
    expect(secondBody.data.piggyTransfersData).toEqual({ [idA]: 100, [idB]: 50 })

    const { data: row } = await admin
      .from('monthly_recaps')
      .select('piggy_transfers_data')
      .eq('id', recap.id)
      .maybeSingle()
    expect(row?.piggy_transfers_data).toEqual({ [idA]: 100, [idB]: 50 })
  })
})
