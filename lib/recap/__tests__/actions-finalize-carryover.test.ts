/**
 * Sprint Carryover-Self-Healing 2026-05-26 — gated DB integration tests for
 * the new OVERWRITE semantics of `finalize_recap_apply_snapshot`.
 *
 * Gated by `SUPABASE_RECAP_TESTS=1`. Hits the real `ddehmjucyfgyppfkbddr`
 * dev DB (or prod fallback). The orchestrator is invoked end-to-end : after
 * each finalize we read back `estimated_budgets.carryover_spent_amount` and
 * assert the overwrite (NOT `+=`) + owner-scoped reset behavior.
 *
 * Covered cases (4) :
 *  1. Trajectory : carryover 800 → 600 → 400 → 200 → 0 over 4 finalize loops
 *     with estimated=200 and snapshot computed as the residual debt. Proves
 *     the self-healing math : each month, the unused budget room (estimated)
 *     pays down the carryover, and only the new snapshot persists.
 *  2. Verbatim persistence : starting at carryover=230, finalize with
 *     snapshot={budgetId: 60} → new carryover = 60 (NOT 290 = 230+60).
 *  3. Owner isolation : finalize on user A's recap does NOT touch user B's
 *     budgets (carryover stays untouched on B).
 *  4. Empty snapshot still resets : starting at carryover=150, finalize with
 *     empty `{}` snapshot → carryover = 0 (proves the reset runs even when
 *     no entry is applied).
 */

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/lib/database.types'

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('finalize_recap_apply_snapshot — carryover self-healing (gated)', () => {
  let admin: SupabaseClient<Database>
  let executeCompleteRecap: typeof import('../actions-finalize').executeCompleteRecap

  let userAId: string
  let userBId: string
  const stamp = Date.now()
  const emailA = `recap-carryover-a-${stamp}@popoth.test`
  const emailB = `recap-carryover-b-${stamp}@popoth.test`

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'finalize-carryover tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    const mod = await import('../actions-finalize')
    executeCompleteRecap = mod.executeCompleteRecap

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: dataA, error: errA } = await admin.auth.admin.createUser({
      email: emailA,
      password: randomUUID(),
      email_confirm: true,
    })
    if (errA || !dataA.user) throw errA ?? new Error('createUser A returned no user')
    userAId = dataA.user.id

    const { data: dataB, error: errB } = await admin.auth.admin.createUser({
      email: emailB,
      password: randomUUID(),
      email_confirm: true,
    })
    if (errB || !dataB.user) throw errB ?? new Error('createUser B returned no user')
    userBId = dataB.user.id

    const { error: profError } = await admin.from('profiles').upsert(
      [
        { id: userAId, first_name: 'CarryA', last_name: 'Tester' },
        { id: userBId, first_name: 'CarryB', last_name: 'Tester' },
      ],
      { onConflict: 'id' },
    )
    if (profError) throw profError

    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    await resetState()
  })

  afterAll(async () => {
    if (admin) {
      await resetState()
      if (userAId) await admin.auth.admin.deleteUser(userAId)
      if (userBId) await admin.auth.admin.deleteUser(userBId)
    }
    vi.restoreAllMocks()
  })

  async function resetState() {
    if (userAId) {
      await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
      await admin.from('estimated_budgets').delete().eq('profile_id', userAId)
    }
    if (userBId) {
      await admin.from('monthly_recaps').delete().eq('profile_id', userBId)
      await admin.from('estimated_budgets').delete().eq('profile_id', userBId)
    }
  }

  async function seedBudget(args: {
    profileId: string
    estimatedAmount: number
    carryoverSpentAmount?: number
    name?: string
  }): Promise<string> {
    const payload: Database['public']['Tables']['estimated_budgets']['Insert'] = {
      profile_id: args.profileId,
      name: args.name ?? `budget-${randomUUID().slice(0, 8)}`,
      estimated_amount: args.estimatedAmount,
      carryover_spent_amount: args.carryoverSpentAmount ?? 0,
    }
    const { data, error } = await admin
      .from('estimated_budgets')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error('budget insert returned no row')
    return data.id
  }

  async function seedRecap(args: {
    profileId: string
    budgetSnapshotData: Record<string, number>
  }): Promise<string> {
    const payload: Database['public']['Tables']['monthly_recaps']['Insert'] = {
      profile_id: args.profileId,
      recap_month: currentMonth,
      recap_year: currentYear,
      current_step: 'final_recap',
      started_by_profile_id: args.profileId,
      started_at: new Date().toISOString(),
      completed_at: null,
      budget_snapshot_data: args.budgetSnapshotData as unknown as Json,
      project_snapshot_data: {} as unknown as Json,
    }
    const { data, error } = await admin.from('monthly_recaps').insert(payload).select('id').single()
    if (error || !data) throw error ?? new Error('recap insert returned no row')
    return data.id
  }

  async function readBudgetCarryover(id: string): Promise<number> {
    const { data, error } = await admin
      .from('estimated_budgets')
      .select('carryover_spent_amount')
      .eq('id', id)
      .single()
    if (error || !data) throw error ?? new Error('budget read returned no row')
    return Number(data.carryover_spent_amount ?? 0)
  }

  it('trajectory — carryover 800 → 600 → 400 → 200 → 0 over 4 finalize loops (estimated=200, no spending)', async () => {
    const budgetId = await seedBudget({
      profileId: userAId,
      estimatedAmount: 200,
      carryoverSpentAmount: 800,
    })

    // Each iteration : the user's bilan_deficit at the start of the month is
    // max(0, old_carryover - estimated). User has no piggy/savings/projects,
    // so the snapshot equals that deficit (mirror of executeSaveBudgetSnapshot
    // with capPerPool=false → no shortfall).
    const expected = [600, 400, 200, 0]
    for (let i = 0; i < 4; i++) {
      // Reset recap between iterations (single-recap test harness).
      await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
      const carryBefore = await readBudgetCarryover(budgetId)
      const deficit = Math.max(0, carryBefore - 200)

      const snapshot: Record<string, number> = deficit > 0 ? { [budgetId]: deficit } : {}
      const recapId = await seedRecap({ profileId: userAId, budgetSnapshotData: snapshot })

      await executeCompleteRecap({
        context: 'profile',
        profile: { id: userAId, group_id: null },
        recap: {
          id: recapId,
          budget_snapshot_data: snapshot as unknown as Json,
          project_snapshot_data: {} as unknown as Json,
        },
      })

      const carryAfter = await readBudgetCarryover(budgetId)
      expect(carryAfter).toBe(expected[i])
    }
  })

  it('verbatim persistence — snapshot value OVERWRITES (NOT += old value)', async () => {
    const budgetId = await seedBudget({
      profileId: userAId,
      estimatedAmount: 200,
      carryoverSpentAmount: 230,
    })

    const snapshot = { [budgetId]: 60 }
    const recapId = await seedRecap({ profileId: userAId, budgetSnapshotData: snapshot })

    await executeCompleteRecap({
      context: 'profile',
      profile: { id: userAId, group_id: null },
      recap: {
        id: recapId,
        budget_snapshot_data: snapshot as unknown as Json,
        project_snapshot_data: {} as unknown as Json,
      },
    })

    // 60 (NOT 290 = 230 + 60). Sprint Carryover-Self-Healing invariant.
    expect(await readBudgetCarryover(budgetId)).toBe(60)
  })

  it('owner isolation — finalize on userA does NOT touch userB budgets', async () => {
    const budgetA = await seedBudget({
      profileId: userAId,
      estimatedAmount: 200,
      carryoverSpentAmount: 100,
    })
    const budgetB = await seedBudget({
      profileId: userBId,
      estimatedAmount: 300,
      carryoverSpentAmount: 250,
    })

    const recapId = await seedRecap({
      profileId: userAId,
      budgetSnapshotData: { [budgetA]: 40 },
    })

    await executeCompleteRecap({
      context: 'profile',
      profile: { id: userAId, group_id: null },
      recap: {
        id: recapId,
        budget_snapshot_data: { [budgetA]: 40 } as unknown as Json,
        project_snapshot_data: {} as unknown as Json,
      },
    })

    expect(await readBudgetCarryover(budgetA)).toBe(40)
    // Untouched : userB's carryover remains at its seeded value.
    expect(await readBudgetCarryover(budgetB)).toBe(250)
  })

  it('empty snapshot still resets owner budgets to 0 (stale carryover clear)', async () => {
    const budgetId = await seedBudget({
      profileId: userAId,
      estimatedAmount: 200,
      carryoverSpentAmount: 150,
    })

    const recapId = await seedRecap({ profileId: userAId, budgetSnapshotData: {} })

    await executeCompleteRecap({
      context: 'profile',
      profile: { id: userAId, group_id: null },
      recap: {
        id: recapId,
        budget_snapshot_data: {} as unknown as Json,
        project_snapshot_data: {} as unknown as Json,
      },
    })

    expect(await readBudgetCarryover(budgetId)).toBe(0)
  })
})
