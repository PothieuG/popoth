import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

// Sprint Atomicity-Expenses — gated concurrency tests for the
// `add_expense_with_breakdown` RPC + the `addExpenseWithBreakdown` TS
// helper. Mirrors transfer-with-savings.test.ts (Sprint Refactor-I5-
// followup-v2): dynamic import in beforeAll, FK-safe cleanup cascade,
// chunked concurrency. Pins the atomicity invariant — overdraft or
// INSERT failure rolls back ALL three operations (piggy debit, savings
// debit, INSERT real_expenses) as one Postgres tx.

type ExpensesMod = typeof import('@/lib/finance/expenses')

const ENABLED = process.env.SUPABASE_RPC_CONCURRENCY_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('add_expense_with_breakdown (Sprint Atomicity-Expenses)', () => {
  let admin: SupabaseClient<Database>
  let testUserId: string
  let budgetId: string
  let addExpenseWithBreakdown: ExpensesMod['addExpenseWithBreakdown']

  const stamp = Date.now()
  const testEmail = `add-expense-${stamp}@popoth.test`
  const testPassword = `expense-${randomUUID()}`

  async function resetPiggy(amount: number) {
    const { error } = await admin
      .from('piggy_bank')
      .update({ amount })
      .eq('profile_id', testUserId)
    if (error) throw error
  }

  async function resetSavings(amount: number) {
    const { error } = await admin
      .from('estimated_budgets')
      .update({ cumulated_savings: amount })
      .eq('id', budgetId)
    if (error) throw error
  }

  async function deleteAllExpenses() {
    const { error } = await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    if (error) throw error
  }

  async function countExpenses(): Promise<number> {
    const { count, error } = await admin
      .from('real_expenses')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', testUserId)
    if (error) throw error
    return count ?? 0
  }

  async function fetchPiggyAmount(): Promise<number> {
    const { data, error } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', testUserId)
      .single()
    if (error) throw error
    return Number(data?.amount ?? 0)
  }

  async function fetchSavings(): Promise<number> {
    const { data, error } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', budgetId)
      .single()
    if (error) throw error
    return Number(data?.cumulated_savings ?? 0)
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
        'add_expense_with_breakdown tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const mod = await import('@/lib/finance/expenses')
    addExpenseWithBreakdown = mod.addExpenseWithBreakdown

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'Add',
      last_name: 'Expense',
    })
    if (profErr) throw profErr

    const { data: budget, error: budgetErr } = await admin
      .from('estimated_budgets')
      .insert({
        profile_id: testUserId,
        name: 'Test Budget',
        estimated_amount: 500,
        cumulated_savings: 0,
      })
      .select('id')
      .single()
    if (budgetErr || !budget) throw budgetErr ?? new Error('insert budget failed')
    budgetId = budget.id

    const { error: piggyErr } = await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      amount: 0,
    })
    if (piggyErr) throw piggyErr
  }, 30_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    // real_expenses FK -> estimated_budgets (ON DELETE SET NULL) — must be
    // deleted explicitly before the parent budget.
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 30_000)

  it('happy path: debits piggy + savings, inserts one row with breakdown', async () => {
    await resetPiggy(100)
    await resetSavings(50)
    await deleteAllExpenses()

    // amount=100, breakdown {piggy=20, savings=30, budget=50}
    const result = await addExpenseWithBreakdown(
      { profile_id: testUserId },
      {
        amount: 100,
        description: 'happy lunch',
        expenseDate: '2026-05-12',
        estimatedBudgetId: budgetId,
        amountFromPiggyBank: 20,
        amountFromBudgetSavings: 30,
        amountFromBudget: 50,
      },
    )

    expect(typeof result.expense_id).toBe('string')

    expect(await fetchPiggyAmount()).toBe(80)
    expect(await fetchSavings()).toBe(20)
    expect(await countExpenses()).toBe(1)
  }, 30_000)

  it('insufficient piggy: RPC throws AND no expense row + savings unchanged (atomicity proof)', async () => {
    await resetPiggy(10)
    await resetSavings(50)
    await deleteAllExpenses()

    await expect(
      addExpenseWithBreakdown(
        { profile_id: testUserId },
        {
          amount: 80,
          description: 'overdraft piggy',
          expenseDate: '2026-05-12',
          estimatedBudgetId: budgetId,
          amountFromPiggyBank: 20, // exceeds piggy=10
          amountFromBudgetSavings: 30,
          amountFromBudget: 30,
        },
      ),
    ).rejects.toThrow(/negative|piggy/i)

    // Piggy unchanged (RPC raised at the piggy debit step, never touched savings)
    expect(await fetchPiggyAmount()).toBe(10)
    expect(await fetchSavings()).toBe(50)
    // Atomicity: zero expense rows — INSERT was rolled back
    expect(await countExpenses()).toBe(0)
  }, 30_000)

  it('insufficient savings: piggy debit rolled back, no expense row (atomicity proof)', async () => {
    await resetPiggy(100)
    await resetSavings(10)
    await deleteAllExpenses()

    await expect(
      addExpenseWithBreakdown(
        { profile_id: testUserId },
        {
          amount: 80,
          description: 'overdraft savings',
          expenseDate: '2026-05-12',
          estimatedBudgetId: budgetId,
          amountFromPiggyBank: 20, // piggy debit succeeds (100 -> 80)
          amountFromBudgetSavings: 30, // savings debit fails (10 < 30)
          amountFromBudget: 30,
        },
      ),
    ).rejects.toThrow(/negative|cumulated_savings/i)

    // CRITICAL: piggy debit was rolled back when savings failed (same tx).
    // Pre-Sprint Atomicity-Expenses this would have left piggy=80 + no
    // expense row — the user perceives a magic money loss.
    expect(await fetchPiggyAmount()).toBe(100)
    expect(await fetchSavings()).toBe(10)
    expect(await countExpenses()).toBe(0)
  }, 30_000)

  it('100 concurrent calls with piggy=50 converge to piggy=0 with exactly 50 expense rows', async () => {
    await resetPiggy(50)
    await resetSavings(0)
    await deleteAllExpenses()

    const results = await chunked(
      Array.from(
        { length: 100 },
        () => () =>
          addExpenseWithBreakdown(
            { profile_id: testUserId },
            {
              amount: 1,
              description: 'concurrent',
              expenseDate: '2026-05-12',
              estimatedBudgetId: budgetId,
              amountFromPiggyBank: 1,
              amountFromBudgetSavings: 0,
              amountFromBudget: 0,
            },
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

    expect(await fetchPiggyAmount()).toBe(0)
    // Atomicity invariant: expense rows count exactly matches successful debits
    expect(await countExpenses()).toBe(50)
  }, 180_000)

  it('XOR violation: passing both profile_id and group_id raises (input validation)', async () => {
    await resetPiggy(100)
    await resetSavings(50)
    await deleteAllExpenses()

    // Bypass the helper (its ContextFilter type prevents this combination at
    // compile time). Test the RPC's runtime guard directly.
    const { error } = await admin.rpc('add_expense_with_breakdown', {
      p_amount: 10,
      p_description: 'xor violation',
      p_expense_date: '2026-05-12',
      p_estimated_budget_id: budgetId,
      p_amount_from_piggy_bank: 0,
      p_amount_from_budget_savings: 0,
      p_amount_from_budget: 10,
      p_profile_id: testUserId,
      p_group_id: testUserId,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/exactly one|p_profile_id|p_group_id/i)

    // State unchanged — RPC raised before any UPDATE/INSERT
    expect(await fetchPiggyAmount()).toBe(100)
    expect(await fetchSavings()).toBe(50)
    expect(await countExpenses()).toBe(0)
  }, 30_000)

  it('no-op breakdown (zero piggy + zero savings, full budget path): inserts row without touching piggy/savings', async () => {
    await resetPiggy(100)
    await resetSavings(50)
    await deleteAllExpenses()

    const result = await addExpenseWithBreakdown(
      { profile_id: testUserId },
      {
        amount: 25,
        description: 'full budget',
        expenseDate: '2026-05-12',
        estimatedBudgetId: budgetId,
        amountFromPiggyBank: 0,
        amountFromBudgetSavings: 0,
        amountFromBudget: 25,
      },
    )

    expect(typeof result.expense_id).toBe('string')
    // Piggy + savings untouched (RPC short-circuits on 0 debits)
    expect(await fetchPiggyAmount()).toBe(100)
    expect(await fetchSavings()).toBe(50)
    expect(await countExpenses()).toBe(1)
  }, 30_000)
})
