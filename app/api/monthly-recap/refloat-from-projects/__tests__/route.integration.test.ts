/**
 * Integration tests for POST /api/monthly-recap/refloat-from-projects
 * (Sprint Projets-Épargne 08 — Monthly Recap V3 negative cascade new step
 * between savings refloat and the final budget snapshot).
 *
 * Gated by `SUPABASE_RECAP_TESTS=1`. Body `{ context }` only — server
 * computes proportional allocation via `computeProportionalProjectsRefloat`
 * (pool = `monthly_allocation`). OVERWRITE semantics: the JSONB column
 * `project_snapshot_data` is fully replaced each call.
 *
 * Mirrors the seed pattern of save-budget-snapshot/refloat-from-savings.
 * `seedProject` directly INSERTs `savings_projects` rows (bypass RPC) so
 * we can fix-stamp `monthly_allocation` precisely for proportional checks.
 *
 * Sémantique : la `monthly_allocation` est traitée comme un budget virtuel
 * dans `lib/finance` (cf. sprint 03 — `totalEstimatedBudgets` inclut les
 * allocations projets), donc seeder 1 projet à 30€/mois fait grossir
 * `totalEstimatedBudgets` de 30€ → ravEstime baisse de 30€ → bilan négatif
 * pour les cas où l'utilisateur n'a pas de revenus seedés en compensation.
 * Le bilan retombe à 0 / positif quand on ne seed AUCUN projet → ce qui
 * sert pour le cas "no_projects_available" + "bilan positive".
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

describe.skipIf(!ENABLED)('POST /api/monthly-recap/refloat-from-projects (gated)', () => {
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
        'Recap refloat-from-projects tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    const mod = await import('@/app/api/monthly-recap/refloat-from-projects/route')
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
      await admin.from('savings_projects').delete().eq('profile_id', userAId)
      await admin.from('real_expenses').delete().eq('profile_id', userAId)
      await admin.from('estimated_budgets').delete().eq('profile_id', userAId)
      await admin.from('piggy_bank').delete().eq('profile_id', userAId)
    }
    if (groupAId) {
      await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
      await admin.from('savings_projects').delete().eq('group_id', groupAId)
      await admin.from('real_expenses').delete().eq('group_id', groupAId)
      await admin.from('estimated_budgets').delete().eq('group_id', groupAId)
      await admin.from('piggy_bank').delete().eq('group_id', groupAId)
    }
  }

  function buildRequest(body: unknown): NextRequest {
    return new Request('http://localhost/api/monthly-recap/refloat-from-projects', {
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
    projectSnapshotData?: Record<string, number>
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
      project_snapshot_data: (args.projectSnapshotData ?? {}) as unknown as Json,
    }
    const payload: Database['public']['Tables']['monthly_recaps']['Insert'] =
      args.ownerKind === 'profile'
        ? { profile_id: userAId, ...base }
        : { group_id: groupAId, ...base }
    const { data, error } = await admin.from('monthly_recaps').insert(payload).select('id').single()
    if (error || !data) throw error ?? new Error('recap insert returned no row')
    return data
  }

  async function seedProject(args: {
    monthlyAllocation: number
    ownerKind?: 'profile' | 'group'
  }): Promise<string> {
    const ownerKind = args.ownerKind ?? 'profile'
    // deadline arbitrary 12 months out — only `monthly_allocation` is read by
    // the cascade. `target_amount` >= `monthly_allocation` (CHECK constraint).
    const base = {
      name: `proj-${randomUUID().slice(0, 8)}`,
      target_amount: Math.max(args.monthlyAllocation, 100),
      monthly_allocation: args.monthlyAllocation,
      deadline_date: new Date(currentYear + 1, currentMonth - 1, 1).toISOString().slice(0, 10),
    }
    const payload: Database['public']['Tables']['savings_projects']['Insert'] =
      ownerKind === 'profile' ? { profile_id: userAId, ...base } : { group_id: groupAId, ...base }
    const { data, error } = await admin
      .from('savings_projects')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error('savings_project insert returned no row')
    return data.id
  }

  it('happy — 2 projects 100€ + 50€, deficit 60€ ⇒ allocation { p1: 40, p2: 20 }', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // Setup engineered for bilan = -350, refloated_from_piggy = 290 →
    // deficitRemaining = 60. Pool = 100 + 50 = 150 → proportional allocation
    // gives p1 = 40, p2 = 20 (last absorbs cents).
    //   - estimated_budget 1000€
    //   - projects 100€ + 50€ → totalEstimatedBudgets = 1150 → ravEstime = -1150
    //   - real_expense 1350€ on budget 1000 → budgetDeficit = 350
    //   - ravEffectif = 0 + 0 - 1150 - 0 - 350 = -1500
    //   - bilan = -1500 - (-1150) = -350
    const budgetId = await seedBudget({ estimated: 1000 })
    const p1 = await seedProject({ monthlyAllocation: 100 })
    const p2 = await seedProject({ monthlyAllocation: 50 })
    await seedExpense({ budgetId, amount: 1350 })
    await admin
      .from('monthly_recaps')
      .update({ refloated_from_piggy: 290 })
      .eq('profile_id', userAId)

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        newDeficit: number
        allocation: Record<string, number>
        perProject: Array<{ projectId: string; amount: number }>
        shortfall: number
      }
    }
    expect(body.data.newDeficit).toBe(0)
    expect(body.data.shortfall).toBe(0)
    // Allocation : pool 150, target 60 → p1=40 (proportional 60*100/150),
    //                                    p2=20 (cents-remainder lands on last sorted)
    expect(body.data.allocation[p1]).toBeCloseTo(40, 2)
    expect(body.data.allocation[p2]).toBeCloseTo(20, 2)
    const persisted = await readSnapshot(userAId)
    expect(Object.keys(persisted ?? {}).sort()).toEqual([p1, p2].sort())
    const sum = Object.values(persisted ?? {}).reduce((s, v) => s + Number(v), 0)
    expect(Math.round(sum * 100) / 100).toBe(60)
  })

  it('partial — total monthly_allocation pool < deficit, snapshot drains all, shortfall remains', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // budget 500 + project 30 → totalEstimatedBudgets = 530 → ravEstime = -530
    // real_expense 770 on budget 500 → budgetDeficit = 270
    // ravEffectif = 0 - 530 - 270 = -800
    // bilan = -800 - (-530) = -270
    // No refloat → deficitRemaining = 270. Pool = 30 → totalAllocated=30,
    // shortfall=240, newDeficit=240.
    const budgetId = await seedBudget({ estimated: 500 })
    await seedProject({ monthlyAllocation: 30 })
    await seedExpense({ budgetId, amount: 770 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { newDeficit: number; shortfall: number; allocation: Record<string, number> }
    }
    expect(body.data.shortfall).toBe(240)
    expect(body.data.newDeficit).toBe(240)
    const sum = Object.values(body.data.allocation).reduce((s, v) => s + Number(v), 0)
    expect(Math.round(sum * 100) / 100).toBe(30)
  })

  it('zero projects ⇒ 409 no_projects_available', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // Need a NEGATIVE bilan to pass the no_deficit gate.
    const budgetId = await seedBudget({ estimated: 100 })
    await seedExpense({ budgetId, amount: 250 })
    // bilan = -250 - (-100) = -150 → negative ✓
    // 0 projects → executeRefloatFromProjects throws no_projects_available.

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('no_projects_available')
  })

  it('deficit already covered by piggy + savings ⇒ 409 no_deficit', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    // budget 100 + project 50 → totalEstimatedBudgets = 150 → ravEstime = -150
    // real_expense 250 on budget 100 → budgetDeficit = 150
    // ravEffectif = 0 - 150 - 150 = -300
    // bilan = -300 - (-150) = -150
    // refloated 100 + 50 = 150 → deficitRemaining = 0 → no_deficit.
    await seedRecap({
      ownerKind: 'profile',
      refloatedFromPiggy: 100,
      refloatedFromSavings: 50,
    })
    const budgetId = await seedBudget({ estimated: 100 })
    await seedProject({ monthlyAllocation: 50 })
    await seedExpense({ budgetId, amount: 250 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('no_deficit')
  })

  it('overwrite — second call replaces the first project snapshot', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })
    // Same engineering as "happy" : bilan = -350, piggy 290 → deficit 60,
    // pool 150 → allocation { p1: 40, p2: 20 }, newDeficit = 0.
    const budgetId = await seedBudget({ estimated: 1000 })
    const p1 = await seedProject({ monthlyAllocation: 100 })
    await seedProject({ monthlyAllocation: 50 })
    await seedExpense({ budgetId, amount: 1350 })
    await admin
      .from('monthly_recaps')
      .update({ refloated_from_piggy: 290 })
      .eq('profile_id', userAId)

    const r1 = await POST(buildRequest({ context: 'profile' }))
    expect(r1.status).toBe(200)
    const snap1 = await readSnapshot(userAId)
    expect(Object.keys(snap1 ?? {})).toHaveLength(2)

    // Second call with the SAME state — must replace verbatim.
    const r2 = await POST(buildRequest({ context: 'profile' }))
    expect(r2.status).toBe(200)
    const snap2 = await readSnapshot(userAId)
    expect(snap2?.[p1]).toBeCloseTo(snap1?.[p1] ?? -1, 2)
    expect(Object.keys(snap2 ?? {})).toHaveLength(2)
  })

  it('group recap started by another ⇒ 403 not_initiator', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'group', startedBy: userBId })
    await seedProject({ monthlyAllocation: 30, ownerKind: 'group' })

    const response = await POST(buildRequest({ context: 'group' }))
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('not_initiator')
  })

  it("current_step='salary_update' ⇒ 409 invalid_step", async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile', currentStep: 'salary_update' })
    await seedProject({ monthlyAllocation: 30 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; currentStep: string }
    expect(body.error).toBe('invalid_step')
    expect(body.currentStep).toBe('salary_update')
  })

  // --- Helpers -----------------------------------------------------------

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

  async function seedExpense(args: {
    budgetId: string
    amount: number
    ownerKind?: 'profile' | 'group'
  }): Promise<void> {
    const ownerKind = args.ownerKind ?? 'profile'
    // expense_date = first day of current month so loadRecapSummary
    // picks it up via the gte/lt monthly window.
    const expense_date = new Date(currentYear, currentMonth - 1, 1).toISOString().slice(0, 10)
    const base = {
      estimated_budget_id: args.budgetId,
      description: `exp-${randomUUID().slice(0, 8)}`,
      amount: args.amount,
      amount_from_budget: args.amount,
      amount_from_budget_savings: 0,
      amount_from_piggy_bank: 0,
      expense_date,
      applied_to_balance_at: new Date().toISOString(),
      is_carried_over: false,
    }
    const payload: Database['public']['Tables']['real_expenses']['Insert'] =
      ownerKind === 'profile' ? { profile_id: userAId, ...base } : { group_id: groupAId, ...base }
    const { error } = await admin.from('real_expenses').insert(payload)
    if (error) throw error
  }

  async function readSnapshot(profileId: string): Promise<Record<string, number> | null> {
    const { data } = await admin
      .from('monthly_recaps')
      .select('project_snapshot_data')
      .eq('profile_id', profileId)
      .single()
    if (!data) return null
    const raw = data.project_snapshot_data
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number') out[k] = v
    }
    return out
  }
})
