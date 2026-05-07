import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Database } from '@/lib/database.types'

// Same dynamic-import pattern as lib/finance/__tests__/rpc-concurrency.test.ts —
// lib/financial-calculations.ts transitively loads lib/supabase-server.ts which
// calls createClient at module load and would crash when env vars are missing.
type FinCalcMod = typeof import('@/lib/financial-calculations')

const ENABLED = process.env.SUPABASE_API_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('API regressions (Sprint Polish T3)', () => {
  let admin: SupabaseClient<Database>
  let testUserId: string
  let getProfileFinancialData: FinCalcMod['getProfileFinancialData']

  const stamp = Date.now()
  const testEmail = `sprint-polish-fixture-${stamp}@popoth.test`
  const testPassword = `polish-${randomUUID()}`

  // Known fixture math:
  // bank_balance = 500
  // real_income_entries = 100 + 200 + 300 = 600
  // real_expenses     = 50 + 75       = 125
  // estimated_budget.cumulated_savings = 42.5
  // ⇒ availableBalance = 500 + 600 - 125 = 975
  const FIXTURE_BANK_BALANCE = 500
  const FIXTURE_INCOMES = [100, 200, 300]
  const FIXTURE_EXPENSES = [50, 75]
  const FIXTURE_CUMULATED_SAVINGS = 42.5

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'API regression tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const finCalcMod = await import('@/lib/financial-calculations')
    getProfileFinancialData = finCalcMod.getProfileFinancialData

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'Polish',
      last_name: 'Fixture',
    })
    if (profErr) throw profErr

    const { error: bankErr } = await admin.from('bank_balances').insert({
      profile_id: testUserId,
      group_id: null,
      balance: FIXTURE_BANK_BALANCE,
    })
    if (bankErr) throw bankErr

    const { error: budgetErr } = await admin.from('estimated_budgets').insert({
      profile_id: testUserId,
      name: 'Polish Test Budget',
      estimated_amount: 100,
      cumulated_savings: FIXTURE_CUMULATED_SAVINGS,
    })
    if (budgetErr) throw budgetErr

    const todayIso = new Date().toISOString().split('T')[0]!
    const { error: incomesErr } = await admin.from('real_income_entries').insert(
      FIXTURE_INCOMES.map((amount, idx) => ({
        profile_id: testUserId,
        group_id: null,
        amount,
        description: `polish income ${idx}`,
        entry_date: todayIso,
      }))
    )
    if (incomesErr) throw incomesErr

    const { error: expensesErr } = await admin.from('real_expenses').insert(
      FIXTURE_EXPENSES.map((amount, idx) => ({
        profile_id: testUserId,
        group_id: null,
        amount,
        description: `polish expense ${idx}`,
        expense_date: todayIso,
      }))
    )
    if (expensesErr) throw expensesErr
  }, 30_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    // Order matters: tables with FK to profiles(id) without ON DELETE CASCADE
    // must be cleared first. Same teardown pattern as rpc-concurrency.test.ts.
    await admin.from('real_income_entries').delete().eq('profile_id', testUserId)
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('bank_balances').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 30_000)

  // Regression for Sprint Refactor R2 — the route once read a non-existent
  // column `current_savings` and the cast hid it. Test asserts the column
  // name `cumulated_savings` continues to round-trip on the same select
  // shape /api/finances/expenses/progress uses.
  it('estimated_budgets.cumulated_savings round-trips through the progress-route select', async () => {
    const { data, error } = await admin
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq('profile_id', testUserId)
      .single()

    expect(error).toBeNull()
    expect(data?.cumulated_savings).toBe(FIXTURE_CUMULATED_SAVINGS)
  })

  // Regression for Sprint Hardening H2 — the dashboard route used to read
  // these from a ghost table `financial_snapshots` that never existed in
  // prod and silently fell back to 0. T1 plumbed them through
  // getProfileFinancialData. Asserts the helper returns the actual sum.
  it('getProfileFinancialData totals match the inserted income/expense rows', async () => {
    const data = await getProfileFinancialData(testUserId)

    const expectedIncome = FIXTURE_INCOMES.reduce((s, n) => s + n, 0)
    const expectedExpense = FIXTURE_EXPENSES.reduce((s, n) => s + n, 0)

    expect(data.totalRealIncome).toBe(expectedIncome)
    expect(data.totalRealExpenses).toBe(expectedExpense)
  }, 30_000)

  // Regression for Sprint Hardening H1 — dashboard once consumed a phantom
  // RPC `calculate_available_cash` that didn't exist in pg_proc; the error
  // was swallowed and the value defaulted to 0. Now availableBalance comes
  // from calculateAvailableCash(bank, income, expense) inside the helper.
  it('getProfileFinancialData availableBalance equals bank + income - expense', async () => {
    const data = await getProfileFinancialData(testUserId)

    const expectedIncome = FIXTURE_INCOMES.reduce((s, n) => s + n, 0)
    const expectedExpense = FIXTURE_EXPENSES.reduce((s, n) => s + n, 0)
    const expected = FIXTURE_BANK_BALANCE + expectedIncome - expectedExpense

    expect(data.availableBalance).toBe(expected)
  }, 30_000)
})
