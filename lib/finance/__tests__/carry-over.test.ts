import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

// Sprint 15 Monthly Recap V3 (2026-05-27) — gated tests for the 3
// carry-over RPCs (toggle_carry_over_and_apply{,_income},
// delete_carried_expense_to_piggy) and their TS wrappers.
//
// Pattern mirror : toggle-applied-to-balance.test.ts (Sprint 05-23). Same
// dynamic import in beforeAll + FK-safe cleanup cascade. Setup also creates
// a piggy_bank row (delete_carried_expense_to_piggy crédite la tirelire) and
// a monthly_recaps row (carried_from_recap_id FK).

type CarryOverMod = typeof import('@/lib/finance/carry-over')

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('carry-over RPCs (Sprint 15 Monthly Recap V3)', () => {
  let admin: SupabaseClient<Database>
  let testUserId: string
  let recapId: string
  let toggleCarryOverAndApply: CarryOverMod['toggleCarryOverAndApply']
  let toggleCarryOverAndApplyIncome: CarryOverMod['toggleCarryOverAndApplyIncome']
  let deleteCarriedExpenseToPiggy: CarryOverMod['deleteCarriedExpenseToPiggy']
  let CarryOverToggleNoOpError: CarryOverMod['CarryOverToggleNoOpError']

  const stamp = Date.now()
  const testEmail = `carry-over-${stamp}@popoth.test`
  const testPassword = `co-${randomUUID()}`

  async function readBalance(): Promise<number> {
    const { data, error } = await admin
      .from('bank_balances')
      .select('balance')
      .eq('profile_id', testUserId)
      .single()
    if (error) throw error
    return Number(data?.balance)
  }

  async function readPiggy(): Promise<number> {
    const { data, error } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', testUserId)
      .maybeSingle()
    if (error) throw error
    return Number(data?.amount ?? 0)
  }

  async function resetBalance(amount: number) {
    const { error } = await admin
      .from('bank_balances')
      .update({ balance: amount })
      .eq('profile_id', testUserId)
    if (error) throw error
  }

  async function resetPiggy(amount: number) {
    // UPSERT — the setup INSERTs a starter row but individual tests may want
    // to reset to a known amount.
    const { error } = await admin.from('piggy_bank').update({ amount }).eq('profile_id', testUserId)
    if (error) throw error
  }

  async function createCarriedExpense(amount: number): Promise<string> {
    const { data, error } = await admin
      .from('real_expenses')
      .insert({
        profile_id: testUserId,
        amount,
        description: 'test carry-over expense',
        expense_date: '2026-04-15',
        is_exceptional: true,
        is_carried_over: true,
        carried_from_recap_id: recapId,
        applied_to_balance_at: null,
      })
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error('insert carried expense failed')
    return data.id
  }

  async function createCarriedIncome(amount: number): Promise<string> {
    const { data, error } = await admin
      .from('real_income_entries')
      .insert({
        profile_id: testUserId,
        amount,
        description: 'test carry-over income',
        entry_date: '2026-04-15',
        is_exceptional: true,
        is_carried_over: true,
        carried_from_recap_id: recapId,
        applied_to_balance_at: null,
      })
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error('insert carried income failed')
    return data.id
  }

  async function createRegularExpense(amount: number): Promise<string> {
    const { data, error } = await admin
      .from('real_expenses')
      .insert({
        profile_id: testUserId,
        amount,
        description: 'test regular expense',
        expense_date: '2026-05-27',
        is_exceptional: true,
        is_carried_over: false,
        carried_from_recap_id: null,
        applied_to_balance_at: null,
      })
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error('insert regular expense failed')
    return data.id
  }

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'carry-over tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const mod = await import('@/lib/finance/carry-over')
    toggleCarryOverAndApply = mod.toggleCarryOverAndApply
    toggleCarryOverAndApplyIncome = mod.toggleCarryOverAndApplyIncome
    deleteCarriedExpenseToPiggy = mod.deleteCarriedExpenseToPiggy
    CarryOverToggleNoOpError = mod.CarryOverToggleNoOpError

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'CarryOver',
      last_name: 'Test',
    })
    if (profErr) throw profErr

    const { error: bankErr } = await admin.from('bank_balances').insert({
      profile_id: testUserId,
      balance: 100,
    })
    if (bankErr) throw bankErr

    const { error: piggyErr } = await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      amount: 0,
    })
    if (piggyErr) throw piggyErr

    // Recap row used as carried_from_recap_id FK. Uses month 4 / year 2026
    // (April 2026, i.e. the "previous month" relative to the carried
    // transactions seeded above).
    const { data: recapData, error: recapErr } = await admin
      .from('monthly_recaps')
      .insert({
        profile_id: testUserId,
        recap_month: 4,
        recap_year: 2026,
        current_step: 'completed',
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (recapErr || !recapData) throw recapErr ?? new Error('insert recap failed')
    recapId = recapData.id
  }, 30_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('real_income_entries').delete().eq('profile_id', testUserId)
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('bank_balances').delete().eq('profile_id', testUserId)
    await admin.from('monthly_recaps').delete().eq('profile_id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 30_000)

  describe('toggle_carry_over_and_apply (expense)', () => {
    it('validate=true: carried+unapplied → validated+applied, debits balance', async () => {
      await resetBalance(100)
      const expenseId = await createCarriedExpense(30)

      const result = await toggleCarryOverAndApply(expenseId, true)

      expect(result.balance).toBe(70)
      expect(typeof result.appliedToBalanceAt).toBe('string')
      expect(result.isCarriedOver).toBe(false)
      expect(await readBalance()).toBe(70)
    }, 30_000)

    it('validate=false (reverse): validated+applied → carried+unapplied, credits balance back', async () => {
      await resetBalance(100)
      const expenseId = await createCarriedExpense(40)

      // Step 1: validate → balance 100 → 60
      await toggleCarryOverAndApply(expenseId, true)
      await resetBalance(60)

      // Step 2: de-validate → balance 60 → 100
      const result = await toggleCarryOverAndApply(expenseId, false)

      expect(result.balance).toBe(100)
      expect(result.appliedToBalanceAt).toBeNull()
      expect(result.isCarriedOver).toBe(true)
      expect(await readBalance()).toBe(100)
    }, 30_000)

    it('validate=true on non-carried expense → throws CarryOverToggleNoOpError', async () => {
      await resetBalance(100)
      const expenseId = await createRegularExpense(20)

      await expect(toggleCarryOverAndApply(expenseId, true)).rejects.toBeInstanceOf(
        CarryOverToggleNoOpError,
      )
    }, 30_000)

    it('validate=false on never-carried expense → throws CarryOverToggleNoOpError', async () => {
      await resetBalance(100)
      const expenseId = await createRegularExpense(20)

      await expect(toggleCarryOverAndApply(expenseId, false)).rejects.toBeInstanceOf(
        CarryOverToggleNoOpError,
      )
    }, 30_000)

    it('round-trip carry → validate → de-validate preserves balance', async () => {
      await resetBalance(200)
      const expenseId = await createCarriedExpense(75.5)

      await toggleCarryOverAndApply(expenseId, true)
      expect(await readBalance()).toBeCloseTo(124.5, 2)

      await toggleCarryOverAndApply(expenseId, false)
      expect(await readBalance()).toBeCloseTo(200, 2)
    }, 30_000)
  })

  describe('toggle_carry_over_and_apply_income (income)', () => {
    it('validate=true: carried+unapplied → validated+applied, credits balance', async () => {
      await resetBalance(100)
      const incomeId = await createCarriedIncome(50)

      const result = await toggleCarryOverAndApplyIncome(incomeId, true)

      expect(result.balance).toBe(150)
      expect(result.isCarriedOver).toBe(false)
      expect(await readBalance()).toBe(150)
    }, 30_000)

    it('validate=false (reverse): debits balance back, restores carry-over', async () => {
      await resetBalance(100)
      const incomeId = await createCarriedIncome(40)

      await toggleCarryOverAndApplyIncome(incomeId, true)
      await resetBalance(140)

      const result = await toggleCarryOverAndApplyIncome(incomeId, false)

      expect(result.balance).toBe(100)
      expect(result.isCarriedOver).toBe(true)
    }, 30_000)
  })

  describe('delete_carried_expense_to_piggy', () => {
    it('happy path: DELETEs the row + credits piggy by the amount', async () => {
      await resetPiggy(0)
      const expenseId = await createCarriedExpense(60)

      const result = await deleteCarriedExpenseToPiggy(expenseId)

      expect(result.expenseId).toBe(expenseId)
      expect(result.piggyCredited).toBe(60)
      expect(result.piggyNewAmount).toBe(60)
      expect(await readPiggy()).toBe(60)

      // Row should be deleted
      const { data: row } = await admin
        .from('real_expenses')
        .select('id')
        .eq('id', expenseId)
        .maybeSingle()
      expect(row).toBeNull()
    }, 30_000)

    it('non-carried expense → throws (P0002 "not a carry-over")', async () => {
      const expenseId = await createRegularExpense(15)

      await expect(deleteCarriedExpenseToPiggy(expenseId)).rejects.toThrow()
    }, 30_000)

    it('non-existent expense id → throws', async () => {
      await expect(deleteCarriedExpenseToPiggy(randomUUID())).rejects.toThrow()
    }, 30_000)
  })
})
