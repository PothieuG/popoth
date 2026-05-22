import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

// Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23) — gated concurrency
// tests for `toggle_real_expense_applied_to_balance` +
// `toggle_real_income_applied_to_balance` RPCs + their TS helpers. Pattern
// miroir transfer-piggy-to-budget-with-insert.test.ts : dynamic import in
// beforeAll, FK-safe cleanup cascade, chunked concurrency.

type AppliedBalanceMod = typeof import('@/lib/finance/applied-balance')

const ENABLED = process.env.SUPABASE_RPC_CONCURRENCY_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)(
  'toggle_real_*_applied_to_balance (Sprint Long-Press-Toggle-Apply-To-Balance)',
  () => {
    let admin: SupabaseClient<Database>
    let testUserId: string
    let toggleRealExpenseAppliedToBalance: AppliedBalanceMod['toggleRealExpenseAppliedToBalance']
    let toggleRealIncomeAppliedToBalance: AppliedBalanceMod['toggleRealIncomeAppliedToBalance']
    let AppliedToggleNoOpError: AppliedBalanceMod['AppliedToggleNoOpError']

    const stamp = Date.now()
    const testEmail = `toggle-applied-${stamp}@popoth.test`
    const testPassword = `toggle-${randomUUID()}`

    async function readBalance(): Promise<number> {
      const { data, error } = await admin
        .from('bank_balances')
        .select('balance')
        .eq('profile_id', testUserId)
        .single()
      if (error) throw error
      return Number(data?.balance)
    }

    async function resetBalance(amount: number) {
      const { error } = await admin
        .from('bank_balances')
        .update({ balance: amount })
        .eq('profile_id', testUserId)
      if (error) throw error
    }

    async function createExpense(amount: number, applied = false): Promise<string> {
      const { data, error } = await admin
        .from('real_expenses')
        .insert({
          profile_id: testUserId,
          amount,
          description: 'test expense',
          expense_date: '2026-05-23',
          is_exceptional: true,
          applied_to_balance_at: applied ? new Date().toISOString() : null,
        })
        .select('id')
        .single()
      if (error || !data) throw error ?? new Error('insert expense failed')
      return data.id
    }

    async function createIncome(amount: number, applied = false): Promise<string> {
      const { data, error } = await admin
        .from('real_income_entries')
        .insert({
          profile_id: testUserId,
          amount,
          description: 'test income',
          entry_date: '2026-05-23',
          is_exceptional: true,
          applied_to_balance_at: applied ? new Date().toISOString() : null,
        })
        .select('id')
        .single()
      if (error || !data) throw error ?? new Error('insert income failed')
      return data.id
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
          'toggle_applied_to_balance tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
        )
      }

      admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })

      const mod = await import('@/lib/finance/applied-balance')
      toggleRealExpenseAppliedToBalance = mod.toggleRealExpenseAppliedToBalance
      toggleRealIncomeAppliedToBalance = mod.toggleRealIncomeAppliedToBalance
      AppliedToggleNoOpError = mod.AppliedToggleNoOpError

      const { data: userData, error: userErr } = await admin.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      })
      if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
      testUserId = userData.user.id

      const { error: profErr } = await admin.from('profiles').insert({
        id: testUserId,
        first_name: 'Toggle',
        last_name: 'Applied',
      })
      if (profErr) throw profErr

      const { error: bankErr } = await admin.from('bank_balances').insert({
        profile_id: testUserId,
        balance: 100,
      })
      if (bankErr) throw bankErr
    }, 30_000)

    afterAll(async () => {
      if (!admin || !testUserId) return
      await admin.from('real_expenses').delete().eq('profile_id', testUserId)
      await admin.from('real_income_entries').delete().eq('profile_id', testUserId)
      await admin.from('bank_balances').delete().eq('profile_id', testUserId)
      await admin.auth.admin.deleteUser(testUserId)
    }, 30_000)

    it('expense apply: debits balance by amount and sets applied_to_balance_at', async () => {
      await resetBalance(100)
      const expenseId = await createExpense(30)

      const result = await toggleRealExpenseAppliedToBalance(expenseId, true)

      expect(result.balance).toBe(70)
      expect(typeof result.appliedToBalanceAt).toBe('string')
      expect(await readBalance()).toBe(70)
    }, 30_000)

    it('expense unapply: credits balance back and clears applied_to_balance_at', async () => {
      await resetBalance(100)
      const expenseId = await createExpense(30, true)
      // The seeded expense's applied flag is NOT reflected in balance — reset
      // to a known state mimicking a previously-applied expense:
      await resetBalance(70)

      const result = await toggleRealExpenseAppliedToBalance(expenseId, false)

      expect(result.balance).toBe(100)
      expect(result.appliedToBalanceAt).toBeNull()
      expect(await readBalance()).toBe(100)
    }, 30_000)

    it('income apply: credits balance by amount', async () => {
      await resetBalance(100)
      const incomeId = await createIncome(40)

      const result = await toggleRealIncomeAppliedToBalance(incomeId, true)

      expect(result.balance).toBe(140)
      expect(typeof result.appliedToBalanceAt).toBe('string')
    }, 30_000)

    it('income unapply: debits balance back', async () => {
      await resetBalance(100)
      const incomeId = await createIncome(40, true)
      await resetBalance(140)

      const result = await toggleRealIncomeAppliedToBalance(incomeId, false)

      expect(result.balance).toBe(100)
      expect(result.appliedToBalanceAt).toBeNull()
    }, 30_000)

    it('apply already-applied → throws AppliedToggleNoOpError (P0002)', async () => {
      await resetBalance(100)
      const expenseId = await createExpense(20, true)

      await expect(toggleRealExpenseAppliedToBalance(expenseId, true)).rejects.toBeInstanceOf(
        AppliedToggleNoOpError,
      )
    }, 30_000)

    it('unapply not-applied → throws AppliedToggleNoOpError (P0002)', async () => {
      await resetBalance(100)
      const expenseId = await createExpense(20, false)

      await expect(toggleRealExpenseAppliedToBalance(expenseId, false)).rejects.toBeInstanceOf(
        AppliedToggleNoOpError,
      )
    }, 30_000)

    it('row not found → throws (non-P0002 error)', async () => {
      const missingId = randomUUID()

      await expect(toggleRealExpenseAppliedToBalance(missingId, true)).rejects.toThrow(/not found/i)
    }, 30_000)

    it('10 concurrent applies on the same row → 1 success + 9 P0002, single debit on balance', async () => {
      await resetBalance(100)
      const expenseId = await createExpense(25, false)

      const results = await chunked(
        Array.from(
          { length: 10 },
          () => () =>
            toggleRealExpenseAppliedToBalance(expenseId, true).then(
              () => 'ok' as const,
              (err: unknown) =>
                err instanceof AppliedToggleNoOpError ? ('noop' as const) : ('err' as const),
            ),
        ),
      )

      const okCount = results.filter((r) => r === 'ok').length
      const noopCount = results.filter((r) => r === 'noop').length
      const errCount = results.filter((r) => r === 'err').length

      expect(okCount).toBe(1)
      expect(noopCount).toBe(9)
      expect(errCount).toBe(0)

      // Single debit applied: 100 - 25 = 75 (PAS 100 - 10*25 = -150)
      expect(await readBalance()).toBe(75)
    }, 60_000)

    it('round-trip apply → unapply preserves balance', async () => {
      await resetBalance(123.45)
      const expenseId = await createExpense(50)

      await toggleRealExpenseAppliedToBalance(expenseId, true)
      expect(await readBalance()).toBeCloseTo(73.45, 2)

      await toggleRealExpenseAppliedToBalance(expenseId, false)
      expect(await readBalance()).toBeCloseTo(123.45, 2)
    }, 30_000)
  },
)
