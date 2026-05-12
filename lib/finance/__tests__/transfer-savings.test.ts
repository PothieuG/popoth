import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

// Sprint Atomicity-Savings — gated concurrency tests for the
// `transfer_savings_between_budgets` and `transfer_budget_to_piggy_bank`
// RPCs + their TS helpers. Mirrors add-expense-with-breakdown.test.ts
// (Sprint Atomicity-Expenses): dynamic import in beforeAll, FK-safe
// cleanup cascade, chunked concurrency. Pins the atomicity invariant —
// overdraft on either leg rolls back the whole tx, leaving no
// partial state observable.

type SavingsMod = typeof import('@/lib/finance/savings')

const ENABLED = process.env.SUPABASE_RPC_CONCURRENCY_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('savings transfer RPCs (Sprint Atomicity-Savings)', () => {
  let admin: SupabaseClient<Database>
  let testUserId: string
  let fromBudgetId: string
  let toBudgetId: string
  let transferSavingsBetweenBudgets: SavingsMod['transferSavingsBetweenBudgets']
  let transferBudgetToPiggyBank: SavingsMod['transferBudgetToPiggyBank']

  const stamp = Date.now()
  const testEmail = `savings-transfer-${stamp}@popoth.test`
  const testPassword = `transfer-${randomUUID()}`

  async function setBudgetSavings(budgetId: string, amount: number) {
    const { error } = await admin
      .from('estimated_budgets')
      .update({ cumulated_savings: amount })
      .eq('id', budgetId)
    if (error) throw error
  }

  async function fetchBudgetSavings(budgetId: string): Promise<number> {
    const { data, error } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', budgetId)
      .single()
    if (error) throw error
    return Number(data?.cumulated_savings ?? 0)
  }

  async function ensurePiggyExists(amount: number) {
    const { data: existing } = await admin
      .from('piggy_bank')
      .select('id')
      .eq('profile_id', testUserId)
      .maybeSingle()
    if (existing) {
      const { error } = await admin
        .from('piggy_bank')
        .update({ amount })
        .eq('profile_id', testUserId)
      if (error) throw error
    } else {
      const { error } = await admin
        .from('piggy_bank')
        .insert({ profile_id: testUserId, amount })
      if (error) throw error
    }
  }

  async function ensurePiggyMissing() {
    const { error } = await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    if (error) throw error
  }

  async function fetchPiggyAmountOrNull(): Promise<number | null> {
    const { data, error } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', testUserId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return Number(data.amount ?? 0)
  }

  // Bounded concurrency — Postgres serialises row-level UPDATEs.
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
        'transfer-savings tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const mod = await import('@/lib/finance/savings')
    transferSavingsBetweenBudgets = mod.transferSavingsBetweenBudgets
    transferBudgetToPiggyBank = mod.transferBudgetToPiggyBank

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'Savings',
      last_name: 'Transfer',
    })
    if (profErr) throw profErr

    const { data: from, error: fromErr } = await admin
      .from('estimated_budgets')
      .insert({
        profile_id: testUserId,
        name: 'From Budget',
        estimated_amount: 200,
        cumulated_savings: 0,
      })
      .select('id')
      .single()
    if (fromErr || !from) throw fromErr ?? new Error('insert from budget failed')
    fromBudgetId = from.id

    const { data: to, error: toErr } = await admin
      .from('estimated_budgets')
      .insert({
        profile_id: testUserId,
        name: 'To Budget',
        estimated_amount: 200,
        cumulated_savings: 0,
      })
      .select('id')
      .single()
    if (toErr || !to) throw toErr ?? new Error('insert to budget failed')
    toBudgetId = to.id
  }, 30_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    // FK cascade: budget_transfers.from_budget_id and .to_budget_id
    // reference estimated_budgets ON DELETE CASCADE/SET NULL — neither
    // RPC writes to budget_transfers, but clean defensively.
    await admin
      .from('budget_transfers')
      .delete()
      .or(`from_budget_id.eq.${fromBudgetId},from_budget_id.eq.${toBudgetId}`)
    await admin
      .from('budget_transfers')
      .delete()
      .or(`to_budget_id.eq.${fromBudgetId},to_budget_id.eq.${toBudgetId}`)
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 30_000)

  // ============================================================================
  // transfer_savings_between_budgets — 4 cases
  // ============================================================================

  it('between budgets — happy: debit FROM + credit TO, returns final amounts', async () => {
    await setBudgetSavings(fromBudgetId, 100)
    await setBudgetSavings(toBudgetId, 50)

    const result = await transferSavingsBetweenBudgets(
      { profile_id: testUserId },
      { fromBudgetId, toBudgetId, amount: 30 },
    )

    expect(Number(result.from_savings)).toBe(70)
    expect(Number(result.to_savings)).toBe(80)
    expect(await fetchBudgetSavings(fromBudgetId)).toBe(70)
    expect(await fetchBudgetSavings(toBudgetId)).toBe(80)
  }, 30_000)

  it('between budgets — insufficient FROM: RPC throws, BOTH sides unchanged (atomicity proof)', async () => {
    await setBudgetSavings(fromBudgetId, 10)
    await setBudgetSavings(toBudgetId, 50)

    await expect(
      transferSavingsBetweenBudgets(
        { profile_id: testUserId },
        { fromBudgetId, toBudgetId, amount: 50 },
      ),
    ).rejects.toThrow(/negative|cumulated_savings/i)

    // CRITICAL: TO was never credited (the debit raised before the credit).
    // Pre-fix this was OK because the credit hadn't happened yet — but the
    // converse case (credit succeeds, then a hypothetical second debit step
    // fails) would have leaked. The atomic RPC guarantees both legs commit
    // together or not at all.
    expect(await fetchBudgetSavings(fromBudgetId)).toBe(10)
    expect(await fetchBudgetSavings(toBudgetId)).toBe(50)
  }, 30_000)

  it('between budgets — 100 concurrent calls converge: FROM=0, TO=+50, exactly 50 succeed', async () => {
    await setBudgetSavings(fromBudgetId, 50)
    await setBudgetSavings(toBudgetId, 0)

    const results = await chunked(
      Array.from(
        { length: 100 },
        () => () =>
          transferSavingsBetweenBudgets(
            { profile_id: testUserId },
            { fromBudgetId, toBudgetId, amount: 1 },
          ).then(
            () => 'ok' as const,
            (err: unknown) => ({ err: err instanceof Error ? err.message : String(err) }),
          ),
      ),
    )

    const okCount = results.filter((r) => r === 'ok').length
    const failCount = results.length - okCount
    expect(okCount).toBe(50)
    expect(failCount).toBe(50)

    // Atomicity invariant under concurrency: TO credit count exactly
    // matches FROM debit count (no torn writes).
    expect(await fetchBudgetSavings(fromBudgetId)).toBe(0)
    expect(await fetchBudgetSavings(toBudgetId)).toBe(50)
  }, 180_000)

  it('between budgets — XOR violation: both profile_id and group_id raises', async () => {
    await setBudgetSavings(fromBudgetId, 100)
    await setBudgetSavings(toBudgetId, 0)

    // Bypass the helper (its ContextFilter type prevents this combination
    // at compile time). Test the RPC's runtime guard directly.
    const { error } = await admin.rpc('transfer_savings_between_budgets', {
      p_from_budget_id: fromBudgetId,
      p_to_budget_id: toBudgetId,
      p_amount: 10,
      p_profile_id: testUserId,
      p_group_id: testUserId,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/exactly one|p_profile_id|p_group_id/i)
    expect(await fetchBudgetSavings(fromBudgetId)).toBe(100)
    expect(await fetchBudgetSavings(toBudgetId)).toBe(0)
  }, 30_000)

  // ============================================================================
  // transfer_budget_to_piggy_bank — 4 cases
  // ============================================================================

  it('budget→piggy — happy UPDATE: piggy exists, debits budget + increments piggy', async () => {
    await setBudgetSavings(fromBudgetId, 100)
    await ensurePiggyExists(20)

    const result = await transferBudgetToPiggyBank(
      { profile_id: testUserId },
      { fromBudgetId, amount: 30 },
    )

    expect(Number(result.from_savings)).toBe(70)
    expect(Number(result.piggy_bank_amount)).toBe(50)
    expect(await fetchBudgetSavings(fromBudgetId)).toBe(70)
    expect(await fetchPiggyAmountOrNull()).toBe(50)
  }, 30_000)

  it('budget→piggy — happy INSERT: piggy missing, debits budget + creates piggy row', async () => {
    await setBudgetSavings(fromBudgetId, 100)
    await ensurePiggyMissing()

    const result = await transferBudgetToPiggyBank(
      { profile_id: testUserId },
      { fromBudgetId, amount: 30 },
    )

    expect(Number(result.from_savings)).toBe(70)
    expect(Number(result.piggy_bank_amount)).toBe(30)
    expect(await fetchBudgetSavings(fromBudgetId)).toBe(70)
    // New piggy row created via ON CONFLICT-fallthrough (INSERT path).
    expect(await fetchPiggyAmountOrNull()).toBe(30)
  }, 30_000)

  it('budget→piggy — insufficient budget: RPC throws, piggy unchanged (atomicity proof)', async () => {
    await setBudgetSavings(fromBudgetId, 10)
    await ensurePiggyExists(200)

    await expect(
      transferBudgetToPiggyBank({ profile_id: testUserId }, { fromBudgetId, amount: 50 }),
    ).rejects.toThrow(/negative|cumulated_savings/i)

    // CRITICAL: piggy was NOT credited (the budget debit raised before the
    // UPSERT). Pre-Sprint Atomicity-Savings the converse (debit succeeds,
    // piggy UPSERT fails) would have left the budget debited with no piggy
    // credit — manual rollback at L321/L338 was the band-aid. Now Postgres
    // tx rollback is the contract.
    expect(await fetchBudgetSavings(fromBudgetId)).toBe(10)
    expect(await fetchPiggyAmountOrNull()).toBe(200)
  }, 30_000)

  it('budget→piggy — 100 concurrent calls converge: budget=0, piggy=+50, exactly 50 succeed', async () => {
    await setBudgetSavings(fromBudgetId, 50)
    await ensurePiggyExists(0)

    const results = await chunked(
      Array.from(
        { length: 100 },
        () => () =>
          transferBudgetToPiggyBank(
            { profile_id: testUserId },
            { fromBudgetId, amount: 1 },
          ).then(
            () => 'ok' as const,
            (err: unknown) => ({ err: err instanceof Error ? err.message : String(err) }),
          ),
      ),
    )

    const okCount = results.filter((r) => r === 'ok').length
    const failCount = results.length - okCount
    expect(okCount).toBe(50)
    expect(failCount).toBe(50)

    // Atomicity invariant under concurrency: piggy credit count exactly
    // matches budget debit count.
    expect(await fetchBudgetSavings(fromBudgetId)).toBe(0)
    expect(await fetchPiggyAmountOrNull()).toBe(50)
  }, 180_000)
})
