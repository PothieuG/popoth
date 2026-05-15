import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

// Sprint Auto-Balance-Atomic-Phase-B — gated concurrency tests for
// `transfer_piggy_to_budget_with_insert` RPC + the
// `transferPiggyToBudgetWithInsert` TS helper. Mirror of
// transfer-with-savings.test.ts (Sprint Refactor-I5-followup-v2):
// dynamic import in beforeAll, FK-safe cleanup cascade, chunked
// concurrency.

type PiggyBankMod = typeof import('@/lib/finance/piggy-bank')

const ENABLED = process.env.SUPABASE_RPC_CONCURRENCY_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('transfer_piggy_to_budget_with_insert (Sprint Auto-Balance-Atomic-Phase-B)', () => {
  let admin: SupabaseClient<Database>
  let testUserId: string
  let toBudgetId: string
  let transferPiggyToBudgetWithInsert: PiggyBankMod['transferPiggyToBudgetWithInsert']

  const stamp = Date.now()
  const testEmail = `transfer-piggy-${stamp}@popoth.test`
  const testPassword = `transfer-${randomUUID()}`

  async function resetPiggy(amount: number) {
    const { error } = await admin
      .from('piggy_bank')
      .update({ amount })
      .eq('profile_id', testUserId)
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

  async function readPiggy(): Promise<number> {
    const { data, error } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', testUserId)
      .single()
    if (error) throw error
    return Number(data?.amount)
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
        'transfer_piggy_to_budget_with_insert tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const mod = await import('@/lib/finance/piggy-bank')
    transferPiggyToBudgetWithInsert = mod.transferPiggyToBudgetWithInsert

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
      last_name: 'Piggy',
    })
    if (profErr) throw profErr

    // Seed destination budget (to_budget_id is required NOT NULL on
    // budget_transfers; the from side is NULL by design = piggy_bank).
    const { data: toBudget, error: toErr } = await admin
      .from('estimated_budgets')
      .insert({
        profile_id: testUserId,
        name: 'Destination Budget',
        estimated_amount: 500,
        cumulated_savings: 0,
      })
      .select('id')
      .single()
    if (toErr || !toBudget) throw toErr ?? new Error('insert toBudget failed')
    toBudgetId = toBudget.id

    // Seed piggy_bank row with amount=0 — tests reset via UPDATE per case.
    const { error: piggyErr } = await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      amount: 0,
    })
    if (piggyErr) throw piggyErr
  }, 30_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    // budget_transfers FK -> profile (ON DELETE CASCADE), but we delete
    // explicitly to keep the test idempotent across re-runs.
    await admin.from('budget_transfers').delete().eq('profile_id', testUserId)
    // piggy_bank.profile_id FK has NO ON DELETE CASCADE — must delete
    // before profile / auth user cleanup or the deletion cascades fail.
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 30_000)

  it('happy path: debits piggy_bank.amount and inserts one transfer row with from_budget_id=NULL', async () => {
    await resetPiggy(100)
    await deleteAllTransfers()

    const result = await transferPiggyToBudgetWithInsert(
      { profile_id: testUserId },
      { toBudgetId, amount: 30 },
    )

    expect(result.piggy_bank_amount).toBe(70)
    expect(typeof result.transfer_id).toBe('string')

    expect(await readPiggy()).toBe(70)
    expect(await countTransfers()).toBe(1)

    // Verify the audit row has from_budget_id=NULL (piggy_bank source signature)
    const { data: transferRow } = await admin
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount')
      .eq('profile_id', testUserId)
      .single()
    expect(transferRow?.from_budget_id).toBeNull()
    expect(transferRow?.to_budget_id).toBe(toBudgetId)
    expect(Number(transferRow?.transfer_amount)).toBe(30)
  }, 30_000)

  it('insufficient piggy: RPC throws AND no transfer row is left behind (atomicity proof)', async () => {
    await resetPiggy(10)
    await deleteAllTransfers()

    await expect(
      transferPiggyToBudgetWithInsert(
        { profile_id: testUserId },
        { toBudgetId, amount: 50 },
      ),
    ).rejects.toThrow(/negative|piggy_bank|amount/i)

    // Piggy unchanged (RPC raised at/before the piggy UPDATE)
    expect(await readPiggy()).toBe(10)
    // Critically: zero transfer rows — the INSERT was rolled back in the same tx
    expect(await countTransfers()).toBe(0)
  }, 30_000)

  it('100 concurrent calls with piggy=50 converge to piggy=0 with exactly 50 transfer rows', async () => {
    await resetPiggy(50)
    await deleteAllTransfers()

    const results = await chunked(
      Array.from(
        { length: 100 },
        () => () =>
          transferPiggyToBudgetWithInsert(
            { profile_id: testUserId },
            { toBudgetId, amount: 1 },
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

    expect(await readPiggy()).toBe(0)
    // Atomicity invariant: transfer rows count exactly matches successful debits
    expect(await countTransfers()).toBe(50)
  }, 180_000)

  it('XOR violation: passing both profile_id and group_id raises (input validation)', async () => {
    await resetPiggy(100)
    await deleteAllTransfers()

    // Bypass the helper (its ContextFilter type prevents this combination at
    // compile time). Test the RPC's runtime guard directly.
    const { error } = await admin.rpc('transfer_piggy_to_budget_with_insert', {
      p_to_budget_id: toBudgetId,
      p_amount: 10,
      p_profile_id: testUserId,
      p_group_id: testUserId,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/exactly one|p_profile_id|p_group_id/i)

    // Piggy unchanged + no transfer row
    expect(await readPiggy()).toBe(100)
    expect(await countTransfers()).toBe(0)
  }, 30_000)
})
