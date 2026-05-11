import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

// Sprint Refactor-I5-followup-v2 — gated concurrency tests for
// `transfer_with_savings_debit` RPC + the `transferWithSavingsDebit` TS
// helper. Mirrors the pattern in rpc-concurrency.test.ts (dynamic import
// in beforeAll, FK-safe cleanup cascade, chunked concurrency).

type BudgetTransfersMod = typeof import('@/lib/finance/budget-transfers')

const ENABLED = process.env.SUPABASE_RPC_CONCURRENCY_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('transfer_with_savings_debit (Sprint Refactor-I5-followup-v2)', () => {
  let admin: SupabaseClient<Database>
  let testUserId: string
  let fromBudgetId: string
  let toBudgetId: string
  let transferWithSavingsDebit: BudgetTransfersMod['transferWithSavingsDebit']

  const stamp = Date.now()
  const testEmail = `transfer-savings-${stamp}@popoth.test`
  const testPassword = `transfer-${randomUUID()}`

  async function resetSavings(amount: number) {
    const { error } = await admin
      .from('estimated_budgets')
      .update({ cumulated_savings: amount })
      .eq('id', fromBudgetId)
    if (error) throw error
  }

  async function deleteAllTransfers() {
    const { error } = await admin.from('budget_transfers').delete().eq('profile_id', testUserId)
    if (error) throw error
  }

  async function countTransfers(): Promise<number> {
    const { count, error } = await admin
      .from('budget_transfers')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', testUserId)
    if (error) throw error
    return count ?? 0
  }

  // Bounded concurrency — same rationale as rpc-concurrency.test.ts:
  // Postgres serialises row-level UPDATEs, bursts of 10 are enough to
  // exercise the race window without saturating Node's fetch pool.
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
        'transfer_with_savings_debit tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const mod = await import('@/lib/finance/budget-transfers')
    transferWithSavingsDebit = mod.transferWithSavingsDebit

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'Transfer',
      last_name: 'Savings',
    })
    if (profErr) throw profErr

    const { data: fromBudget, error: fromErr } = await admin
      .from('estimated_budgets')
      .insert({
        profile_id: testUserId,
        name: 'From Budget',
        estimated_amount: 500,
        cumulated_savings: 0,
      })
      .select('id')
      .single()
    if (fromErr || !fromBudget) throw fromErr ?? new Error('insert fromBudget failed')
    fromBudgetId = fromBudget.id

    const { data: toBudget, error: toErr } = await admin
      .from('estimated_budgets')
      .insert({
        profile_id: testUserId,
        name: 'To Budget',
        estimated_amount: 500,
        cumulated_savings: 0,
      })
      .select('id')
      .single()
    if (toErr || !toBudget) throw toErr ?? new Error('insert toBudget failed')
    toBudgetId = toBudget.id
  }, 30_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    // budget_transfers FK -> estimated_budgets (ON DELETE CASCADE), but we
    // explicitly delete to keep the test idempotent across re-runs.
    await admin.from('budget_transfers').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 30_000)

  it('happy path: debits cumulated_savings and inserts one transfer row', async () => {
    await resetSavings(100)
    await deleteAllTransfers()

    const result = await transferWithSavingsDebit(
      { profile_id: testUserId },
      { fromBudgetId, toBudgetId, amount: 30 },
    )

    expect(result.cumulated_savings).toBe(70)
    expect(typeof result.transfer_id).toBe('string')

    const { data: budgetData } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', fromBudgetId)
      .single()
    expect(Number(budgetData?.cumulated_savings)).toBe(70)

    expect(await countTransfers()).toBe(1)
  }, 30_000)

  it('insufficient savings: RPC throws AND no transfer row is left behind (atomicity proof)', async () => {
    await resetSavings(10)
    await deleteAllTransfers()

    await expect(
      transferWithSavingsDebit({ profile_id: testUserId }, { fromBudgetId, toBudgetId, amount: 50 }),
    ).rejects.toThrow(/negative|cumulated_savings/i)

    // Savings unchanged (RPC raised before/at the savings UPDATE)
    const { data: budgetData } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', fromBudgetId)
      .single()
    expect(Number(budgetData?.cumulated_savings)).toBe(10)

    // Critically: zero transfer rows — the INSERT was rolled back in the same tx
    expect(await countTransfers()).toBe(0)
  }, 30_000)

  it('100 concurrent calls with savings=50 converge to savings=0 with exactly 50 transfer rows', async () => {
    await resetSavings(50)
    await deleteAllTransfers()

    const results = await chunked(
      Array.from(
        { length: 100 },
        () => () =>
          transferWithSavingsDebit(
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

    const { data: budgetData } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', fromBudgetId)
      .single()
    expect(Number(budgetData?.cumulated_savings)).toBe(0)

    // Atomicity invariant: transfer rows count exactly matches successful debits
    expect(await countTransfers()).toBe(50)
  }, 180_000)

  it('XOR violation: passing both profile_id and group_id raises (input validation)', async () => {
    await resetSavings(100)
    await deleteAllTransfers()

    // Bypass the helper (its ContextFilter type prevents this combination at
    // compile time). Test the RPC's runtime guard directly.
    const { error } = await admin.rpc('transfer_with_savings_debit', {
      p_from_budget_id: fromBudgetId,
      p_to_budget_id: toBudgetId,
      p_amount: 10,
      p_profile_id: testUserId,
      p_group_id: testUserId,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/exactly one|p_profile_id|p_group_id/i)

    // Savings unchanged + no transfer row
    const { data: budgetData } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', fromBudgetId)
      .single()
    expect(Number(budgetData?.cumulated_savings)).toBe(100)
    expect(await countTransfers()).toBe(0)
  }, 30_000)
})
