import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

// Sprint Exceptional-Expense-Piggy-Funding — gated tests for the
// `add_exceptional_expense_with_piggy` RPC + its TS helper. Mirrors
// delete-budget-with-savings-transfer.test.ts: dynamic import in beforeAll,
// FK-safe cleanup cascade, chunked concurrency. Pins the atomic contract —
// piggy debit + INSERT real_expenses (is_exceptional) + INSERT
// expense_savings_sources commit together or roll back together. Round-trip
// with delete_expense_with_sources_refund proves the piggy is restored on delete.

type ExpensesMod = typeof import('@/lib/finance/expenses')

const ENABLED = process.env.SUPABASE_RPC_CONCURRENCY_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('add_exceptional_expense_with_piggy (Sprint Exceptional-Piggy)', () => {
  let admin: SupabaseClient<Database>
  let testUserId: string
  let testGroupId: string
  let testGroupAdminId: string
  let addExceptionalExpenseWithPiggy: ExpensesMod['addExceptionalExpenseWithPiggy']
  let deleteExpenseWithSourcesRefund: ExpensesMod['deleteExpenseWithSourcesRefund']

  const stamp = Date.now()
  const testEmail = `exc-piggy-${stamp}@popoth.test`
  const testPassword = `exc-${randomUUID()}`
  const groupAdminEmail = `exc-piggy-admin-${stamp}@popoth.test`
  const groupAdminPassword = `exc-${randomUUID()}`

  const EXPENSE_DATE = '2026-05-29'

  async function setProfilePiggy(profileId: string, amount: number) {
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

  async function removeProfilePiggy(profileId: string) {
    const { error } = await admin.from('piggy_bank').delete().eq('profile_id', profileId)
    if (error) throw error
  }

  async function setGroupPiggy(groupId: string, amount: number) {
    const { data: existing } = await admin
      .from('piggy_bank')
      .select('id')
      .eq('group_id', groupId)
      .maybeSingle()
    if (existing) {
      const { error } = await admin.from('piggy_bank').update({ amount }).eq('group_id', groupId)
      if (error) throw error
    } else {
      const { error } = await admin.from('piggy_bank').insert({ group_id: groupId, amount })
      if (error) throw error
    }
  }

  async function fetchProfilePiggyOrNull(profileId: string): Promise<number | null> {
    const { data, error } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', profileId)
      .maybeSingle()
    if (error) throw error
    return data ? Number(data.amount ?? 0) : null
  }

  async function fetchGroupPiggyOrNull(groupId: string): Promise<number | null> {
    const { data, error } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('group_id', groupId)
      .maybeSingle()
    if (error) throw error
    return data ? Number(data.amount ?? 0) : null
  }

  async function fetchExpense(expenseId: string) {
    const { data } = await admin
      .from('real_expenses')
      .select(
        'id, amount, is_exceptional, estimated_budget_id, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget, created_by_profile_id',
      )
      .eq('id', expenseId)
      .maybeSingle()
    return data
  }

  async function fetchPiggySources(expenseId: string) {
    const { data, error } = await admin
      .from('expense_savings_sources')
      .select('source_type, source_budget_id, amount')
      .eq('real_expense_id', expenseId)
    if (error) throw error
    return data ?? []
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
        'exceptional-piggy tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const mod = await import('@/lib/finance/expenses')
    addExceptionalExpenseWithPiggy = mod.addExceptionalExpenseWithPiggy
    deleteExpenseWithSourcesRefund = mod.deleteExpenseWithSourcesRefund

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'Exc',
      last_name: 'Piggy',
    })
    if (profErr) throw profErr

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
    // Clear any expense rows left from a prior test, then reset piggy state.
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('real_expenses').delete().eq('group_id', testGroupId)
    await removeProfilePiggy(testUserId)
    await admin.from('piggy_bank').delete().eq('group_id', testGroupId)
  })

  afterEach(async () => {
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('real_expenses').delete().eq('group_id', testGroupId)
  })

  afterAll(async () => {
    if (!admin) return
    // expense_savings_sources ON DELETE CASCADE via real_expenses.
    await admin
      .from('real_expenses')
      .delete()
      .or(`profile_id.eq.${testUserId},group_id.eq.${testGroupId}`)
    await admin
      .from('piggy_bank')
      .delete()
      .or(`profile_id.eq.${testUserId},group_id.eq.${testGroupId}`)
    await admin.from('profiles').update({ group_id: null }).eq('id', testGroupAdminId)
    await admin.from('groups').delete().eq('id', testGroupId)
    if (testUserId) await admin.auth.admin.deleteUser(testUserId)
    if (testGroupAdminId) await admin.auth.admin.deleteUser(testGroupAdminId)
  }, 30_000)

  // ============================================================================
  // Happy paths
  // ============================================================================

  it('profile partial: piggy 200, expense 300 funded 200 → piggy 0, own-money 100, 1 source', async () => {
    await setProfilePiggy(testUserId, 200)

    const { expense_id } = await addExceptionalExpenseWithPiggy(
      { profile_id: testUserId },
      {
        amount: 300,
        description: 'Vacances imprévues',
        expenseDate: EXPENSE_DATE,
        amountFromPiggyBank: 200,
        createdByProfileId: testUserId,
      },
    )

    expect(await fetchProfilePiggyOrNull(testUserId)).toBe(0)

    const row = await fetchExpense(expense_id)
    expect(row).not.toBeNull()
    expect(row?.is_exceptional).toBe(true)
    expect(row?.estimated_budget_id).toBeNull()
    expect(Number(row?.amount)).toBe(300)
    expect(Number(row?.amount_from_piggy_bank)).toBe(200)
    expect(Number(row?.amount_from_budget_savings)).toBe(0)
    expect(Number(row?.amount_from_budget)).toBe(100)
    expect(row?.created_by_profile_id).toBe(testUserId)

    const sources = await fetchPiggySources(expense_id)
    expect(sources).toHaveLength(1)
    expect(sources[0]?.source_type).toBe('piggy')
    expect(sources[0]?.source_budget_id).toBeNull()
    expect(Number(sources[0]?.amount)).toBe(200)
  }, 30_000)

  it('profile full coverage: piggy 150, expense 150 funded 150 → piggy 0, own-money 0', async () => {
    await setProfilePiggy(testUserId, 150)

    const { expense_id } = await addExceptionalExpenseWithPiggy(
      { profile_id: testUserId },
      {
        amount: 150,
        description: 'Réparation',
        expenseDate: EXPENSE_DATE,
        amountFromPiggyBank: 150,
        createdByProfileId: testUserId,
      },
    )

    expect(await fetchProfilePiggyOrNull(testUserId)).toBe(0)
    const row = await fetchExpense(expense_id)
    expect(Number(row?.amount_from_piggy_bank)).toBe(150)
    expect(Number(row?.amount_from_budget)).toBe(0)
  }, 30_000)

  it('group context: group piggy 75, expense 100 funded 75 → group piggy 0, own-money 25', async () => {
    await setGroupPiggy(testGroupId, 75)

    const { expense_id } = await addExceptionalExpenseWithPiggy(
      { group_id: testGroupId },
      {
        amount: 100,
        description: 'Sortie groupe',
        expenseDate: EXPENSE_DATE,
        amountFromPiggyBank: 75,
        createdByProfileId: testGroupAdminId,
      },
    )

    expect(await fetchGroupPiggyOrNull(testGroupId)).toBe(0)
    const row = await fetchExpense(expense_id)
    expect(row?.is_exceptional).toBe(true)
    expect(Number(row?.amount_from_piggy_bank)).toBe(75)
    expect(Number(row?.amount_from_budget)).toBe(25)
  }, 30_000)

  // ============================================================================
  // Atomicity / error paths
  // ============================================================================

  it('insufficient piggy: piggy 50, funded 200 → raises, NO expense row, piggy unchanged', async () => {
    await setProfilePiggy(testUserId, 50)

    await expect(
      addExceptionalExpenseWithPiggy(
        { profile_id: testUserId },
        {
          amount: 300,
          description: 'Trop cher',
          expenseDate: EXPENSE_DATE,
          amountFromPiggyBank: 200,
          createdByProfileId: testUserId,
        },
      ),
    ).rejects.toThrow()

    // Atomicity: piggy untouched, no expense created.
    expect(await fetchProfilePiggyOrNull(testUserId)).toBe(50)
    const { count } = await admin
      .from('real_expenses')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', testUserId)
    expect(count ?? 0).toBe(0)
  }, 30_000)

  it('fresh account (no piggy row) + funded > 0 → raises (ensure-row 0 then overdraft), no row left', async () => {
    await removeProfilePiggy(testUserId)

    await expect(
      addExceptionalExpenseWithPiggy(
        { profile_id: testUserId },
        {
          amount: 50,
          description: 'Sans tirelire',
          expenseDate: EXPENSE_DATE,
          amountFromPiggyBank: 50,
          createdByProfileId: testUserId,
        },
      ),
    ).rejects.toThrow()

    // The ensure-row INSERT (amount 0) must have rolled back with the failed tx.
    expect(await fetchProfilePiggyOrNull(testUserId)).toBeNull()
  }, 30_000)

  it('XOR violation: both profile_id + group_id → RPC raises', async () => {
    const { error } = await admin.rpc('add_exceptional_expense_with_piggy', {
      p_amount: 100,
      p_description: 'XOR',
      p_expense_date: EXPENSE_DATE,
      p_amount_from_piggy_bank: 10,
      p_profile_id: testUserId,
      p_group_id: testGroupId,
      p_created_by_profile_id: testUserId,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/exactly one|p_profile_id|p_group_id/i)
  }, 30_000)

  // ============================================================================
  // Round-trip : delete restores the piggy
  // ============================================================================

  it('round-trip: create (piggy 200 → 0) then delete refund → piggy back to 200, row gone', async () => {
    await setProfilePiggy(testUserId, 200)

    const { expense_id } = await addExceptionalExpenseWithPiggy(
      { profile_id: testUserId },
      {
        amount: 250,
        description: 'À annuler',
        expenseDate: EXPENSE_DATE,
        amountFromPiggyBank: 200,
        createdByProfileId: testUserId,
      },
    )
    expect(await fetchProfilePiggyOrNull(testUserId)).toBe(0)

    const res = await deleteExpenseWithSourcesRefund(expense_id)
    expect(res.sources_refunded).toBe(1)
    expect(await fetchProfilePiggyOrNull(testUserId)).toBe(200)
    expect(await fetchExpense(expense_id)).toBeNull()
  }, 30_000)

  // ============================================================================
  // Atomicity under concurrency
  // ============================================================================

  it('30 concurrent creates each funding 1€ from piggy 30 → piggy 0, 30 rows, each 1 source', async () => {
    await setProfilePiggy(testUserId, 30)

    const results = await chunked(
      Array.from(
        { length: 30 },
        (_, i) => () =>
          addExceptionalExpenseWithPiggy(
            { profile_id: testUserId },
            {
              amount: 1,
              description: `Concurrent ${i}`,
              expenseDate: EXPENSE_DATE,
              amountFromPiggyBank: 1,
              createdByProfileId: testUserId,
            },
          ).then(
            (r) => r.expense_id,
            (err: unknown) => ({ err: err instanceof Error ? err.message : String(err) }),
          ),
      ),
    )

    const successIds = results.filter((r): r is string => typeof r === 'string')
    expect(successIds).toHaveLength(30)
    // Atomicity invariant under concurrency: piggy debited exactly 30×.
    expect(await fetchProfilePiggyOrNull(testUserId)).toBe(0)

    const { count } = await admin
      .from('real_expenses')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', testUserId)
    expect(count ?? 0).toBe(30)
  }, 180_000)
})
