import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Database } from '@/lib/database.types'

// NOTE: lib/finance/* is loaded dynamically inside beforeAll because it
// transitively evaluates lib/supabase-server.ts which calls createClient at
// module load — that fails when NEXT_PUBLIC_SUPABASE_URL is not set, even if
// the describe block is later skipped.
type PiggyMod = typeof import('@/lib/finance/piggy-bank')
type SavingsMod = typeof import('@/lib/finance/budget-savings')
type BankMod = typeof import('@/lib/finance/bank-balance')

const ENABLED = process.env.SUPABASE_RPC_CONCURRENCY_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('RPC concurrency (Sprint DB D9)', () => {
  let admin: SupabaseClient<Database>
  let testUserId: string
  let testBudgetId: string
  let updatePiggyBank: PiggyMod['updatePiggyBank']
  let transferFromPiggyToBudget: PiggyMod['transferFromPiggyToBudget']
  let updateBudgetCumulatedSavings: SavingsMod['updateBudgetCumulatedSavings']
  let updateBankBalance: BankMod['updateBankBalance']

  const stamp = Date.now()
  const testEmail = `rpc-concurrency-${stamp}@popoth.test`
  const testPassword = `rpc-${randomUUID()}`

  async function reset(piggyAmount: number, savingsAmount: number) {
    const [piggyRes, budgetRes] = await Promise.all([
      admin.from('piggy_bank').update({ amount: piggyAmount }).eq('profile_id', testUserId),
      admin
        .from('estimated_budgets')
        .update({ cumulated_savings: savingsAmount })
        .eq('id', testBudgetId),
    ])
    if (piggyRes.error) throw piggyRes.error
    if (budgetRes.error) throw budgetRes.error
  }

  // Run an array of async tasks with bounded concurrency. Postgres serialises
  // single-row UPDATEs anyway, so we don't need true 100-way parallelism to
  // exercise the race window — bursts of 10 are plenty and avoid hitting the
  // undici default per-origin connection pool ceiling on Node's fetch.
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
        'RPC concurrency tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const piggyMod = await import('@/lib/finance/piggy-bank')
    const savingsMod = await import('@/lib/finance/budget-savings')
    const bankMod = await import('@/lib/finance/bank-balance')
    updatePiggyBank = piggyMod.updatePiggyBank
    transferFromPiggyToBudget = piggyMod.transferFromPiggyToBudget
    updateBudgetCumulatedSavings = savingsMod.updateBudgetCumulatedSavings
    updateBankBalance = bankMod.updateBankBalance

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'RPC',
      last_name: 'Test',
    })
    if (profErr) throw profErr

    const { error: piggyErr } = await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 1000,
    })
    if (piggyErr) throw piggyErr

    const { error: bankErr } = await admin.from('bank_balances').insert({
      profile_id: testUserId,
      group_id: null,
      balance: 100,
    })
    if (bankErr) throw bankErr

    const { data: budgetData, error: budgetErr } = await admin
      .from('estimated_budgets')
      .insert({
        profile_id: testUserId,
        name: 'RPC Test Budget',
        estimated_amount: 500,
        cumulated_savings: 0,
      })
      .select('id')
      .single()
    if (budgetErr || !budgetData) throw budgetErr ?? new Error('insert budget failed')
    testBudgetId = budgetData.id
  }, 30_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    // piggy_bank / bank_balances FK -> profiles(id) have NO ON DELETE; delete manually first.
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('bank_balances').delete().eq('profile_id', testUserId)
    // estimated_budgets cascades from profiles; explicit delete is harmless.
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    // profiles cascades from auth.users on delete.
    await admin.auth.admin.deleteUser(testUserId)
  }, 30_000)

  it('100 × updatePiggyBank(+1) converges to start+100', async () => {
    await reset(1000, 0)
    await chunked(
      Array.from({ length: 100 }, () => () => updatePiggyBank({ profile_id: testUserId }, 1))
    )
    const { data, error } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', testUserId)
      .single()
    expect(error).toBeNull()
    expect(Number(data?.amount)).toBe(1100)
  }, 120_000)

  it('100 × updatePiggyBank(-1) lands exactly at 0; one more decrement throws', async () => {
    await reset(100, 0)
    await chunked(
      Array.from({ length: 100 }, () => () => updatePiggyBank({ profile_id: testUserId }, -1))
    )
    const { data: zeroData } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', testUserId)
      .single()
    expect(Number(zeroData?.amount)).toBe(0)

    // Either error is correct: the RPC's runtime check (commit C3) raises
    // "cannot become negative", and the CHECK constraint (commit D8) rejects
    // with "violates check constraint piggy_bank_amount_check". Whichever
    // fires first wins — DB invariant is preserved either way.
    await expect(updatePiggyBank({ profile_id: testUserId }, -1)).rejects.toThrow(
      /negative|piggy_bank_amount_check/i
    )
  }, 120_000)

  it('transferFromPiggyToBudget × 50 preserves piggy+savings invariant', async () => {
    await reset(1000, 0)
    await chunked(
      Array.from({ length: 50 }, () => () =>
        transferFromPiggyToBudget({ profile_id: testUserId }, testBudgetId, 1)
      )
    )
    const [piggyRes, budgetRes] = await Promise.all([
      admin.from('piggy_bank').select('amount').eq('profile_id', testUserId).single(),
      admin
        .from('estimated_budgets')
        .select('cumulated_savings, last_savings_update')
        .eq('id', testBudgetId)
        .single(),
    ])
    const piggy = Number(piggyRes.data?.amount)
    const savings = Number(budgetRes.data?.cumulated_savings)
    expect(piggy).toBe(950)
    expect(savings).toBe(50)
    expect(piggy + savings).toBe(1000)
  }, 120_000)

  it('updateBankBalance rejects overdraft and leaves balance untouched (Sprint Hardening / H3)', async () => {
    // Reset to a known state: balance = 100.
    const { error: resetErr } = await admin
      .from('bank_balances')
      .update({ balance: 100 })
      .eq('profile_id', testUserId)
    expect(resetErr).toBeNull()

    // -200 would land at -100. RPC must throw, balance must stay at 100.
    // Either error wins: the new RPC guard ("cannot become negative") or the
    // existing CHECK constraint (bank_balances_balance_check). Both preserve
    // the invariant — accept either message.
    await expect(updateBankBalance({ profile_id: testUserId }, -200)).rejects.toThrow(
      /negative|bank_balances_balance_check/i
    )

    const { data, error } = await admin
      .from('bank_balances')
      .select('balance')
      .eq('profile_id', testUserId)
      .single()
    expect(error).toBeNull()
    expect(Number(data?.balance)).toBe(100)
  }, 60_000)

  it('updateBudgetCumulatedSavings × 100 alternating ±1 returns to start', async () => {
    // Start at 100 to keep the running balance >= 0 regardless of interleave
    // (worst case: all 50 -1 calls land first → 50, still >= 0).
    await reset(1000, 100)
    await chunked(
      Array.from({ length: 100 }, (_, i) => () =>
        updateBudgetCumulatedSavings(testBudgetId, i % 2 === 0 ? 1 : -1)
      )
    )
    const { data } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings, last_savings_update')
      .eq('id', testBudgetId)
      .single()
    expect(Number(data?.cumulated_savings)).toBe(100)
    expect(data?.last_savings_update).not.toBeNull()
  }, 120_000)
})
