/**
 * Integration tests for POST /api/monthly-recap/complete
 * (Sprint 08 Monthly Recap V3 — écran 5 finalize).
 *
 * Gated by `SUPABASE_RECAP_TESTS=1`. Body `{ context }` only. Orchestrates:
 *   1. apply_snapshot RPC → increments estimated_budgets.carryover_spent_amount
 *      per the JSONB blob in monthly_recaps.budget_snapshot_data (sprint 07).
 *   2. process_transactions RPC → DELETE applied + UPDATE non-applied with
 *      is_carried_over=true + carried_from_recap_id = recap.id, for both
 *      real_expenses and real_income_entries.
 *   3. UPDATE monthly_recaps.completed_at = now(), current_step = 'completed'.
 *
 * Idempotent on retry — a second call returns `{ alreadyCompleted: true, recap }`.
 */

import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/lib/database.types'
import { getRecapPeriod } from '@/lib/recap/period'

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

describe.skipIf(!ENABLED)('POST /api/monthly-recap/complete (gated)', () => {
  let admin: SupabaseClient<Database>
  let POST: (req: NextRequest) => Promise<Response>

  let userAId: string
  let userBId: string
  let groupAId: string

  const stamp = Date.now()
  const emailA = `recap-cpl-a-${stamp}@popoth.test`
  const emailB = `recap-cpl-b-${stamp}@popoth.test`

  const { month: recapMonth, year: recapYear } = getRecapPeriod()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Recap complete tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    const mod = await import('@/app/api/monthly-recap/complete/route')
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
        name: `recap-cpl-group-${stamp}`,
        monthly_budget_estimate: 0,
        creator_id: userAId,
      })
      .select('id')
      .single()
    if (groupError || !group) throw groupError ?? new Error('group insert returned no row')
    groupAId = group.id

    const { error: profilesError } = await admin.from('profiles').upsert(
      [
        // salary > 0 required so calculate_group_contributions produces a
        // non-zero contribution_amount — needed by the contribution-mirror
        // regression tests below (sync_contribution_real_expense/_income
        // no-op / DELETE the mirror at contribution_amount = 0).
        { id: userAId, first_name: 'Alice', last_name: 'Aaaa', group_id: groupAId, salary: 3000 },
        { id: userBId, first_name: 'Bob', last_name: 'Bbbb', group_id: groupAId, salary: 2000 },
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
      for (const id of [userAId, userBId]) {
        if (id) {
          await admin.from('profiles').update({ group_id: null }).eq('id', id)
          await admin.auth.admin.deleteUser(id)
        }
      }
    }
  })

  async function resetState() {
    if (userAId) {
      await admin.from('real_expenses').delete().eq('profile_id', userAId)
      await admin.from('real_income_entries').delete().eq('profile_id', userAId)
      await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
      await admin.from('estimated_budgets').delete().eq('profile_id', userAId)
      await admin.from('bank_balances').delete().eq('profile_id', userAId)
    }
    if (groupAId) {
      await admin.from('real_expenses').delete().eq('group_id', groupAId)
      await admin.from('real_income_entries').delete().eq('group_id', groupAId)
      await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
      await admin.from('estimated_budgets').delete().eq('group_id', groupAId)
      await admin.from('bank_balances').delete().eq('group_id', groupAId)
      // group_contributions rows aren't touched by the estimated_budgets/
      // real_expenses cleanup above (no FK CASCADE from that direction) —
      // the contribution-mirror tests below seed these directly, so they
      // must be cleaned explicitly or they leak amount/state into the next test.
      await admin.from('group_contributions').delete().eq('group_id', groupAId)
    }
  }

  function buildRequest(body: unknown): NextRequest {
    return new Request('http://localhost/api/monthly-recap/complete', {
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
    budgetSnapshotData?: Record<string, number>
  }): Promise<{ id: string }> {
    const base = {
      recap_month: recapMonth,
      recap_year: recapYear,
      current_step: args.currentStep ?? 'final_recap',
      started_by_profile_id: args.startedBy ?? userAId,
      started_at: new Date().toISOString(),
      completed_at: args.completedAt ?? null,
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
    carryoverSpent?: number
  }): Promise<string> {
    const ownerKind = args.ownerKind ?? 'profile'
    const base = {
      name: `budget-${randomUUID().slice(0, 8)}`,
      estimated_amount: args.estimated,
      cumulated_savings: 0,
      is_monthly_recurring: false,
      carryover_spent_amount: args.carryoverSpent ?? 0,
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
    amount: number
    appliedToBalanceAt?: string | null
    isCarriedOver?: boolean
    carriedFromRecapId?: string | null
    ownerKind?: 'profile' | 'group'
  }): Promise<string> {
    const ownerKind = args.ownerKind ?? 'profile'
    const base = {
      amount: args.amount,
      description: 'integration-seed',
      applied_to_balance_at: args.appliedToBalanceAt ?? null,
      is_carried_over: args.isCarriedOver ?? false,
      carried_from_recap_id: args.carriedFromRecapId ?? null,
    }
    const payload: Database['public']['Tables']['real_expenses']['Insert'] =
      ownerKind === 'profile' ? { profile_id: userAId, ...base } : { group_id: groupAId, ...base }
    const { data, error } = await admin.from('real_expenses').insert(payload).select('id').single()
    if (error || !data) throw error ?? new Error('expense insert returned no row')
    return data.id
  }

  async function seedIncome(args: {
    amount: number
    appliedToBalanceAt?: string | null
    isCarriedOver?: boolean
    carriedFromRecapId?: string | null
    ownerKind?: 'profile' | 'group'
  }): Promise<string> {
    const ownerKind = args.ownerKind ?? 'profile'
    const base = {
      amount: args.amount,
      description: 'integration-seed',
      applied_to_balance_at: args.appliedToBalanceAt ?? null,
      is_carried_over: args.isCarriedOver ?? false,
      carried_from_recap_id: args.carriedFromRecapId ?? null,
    }
    const payload: Database['public']['Tables']['real_income_entries']['Insert'] =
      ownerKind === 'profile' ? { profile_id: userAId, ...base } : { group_id: groupAId, ...base }
    const { data, error } = await admin
      .from('real_income_entries')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error('income insert returned no row')
    return data.id
  }

  async function readBalance(filter: { profileId?: string; groupId?: string }): Promise<number> {
    let query = admin.from('bank_balances').select('balance')
    query = filter.profileId
      ? query.eq('profile_id', filter.profileId).is('group_id', null)
      : query.eq('group_id', filter.groupId as string).is('profile_id', null)
    const { data, error } = await query.single()
    if (error) throw error
    return Number(data?.balance)
  }

  async function getContributionExpenseMirror(profileId: string) {
    const { data } = await admin
      .from('real_expenses')
      .select(
        'id, amount, is_carried_over, carried_from_recap_id, applied_to_balance_at, last_applied_amount, contribution_id',
      )
      .eq('profile_id', profileId)
      .not('contribution_id', 'is', null)
      .maybeSingle()
    return data
  }

  async function getContributionIncomeMirrorForMember(groupId: string, memberProfileId: string) {
    const { data } = await admin
      .from('real_income_entries')
      .select(
        'id, amount, is_carried_over, carried_from_recap_id, applied_to_balance_at, last_applied_amount, contribution_id',
      )
      .eq('group_id', groupId)
      .eq('created_by_profile_id', memberProfileId)
      .not('contribution_id', 'is', null)
      .maybeSingle()
    return data
  }

  it('happy profile — snapshot applied + transactions processed + completed_at set', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const b1 = await seedBudget({ estimated: 200 })
    const b2 = await seedBudget({ estimated: 300 })
    const recap = await seedRecap({
      ownerKind: 'profile',
      budgetSnapshotData: { [b1]: 20, [b2]: 30 },
    })

    const appliedTs = new Date().toISOString()
    await seedExpense({ amount: 10, appliedToBalanceAt: appliedTs })
    await seedExpense({ amount: 20, appliedToBalanceAt: appliedTs })
    await seedExpense({ amount: 30, appliedToBalanceAt: appliedTs })
    const nonAppliedExpense1 = await seedExpense({ amount: 5 })
    const nonAppliedExpense2 = await seedExpense({ amount: 7 })
    await seedIncome({ amount: 100, appliedToBalanceAt: appliedTs })
    await seedIncome({ amount: 200, appliedToBalanceAt: appliedTs })
    const nonAppliedIncome = await seedIncome({ amount: 50 })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        completed: true
        recapId: string
        snapshotApplied: { applied: Array<{ budget_id: string; amount: number }> } | null
        transactions: {
          deleted_expenses: number
          deleted_incomes: number
          carried_expenses: number
          carried_incomes: number
        }
      }
    }

    expect(body.data.completed).toBe(true)
    expect(body.data.recapId).toBe(recap.id)
    expect(body.data.snapshotApplied?.applied).toHaveLength(2)
    expect(body.data.transactions).toEqual({
      deleted_expenses: 3,
      deleted_incomes: 2,
      carried_expenses: 2,
      carried_incomes: 1,
    })

    // Budgets — carryover_spent_amount incremented
    const { data: budgets } = await admin
      .from('estimated_budgets')
      .select('id, carryover_spent_amount, carryover_applied_date')
      .in('id', [b1, b2])
    const byId = new Map(
      (budgets ?? []).map((b) => [
        b.id,
        { spent: Number(b.carryover_spent_amount), appliedAt: b.carryover_applied_date },
      ]),
    )
    expect(byId.get(b1)?.spent).toBe(20)
    expect(byId.get(b2)?.spent).toBe(30)
    expect(byId.get(b1)?.appliedAt).not.toBeNull()

    // Recap completed
    const { data: completedRecap } = await admin
      .from('monthly_recaps')
      .select('completed_at, current_step')
      .eq('id', recap.id)
      .single()
    expect(completedRecap?.completed_at).not.toBeNull()
    expect(completedRecap?.current_step).toBe('completed')

    // Non-applied expenses flagged carried_over with recap id
    const { data: carriedExpenses } = await admin
      .from('real_expenses')
      .select('id, is_carried_over, carried_from_recap_id')
      .in('id', [nonAppliedExpense1, nonAppliedExpense2])
    expect(carriedExpenses).toHaveLength(2)
    for (const row of carriedExpenses ?? []) {
      expect(row.is_carried_over).toBe(true)
      expect(row.carried_from_recap_id).toBe(recap.id)
    }

    // Non-applied incomes flagged
    const { data: carriedIncomes } = await admin
      .from('real_income_entries')
      .select('id, is_carried_over, carried_from_recap_id')
      .eq('id', nonAppliedIncome)
    expect(carriedIncomes?.[0]?.is_carried_over).toBe(true)
    expect(carriedIncomes?.[0]?.carried_from_recap_id).toBe(recap.id)

    // Validated transactions DELETEd entirely
    const { data: remainingExpenses } = await admin
      .from('real_expenses')
      .select('id')
      .eq('profile_id', userAId)
    expect(remainingExpenses).toHaveLength(2) // only the 2 carried ones remain
  })

  it('idempotency — second call returns alreadyCompleted=true', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })

    const r1 = await POST(buildRequest({ context: 'profile' }))
    expect(r1.status).toBe(200)

    const r2 = await POST(buildRequest({ context: 'profile' }))
    expect(r2.status).toBe(200)
    const body = (await r2.json()) as {
      data: { alreadyCompleted: true; recap: { id: string; completed_at: string | null } }
    }
    expect(body.data.alreadyCompleted).toBe(true)
    expect(body.data.recap.completed_at).not.toBeNull()
  })

  it('no_active_recap (and no completed row) → 404', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    // No recap seeded

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('no_active_recap')
  })

  it('not_initiator (group started by userB) → 403', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'group', startedBy: userBId })

    const response = await POST(buildRequest({ context: 'group' }))
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('not_initiator')
  })

  it("current_step='salary_update' → 409 invalid_step", async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile', currentStep: 'salary_update' })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; currentStep: string }
    expect(body.error).toBe('invalid_step')
    expect(body.currentStep).toBe('salary_update')
  })

  it('empty snapshot — snapshotApplied={applied:[],reset_count:0}, still processes + marks completed', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const recap = await seedRecap({ ownerKind: 'profile', budgetSnapshotData: {} })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        snapshotApplied: { applied: unknown[]; reset_count: number } | null
        completed: true
        recapId: string
      }
    }
    // finalize_recap_apply_snapshot always returns {applied, reset_count} since
    // the OVERWRITE-semantics rewrite (20260603000000_finalize_overwrite_carryover.sql)
    // — it's never null, even for an empty snapshot (that's precisely how stale
    // carryovers get reset to 0). reset_count=0 here because this test seeds no
    // estimated_budgets for the owner.
    expect(body.data.snapshotApplied).toEqual({ applied: [], reset_count: 0 })
    expect(body.data.completed).toBe(true)
    expect(body.data.recapId).toBe(recap.id)
  })

  it('no expenses + no incomes — counts all zero, still completed', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    await seedRecap({ ownerKind: 'profile' })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        transactions: {
          deleted_expenses: number
          deleted_incomes: number
          carried_expenses: number
          carried_incomes: number
        }
      }
    }
    expect(body.data.transactions).toEqual({
      deleted_expenses: 0,
      deleted_incomes: 0,
      carried_expenses: 0,
      carried_incomes: 0,
    })
  })

  it('happy group — uses group_id filter (only group transactions touched)', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const recap = await seedRecap({ ownerKind: 'group' })

    const appliedTs = new Date().toISOString()
    await seedExpense({ amount: 50, appliedToBalanceAt: appliedTs, ownerKind: 'group' })
    const nonAppliedGroup = await seedExpense({ amount: 30, ownerKind: 'group' })

    // Also seed a profile-scoped expense that MUST NOT be touched
    const profileExpense = await seedExpense({ amount: 999, ownerKind: 'profile' })

    const response = await POST(buildRequest({ context: 'group' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { transactions: { deleted_expenses: number; carried_expenses: number } }
    }
    expect(body.data.transactions.deleted_expenses).toBe(1)
    expect(body.data.transactions.carried_expenses).toBe(1)

    // Group expense carried
    const { data: carried } = await admin
      .from('real_expenses')
      .select('id, is_carried_over, carried_from_recap_id')
      .eq('id', nonAppliedGroup)
      .single()
    expect(carried?.is_carried_over).toBe(true)
    expect(carried?.carried_from_recap_id).toBe(recap.id)

    // Profile expense untouched
    const { data: untouched } = await admin
      .from('real_expenses')
      .select('id, is_carried_over, carried_from_recap_id')
      .eq('id', profileExpense)
      .single()
    expect(untouched?.is_carried_over).toBe(false)
    expect(untouched?.carried_from_recap_id).toBeNull()
  })

  it('prior carried-over rows are NOT re-processed (is_carried_over=false filter)', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const recap = await seedRecap({ ownerKind: 'profile' })

    // Pre-existing carried-over row from an "earlier" recap (use the current
    // recap id as a stand-in — the filter only checks is_carried_over).
    const priorRow = await seedExpense({
      amount: 42,
      isCarriedOver: true,
      carriedFromRecapId: recap.id,
    })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { transactions: { deleted_expenses: number; carried_expenses: number } }
    }
    // Prior row not counted in any bucket
    expect(body.data.transactions.deleted_expenses).toBe(0)
    expect(body.data.transactions.carried_expenses).toBe(0)

    // Row still present, untouched
    const { data: stillThere } = await admin
      .from('real_expenses')
      .select('id, is_carried_over, carried_from_recap_id')
      .eq('id', priorRow)
      .single()
    expect(stillThere?.is_carried_over).toBe(true)
    expect(stillThere?.carried_from_recap_id).toBe(recap.id)
  })

  it('snapshot pointing at non-existent budget id → applied list empty for that key', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId
    const bogusBudgetId = '00000000-0000-0000-0000-000000000000'
    const b1 = await seedBudget({ estimated: 100 })
    await seedRecap({
      ownerKind: 'profile',
      budgetSnapshotData: { [b1]: 10, [bogusBudgetId]: 99 },
    })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { snapshotApplied: { applied: Array<{ budget_id: string; amount: number }> } | null }
    }
    expect(body.data.snapshotApplied?.applied).toHaveLength(1)
    expect(body.data.snapshotApplied?.applied[0]?.budget_id).toBe(b1)
  })

  // Regression tests for the 2026-07-05 fix: process_recap_transactions must
  // never touch contribution-mirror rows (real_expenses/real_income_entries
  // with contribution_id set). Seeding goes through the real DB triggers
  // (group-owned estimated_budgets insert → calculate_group_contributions →
  // sync_contribution_real_expense/_income), mirroring
  // lib/__tests__/contribution-real-expense.test.ts, rather than faking
  // contribution_id — the FK to group_contributions(id) requires a real row.

  it('validated contribution mirror (profile expense) survives /complete — balance unperturbed', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const { error: bankErr } = await admin
      .from('bank_balances')
      .insert({ profile_id: userAId, group_id: null, balance: 1000 })
    if (bankErr) throw bankErr

    // Group-owned budget cascades: estimated_budgets_sync_group_budget →
    // calculate_group_contributions → sync_contribution_real_expense creates
    // userA's profile-side mirror row.
    await seedBudget({ estimated: 400, ownerKind: 'group' })

    const mirror = await getContributionExpenseMirror(userAId)
    expect(mirror).not.toBeNull()

    const { error: applyErr } = await admin.rpc('toggle_real_expense_applied_to_balance', {
      p_expense_id: mirror!.id,
      p_apply: true,
    })
    expect(applyErr).toBeNull()

    const balanceBefore = await readBalance({ profileId: userAId })
    const recap = await seedRecap({ ownerKind: 'profile' })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { recapId: string } }
    expect(body.data.recapId).toBe(recap.id)

    // The whole point of the fix: the erroneous credit_balance_on_contribution_delete
    // restitution must NOT fire, because the mirror must never be DELETEd here.
    const balanceAfter = await readBalance({ profileId: userAId })
    expect(balanceAfter).toBe(balanceBefore)

    const mirrorAfter = await getContributionExpenseMirror(userAId)
    expect(mirrorAfter).not.toBeNull()
    expect(mirrorAfter!.id).toBe(mirror!.id)
    expect(mirrorAfter!.is_carried_over).toBe(false)
    expect(mirrorAfter!.carried_from_recap_id).toBeNull()
    expect(mirrorAfter!.applied_to_balance_at).not.toBeNull()
  })

  it('validated contribution mirror (group income) survives /complete in group context — group balance unperturbed', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const { error: bankErr } = await admin
      .from('bank_balances')
      .insert({ profile_id: null, group_id: groupAId, balance: 500 })
    if (bankErr) throw bankErr

    await seedBudget({ estimated: 400, ownerKind: 'group' })

    const mirror = await getContributionIncomeMirrorForMember(groupAId, userAId)
    expect(mirror).not.toBeNull()

    const { error: applyErr } = await admin.rpc('toggle_real_income_applied_to_balance', {
      p_income_id: mirror!.id,
      p_apply: true,
    })
    expect(applyErr).toBeNull()

    const balanceBefore = await readBalance({ groupId: groupAId })
    const recap = await seedRecap({ ownerKind: 'group' })

    const response = await POST(buildRequest({ context: 'group' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { recapId: string } }
    expect(body.data.recapId).toBe(recap.id)

    const balanceAfter = await readBalance({ groupId: groupAId })
    expect(balanceAfter).toBe(balanceBefore)

    const mirrorAfter = await getContributionIncomeMirrorForMember(groupAId, userAId)
    expect(mirrorAfter).not.toBeNull()
    expect(mirrorAfter!.id).toBe(mirror!.id)
    expect(mirrorAfter!.is_carried_over).toBe(false)
    expect(mirrorAfter!.carried_from_recap_id).toBeNull()
    expect(mirrorAfter!.applied_to_balance_at).not.toBeNull()
  })

  it('unvalidated contribution mirror is never marked carried-over by /complete', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    await seedBudget({ estimated: 250, ownerKind: 'group' })

    const mirror = await getContributionExpenseMirror(userAId)
    expect(mirror).not.toBeNull()
    expect(mirror!.applied_to_balance_at).toBeNull()

    await seedRecap({ ownerKind: 'profile' })
    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)

    const mirrorAfter = await getContributionExpenseMirror(userAId)
    expect(mirrorAfter).not.toBeNull()
    expect(mirrorAfter!.id).toBe(mirror!.id)
    expect(mirrorAfter!.is_carried_over).toBe(false)
    expect(mirrorAfter!.carried_from_recap_id).toBeNull()
  })
})
