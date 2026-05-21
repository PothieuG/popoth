import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

// Sprint P4-P5-P6 / Phase C4 — gated concurrency + atomicity tests for the
// `add_expense_with_cross_budget_cascade` RPC + `addExpenseWithCrossBudgetCascade`
// TS helper. Pattern miroir add-expense-with-breakdown.test.ts: dynamic
// import in beforeAll, FK-safe cleanup cascade, chunked concurrency.
//
// Pins the atomicity invariant: when ANY of the operations (local savings
// debit, cross-budget source debit, INSERT real_expenses) fails, the WHOLE
// Postgres tx rolls back — partial cross-budget debits cannot leak.

type ExpensesMod = typeof import('@/lib/finance/expenses')

const ENABLED = process.env.SUPABASE_RPC_CONCURRENCY_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('add_expense_with_cross_budget_cascade (Sprint P4-P5-P6 / C4)', () => {
  let admin: SupabaseClient<Database>
  let testUserId: string
  let destinationBudgetId: string
  let sourceBudget1Id: string
  let sourceBudget2Id: string
  let addExpenseWithCrossBudgetCascade: ExpensesMod['addExpenseWithCrossBudgetCascade']

  const stamp = Date.now()
  const testEmail = `cross-budget-${stamp}@popoth.test`
  const testPassword = `cross-${randomUUID()}`

  async function resetSavings(budgetId: string, amount: number) {
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

  async function fetchSavings(budgetId: string): Promise<number> {
    const { data, error } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', budgetId)
      .single()
    if (error) throw error
    return Number(data?.cumulated_savings ?? 0)
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
        'cross-budget-cascade tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Create test user
    const { data: signupData, error: signupError } = await admin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })
    if (signupError || !signupData.user) {
      throw new Error(`Failed to create test user: ${signupError?.message}`)
    }
    testUserId = signupData.user.id

    // Create profile
    const { error: profileError } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'Cross',
      last_name: 'Budget',
      salary: 3000,
    })
    if (profileError) throw profileError

    // Create destination budget + 2 source budgets
    const { data: budgets, error: budgetError } = await admin
      .from('estimated_budgets')
      .insert([
        {
          profile_id: testUserId,
          name: 'Destination',
          estimated_amount: 1000,
          cumulated_savings: 0,
        },
        {
          profile_id: testUserId,
          name: 'Source 1',
          estimated_amount: 500,
          cumulated_savings: 0,
        },
        {
          profile_id: testUserId,
          name: 'Source 2',
          estimated_amount: 300,
          cumulated_savings: 0,
        },
      ])
      .select()
    if (budgetError || !budgets || budgets.length !== 3) {
      throw new Error(`Failed to create budgets: ${budgetError?.message}`)
    }
    destinationBudgetId = budgets[0]!.id
    sourceBudget1Id = budgets[1]!.id
    sourceBudget2Id = budgets[2]!.id

    // Dynamic import after env setup
    const mod = await import('@/lib/finance/expenses')
    addExpenseWithCrossBudgetCascade = mod.addExpenseWithCrossBudgetCascade
  })

  afterAll(async () => {
    if (!admin) return
    // FK-safe cleanup cascade
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.from('profiles').delete().eq('id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  })

  it('happy path: single cross-budget source debited + INSERT atomic', async () => {
    // amount=200, destination=fully fresh (no local savings/budget consumed),
    // source1=80 savings → amount_from_budget=120, cross_budget=80
    await resetSavings(destinationBudgetId, 0)
    await resetSavings(sourceBudget1Id, 80)
    await deleteAllExpenses()

    const result = await addExpenseWithCrossBudgetCascade(
      { profile_id: testUserId },
      {
        amount: 200,
        description: 'Multi-budget expense',
        expenseDate: '2026-05-15',
        estimatedBudgetId: destinationBudgetId,
        amountFromPiggyBank: 0,
        amountFromLocalSavings: 0,
        amountFromBudget: 120,
        crossBudgetDebits: [{ budget_id: sourceBudget1Id, amount: 80 }],
        createdByProfileId: testUserId,
      },
    )

    expect(result.expense_id).toBeTruthy()
    expect(result.cross_budget_total).toBe(80)
    expect(result.consolidated_savings).toBe(80) // 0 local + 80 cross

    expect(await countExpenses()).toBe(1)
    expect(await fetchSavings(sourceBudget1Id)).toBe(0) // 80 → 0
  })

  it('happy path: multi-source cross-budget debited atomically', async () => {
    // amount=300, destination=20 local savings, source1=60, source2=40
    // → amount_from_budget=180, amount_from_local_savings=20, cross=100 (60+40)
    await resetSavings(destinationBudgetId, 20)
    await resetSavings(sourceBudget1Id, 60)
    await resetSavings(sourceBudget2Id, 40)
    await deleteAllExpenses()

    const result = await addExpenseWithCrossBudgetCascade(
      { profile_id: testUserId },
      {
        amount: 300,
        description: 'Multi-source',
        expenseDate: '2026-05-15',
        estimatedBudgetId: destinationBudgetId,
        amountFromPiggyBank: 0,
        amountFromLocalSavings: 20,
        amountFromBudget: 180,
        crossBudgetDebits: [
          { budget_id: sourceBudget1Id, amount: 60 },
          { budget_id: sourceBudget2Id, amount: 40 },
        ],
        createdByProfileId: testUserId,
      },
    )

    expect(result.cross_budget_total).toBe(100)
    expect(result.consolidated_savings).toBe(120) // 20 local + 100 cross

    expect(await countExpenses()).toBe(1)
    expect(await fetchSavings(destinationBudgetId)).toBe(0) // 20 → 0
    expect(await fetchSavings(sourceBudget1Id)).toBe(0) // 60 → 0
    expect(await fetchSavings(sourceBudget2Id)).toBe(0) // 40 → 0
  })

  it('insufficient cross-budget source: RPC throws + NO sources debited (atomicity)', async () => {
    // source1=30 but we try to take 80 from it → RAISE
    // KEY ATOMICITY INVARIANT: source2 must NOT be debited either, and
    // the destination's local savings (10) must NOT be debited either.
    await resetSavings(destinationBudgetId, 10)
    await resetSavings(sourceBudget1Id, 30)
    await resetSavings(sourceBudget2Id, 50)
    await deleteAllExpenses()

    await expect(
      addExpenseWithCrossBudgetCascade(
        { profile_id: testUserId },
        {
          amount: 200,
          description: 'Should fail',
          expenseDate: '2026-05-15',
          estimatedBudgetId: destinationBudgetId,
          amountFromPiggyBank: 0,
          amountFromLocalSavings: 10,
          amountFromBudget: 60,
          crossBudgetDebits: [
            { budget_id: sourceBudget1Id, amount: 80 }, // > 30 available
            { budget_id: sourceBudget2Id, amount: 50 },
          ],
          createdByProfileId: testUserId,
        },
      ),
    ).rejects.toThrow()

    // Atomicity proof: all 3 budgets' savings unchanged
    expect(await fetchSavings(destinationBudgetId)).toBe(10)
    expect(await fetchSavings(sourceBudget1Id)).toBe(30)
    expect(await fetchSavings(sourceBudget2Id)).toBe(50)
    // No expense row inserted
    expect(await countExpenses()).toBe(0)
  })

  it('sum mismatch: RPC throws, no side effects', async () => {
    // amount=100, but breakdown sums to 90 (10 short) → RAISE
    await resetSavings(destinationBudgetId, 50)
    await resetSavings(sourceBudget1Id, 50)
    await deleteAllExpenses()

    await expect(
      addExpenseWithCrossBudgetCascade(
        { profile_id: testUserId },
        {
          amount: 100,
          description: 'Mismatched sum',
          expenseDate: '2026-05-15',
          estimatedBudgetId: destinationBudgetId,
          amountFromPiggyBank: 0,
          amountFromLocalSavings: 30,
          amountFromBudget: 30,
          crossBudgetDebits: [{ budget_id: sourceBudget1Id, amount: 30 }],
          // 30 + 30 + 30 = 90 ≠ 100
          createdByProfileId: testUserId,
        },
      ),
    ).rejects.toThrow(/Breakdown sum/)

    // No mutations
    expect(await fetchSavings(destinationBudgetId)).toBe(50)
    expect(await fetchSavings(sourceBudget1Id)).toBe(50)
    expect(await countExpenses()).toBe(0)
  })

  it('source equals destination: RPC throws (cannot self-debit)', async () => {
    await resetSavings(destinationBudgetId, 100)
    await deleteAllExpenses()

    await expect(
      addExpenseWithCrossBudgetCascade(
        { profile_id: testUserId },
        {
          amount: 100,
          description: 'Self-debit attempt',
          expenseDate: '2026-05-15',
          estimatedBudgetId: destinationBudgetId,
          amountFromPiggyBank: 0,
          amountFromLocalSavings: 0,
          amountFromBudget: 50,
          crossBudgetDebits: [{ budget_id: destinationBudgetId, amount: 50 }], // self!
          createdByProfileId: testUserId,
        },
      ),
    ).rejects.toThrow(/cannot be the destination/)

    expect(await fetchSavings(destinationBudgetId)).toBe(100)
    expect(await countExpenses()).toBe(0)
  })

  it('100x concurrent: invariants hold under race conditions', async () => {
    // source1=50 savings, 100 concurrent calls each taking 1€ via cross-budget
    // → expected: 50 succeed, 50 fail. source1=0 final. exactly 50 expense rows.
    await resetSavings(destinationBudgetId, 0)
    await resetSavings(sourceBudget1Id, 50)
    await deleteAllExpenses()

    const tasks = Array.from({ length: 100 }, () => async () => {
      try {
        await addExpenseWithCrossBudgetCascade(
          { profile_id: testUserId },
          {
            amount: 2,
            description: 'Concurrent',
            expenseDate: '2026-05-15',
            estimatedBudgetId: destinationBudgetId,
            amountFromPiggyBank: 0,
            amountFromLocalSavings: 0,
            amountFromBudget: 1,
            crossBudgetDebits: [{ budget_id: sourceBudget1Id, amount: 1 }],
            createdByProfileId: testUserId,
          },
        )
        return 'ok'
      } catch {
        return 'fail'
      }
    })

    const results = await chunked(tasks, 10)
    const successes = results.filter((r) => r === 'ok').length
    const failures = results.filter((r) => r === 'fail').length

    expect(successes).toBe(50) // savings source had exactly 50
    expect(failures).toBe(50)
    expect(await fetchSavings(sourceBudget1Id)).toBe(0)
    expect(await countExpenses()).toBe(50)
  })
})
