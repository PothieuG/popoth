import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

// Sprint Delete-Budget-Savings-Transfer — gated concurrency tests for the
// `delete_budget_with_savings_transfer` RPC + its TS helper. Mirrors
// transfer-savings.test.ts: dynamic import in beforeAll, FK-safe cleanup
// cascade, chunked concurrency. Pins the atomic contract — savings → piggy
// transfer + DELETE budget commit together or roll back together.

type SavingsMod = typeof import('@/lib/finance/savings')

const ENABLED = process.env.SUPABASE_RPC_CONCURRENCY_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('delete_budget_with_savings_transfer (Sprint Delete-Budget)', () => {
  let admin: SupabaseClient<Database>
  let testUserId: string
  let testGroupId: string
  let testGroupAdminId: string
  let deleteBudgetWithSavingsTransfer: SavingsMod['deleteBudgetWithSavingsTransfer']

  const stamp = Date.now()
  const testEmail = `delete-budget-${stamp}@popoth.test`
  const testPassword = `delete-${randomUUID()}`
  const groupAdminEmail = `delete-budget-admin-${stamp}@popoth.test`
  const groupAdminPassword = `delete-${randomUUID()}`

  async function insertBudget(args: {
    profile_id?: string
    group_id?: string
    cumulated_savings?: number
  }): Promise<string> {
    const { data, error } = await admin
      .from('estimated_budgets')
      .insert({
        profile_id: args.profile_id ?? null,
        group_id: args.group_id ?? null,
        name: `Budget ${randomUUID().slice(0, 8)}`,
        estimated_amount: 100,
        cumulated_savings: args.cumulated_savings ?? 0,
      })
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error('insert budget failed')
    return data.id
  }

  async function budgetExists(budgetId: string): Promise<boolean> {
    const { data } = await admin
      .from('estimated_budgets')
      .select('id')
      .eq('id', budgetId)
      .maybeSingle()
    return data !== null
  }

  async function ensurePiggyExists(profileId: string, amount: number) {
    const { data: existing } = await admin
      .from('piggy_bank')
      .select('id')
      .eq('profile_id', profileId)
      .maybeSingle()
    if (existing) {
      const { error } = await admin
        .from('piggy_bank')
        .update({ amount })
        .eq('profile_id', profileId)
      if (error) throw error
    } else {
      const { error } = await admin.from('piggy_bank').insert({ profile_id: profileId, amount })
      if (error) throw error
    }
  }

  async function ensurePiggyMissing(profileId: string) {
    const { error } = await admin.from('piggy_bank').delete().eq('profile_id', profileId)
    if (error) throw error
  }

  async function ensureGroupPiggyMissing(groupId: string) {
    const { error } = await admin.from('piggy_bank').delete().eq('group_id', groupId)
    if (error) throw error
  }

  async function fetchPiggyAmountOrNull(profileId: string): Promise<number | null> {
    const { data, error } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', profileId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return Number(data.amount ?? 0)
  }

  async function fetchGroupPiggyAmountOrNull(groupId: string): Promise<number | null> {
    const { data, error } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('group_id', groupId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return Number(data.amount ?? 0)
  }

  async function chunked<T>(tasks: Array<() => Promise<T>>, chunkSize = 10): Promise<T[]> {
    const results: T[] = []
    for (let i = 0; i < tasks.length; i += chunkSize) {
      const slice = tasks.slice(i, i + chunkSize)
      results.push(...(await Promise.all(slice.map((t) => t()))))
    }
    return results
  }

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'delete-budget tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const mod = await import('@/lib/finance/savings')
    deleteBudgetWithSavingsTransfer = mod.deleteBudgetWithSavingsTransfer

    // Profile user.
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'Delete',
      last_name: 'Budget',
    })
    if (profErr) throw profErr

    // Group admin user + group (for group context tests).
    const { data: adminData, error: adminErr } = await admin.auth.admin.createUser({
      email: groupAdminEmail,
      password: groupAdminPassword,
      email_confirm: true,
    })
    if (adminErr || !adminData.user) throw adminErr ?? new Error('createUser group admin failed')
    testGroupAdminId = adminData.user.id

    const { error: profAdminErr } = await admin.from('profiles').insert({
      id: testGroupAdminId,
      first_name: 'Group',
      last_name: 'Admin',
    })
    if (profAdminErr) throw profAdminErr

    const { data: groupData, error: groupErr } = await admin
      .from('groups')
      .insert({
        name: `Test Group ${stamp}`,
        creator_id: testGroupAdminId,
        monthly_budget_estimate: 0,
      })
      .select('id')
      .single()
    if (groupErr || !groupData) throw groupErr ?? new Error('insert group failed')
    testGroupId = groupData.id

    const { error: linkErr } = await admin
      .from('profiles')
      .update({ group_id: testGroupId })
      .eq('id', testGroupAdminId)
    if (linkErr) throw linkErr
  }, 30_000)

  beforeEach(async () => {
    // Reset piggy state between tests (each test sets its own precondition).
    await ensurePiggyMissing(testUserId)
    await ensureGroupPiggyMissing(testGroupId)
  })

  afterAll(async () => {
    if (!admin) return
    // FK cascade: budget_transfers references estimated_budgets ON DELETE
    // CASCADE; real_expenses ON DELETE SET NULL.
    await admin
      .from('budget_transfers')
      .delete()
      .or(`profile_id.eq.${testUserId},group_id.eq.${testGroupId}`)
    await admin
      .from('real_expenses')
      .delete()
      .or(`profile_id.eq.${testUserId},group_id.eq.${testGroupId}`)
    await admin
      .from('piggy_bank')
      .delete()
      .or(`profile_id.eq.${testUserId},group_id.eq.${testGroupId}`)
    await admin
      .from('estimated_budgets')
      .delete()
      .or(`profile_id.eq.${testUserId},group_id.eq.${testGroupId}`)
    await admin.from('group_contributions').delete().eq('group_id', testGroupId)
    await admin.from('profiles').update({ group_id: null }).eq('id', testGroupAdminId)
    await admin.from('groups').delete().eq('id', testGroupId)
    if (testUserId) await admin.auth.admin.deleteUser(testUserId)
    if (testGroupAdminId) await admin.auth.admin.deleteUser(testGroupAdminId)
  }, 30_000)

  // ============================================================================
  // Happy paths
  // ============================================================================

  it('profile happy UPDATE: budget with savings + piggy exists → DELETE budget + piggy credited', async () => {
    await ensurePiggyExists(testUserId, 20)
    const budgetId = await insertBudget({ profile_id: testUserId, cumulated_savings: 47.5 })

    const result = await deleteBudgetWithSavingsTransfer({ profile_id: testUserId }, { budgetId })

    expect(Number(result.transferred_amount)).toBe(47.5)
    expect(Number(result.piggy_amount)).toBe(67.5)
    expect(await budgetExists(budgetId)).toBe(false)
    expect(await fetchPiggyAmountOrNull(testUserId)).toBe(67.5)
  }, 30_000)

  it('profile happy INSERT: budget with savings + piggy missing → DELETE budget + piggy created', async () => {
    await ensurePiggyMissing(testUserId)
    const budgetId = await insertBudget({ profile_id: testUserId, cumulated_savings: 100 })

    const result = await deleteBudgetWithSavingsTransfer({ profile_id: testUserId }, { budgetId })

    expect(Number(result.transferred_amount)).toBe(100)
    expect(Number(result.piggy_amount)).toBe(100)
    expect(await budgetExists(budgetId)).toBe(false)
    expect(await fetchPiggyAmountOrNull(testUserId)).toBe(100)
  }, 30_000)

  it('profile no-savings: budget with savings = 0 → DELETE budget, piggy untouched (skip UPSERT)', async () => {
    await ensurePiggyExists(testUserId, 25)
    const budgetId = await insertBudget({ profile_id: testUserId, cumulated_savings: 0 })

    const result = await deleteBudgetWithSavingsTransfer({ profile_id: testUserId }, { budgetId })

    expect(Number(result.transferred_amount)).toBe(0)
    expect(result.piggy_amount).toBeNull()
    expect(await budgetExists(budgetId)).toBe(false)
    // Piggy must not have been touched (skip-UPSERT branch).
    expect(await fetchPiggyAmountOrNull(testUserId)).toBe(25)
  }, 30_000)

  it('group context: budget with savings → DELETE budget + group piggy credited', async () => {
    await ensureGroupPiggyMissing(testGroupId)
    const budgetId = await insertBudget({ group_id: testGroupId, cumulated_savings: 75 })

    const result = await deleteBudgetWithSavingsTransfer({ group_id: testGroupId }, { budgetId })

    expect(Number(result.transferred_amount)).toBe(75)
    expect(Number(result.piggy_amount)).toBe(75)
    expect(await budgetExists(budgetId)).toBe(false)
    expect(await fetchGroupPiggyAmountOrNull(testGroupId)).toBe(75)
  }, 30_000)

  // ============================================================================
  // Error paths
  // ============================================================================

  it('budget not found: nonexistent uuid → throws "not found", piggy untouched', async () => {
    await ensurePiggyExists(testUserId, 50)
    const fakeBudgetId = randomUUID()

    await expect(
      deleteBudgetWithSavingsTransfer({ profile_id: testUserId }, { budgetId: fakeBudgetId }),
    ).rejects.toThrow(/not found|not owned/i)

    // Piggy must be unchanged (atomicity proof).
    expect(await fetchPiggyAmountOrNull(testUserId)).toBe(50)
  }, 30_000)

  it('XOR violation: both profile_id + group_id → RPC raises, budget remains', async () => {
    const budgetId = await insertBudget({ profile_id: testUserId, cumulated_savings: 30 })
    await ensurePiggyExists(testUserId, 10)

    // Bypass the helper (ContextFilter prevents this combination at compile
    // time). Test the RPC's runtime guard directly.
    const { error } = await admin.rpc('delete_budget_with_savings_transfer', {
      p_budget_id: budgetId,
      p_profile_id: testUserId,
      p_group_id: testGroupId,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/exactly one|p_profile_id|p_group_id/i)
    expect(await budgetExists(budgetId)).toBe(true)
    expect(await fetchPiggyAmountOrNull(testUserId)).toBe(10)

    // Cleanup the surviving budget for subsequent tests.
    await admin.from('estimated_budgets').delete().eq('id', budgetId)
  }, 30_000)

  it('ownership mismatch: profile budget queried with different profile_id → throws "not found"', async () => {
    const budgetId = await insertBudget({ profile_id: testUserId, cumulated_savings: 60 })
    await ensurePiggyExists(testUserId, 0)
    const otherProfileId = randomUUID()

    await expect(
      deleteBudgetWithSavingsTransfer({ profile_id: otherProfileId }, { budgetId }),
    ).rejects.toThrow(/not found|not owned/i)

    expect(await budgetExists(budgetId)).toBe(true)
    expect(await fetchPiggyAmountOrNull(testUserId)).toBe(0)
    // Cleanup.
    await admin.from('estimated_budgets').delete().eq('id', budgetId)
  }, 30_000)

  // ============================================================================
  // Atomicity under concurrency
  // ============================================================================

  it('50 concurrent deletes on distinct budgets: piggy aggregates all transfers', async () => {
    await ensurePiggyExists(testUserId, 0)
    // Create 50 budgets each with 1€ savings.
    const budgetIds = await Promise.all(
      Array.from({ length: 50 }, () =>
        insertBudget({ profile_id: testUserId, cumulated_savings: 1 }),
      ),
    )

    const results = await chunked(
      budgetIds.map(
        (budgetId) => () =>
          deleteBudgetWithSavingsTransfer({ profile_id: testUserId }, { budgetId }).then(
            (r) => Number(r.transferred_amount),
            (err: unknown) => ({ err: err instanceof Error ? err.message : String(err) }),
          ),
      ),
    )

    const successCount = results.filter((r) => r === 1).length
    expect(successCount).toBe(50)

    // Atomicity invariant under concurrency: piggy credit count matches
    // budget delete count exactly.
    expect(await fetchPiggyAmountOrNull(testUserId)).toBe(50)
    // All budgets deleted.
    for (const budgetId of budgetIds) {
      expect(await budgetExists(budgetId)).toBe(false)
    }
  }, 180_000)
})
