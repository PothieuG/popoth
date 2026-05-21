import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Database, Json, TablesInsert } from '@/lib/database.types'
import type { SnapshotPayloadV1, SnapshotPayloadV2 } from '@/lib/recap-snapshot.types'

// Same dynamic-import pattern as lib/finance/__tests__/rpc-concurrency.test.ts —
// @/lib/finance transitively loads lib/supabase-server.ts which calls
// createClient at module load and would crash when env vars are missing.
type FinCalcMod = typeof import('@/lib/finance')
type RecoverRouteMod = typeof import('@/app/api/monthly-recap/recover/route')
type SessionMod = typeof import('@/lib/session')

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
        'API regression tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const finCalcMod = await import('@/lib/finance')
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
      })),
    )
    if (incomesErr) throw incomesErr

    const { error: expensesErr } = await admin.from('real_expenses').insert(
      FIXTURE_EXPENSES.map((amount, idx) => ({
        profile_id: testUserId,
        group_id: null,
        amount,
        description: `polish expense ${idx}`,
        expense_date: todayIso,
      })),
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
  // shape /api/finance/expenses/progress uses.
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

// Sprint Lint-Followups Item 1 — recover.ts v1/v2 type mismatch.
// The bug typed `recoveryResults.bank_balance` and `.piggy_bank` as
// `boolean | number` to preserve runtime: v1 path assigns `true` (boolean
// flag), v2 path assigned `data.length` (numeric count, falsy when 0).
// The fix normalises both to strict `boolean`. These tests pin the
// boolean semantic across all 3 paths so a future regression to numeric
// counts (or a `Boolean(data.length)` shortcut that evaluates `0` as
// false on a successful insert) breaks the suite.
describe.skipIf(!ENABLED)('recover route — bank_balance/piggy_bank boolean semantic', () => {
  let admin: SupabaseClient<Database>
  let recoverPOST: RecoverRouteMod['POST']
  let createSessionToken: SessionMod['createSessionToken']
  let testUserId: string
  let testEmail: string

  const stamp = Date.now()
  const userPassword = `recover-${randomUUID()}`
  const month = new Date().getMonth() + 1
  const year = new Date().getFullYear()

  // Minimal valid arrays so the route's blob-corruption guard at line 124
  // (estimated_incomes / estimated_budgets non-empty) passes. Fields not
  // listed are filled by the DB defaults / route restoration path.
  function buildEstimatedIncomes(uid: string): TablesInsert<'estimated_incomes'>[] {
    return [{ profile_id: uid, group_id: null, name: 'fixture income', estimated_amount: 100 }]
  }
  function buildEstimatedBudgets(uid: string): TablesInsert<'estimated_budgets'>[] {
    return [{ profile_id: uid, group_id: null, name: 'fixture budget', estimated_amount: 50 }]
  }

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'recover regression tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    if (!process.env.JWT_SECRET_KEY) {
      throw new Error(
        'recover regression tests require JWT_SECRET_KEY (lib/session.ts signs the cookie)',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const recoverMod = await import('@/app/api/monthly-recap/recover/route')
    recoverPOST = recoverMod.POST
    const sessionMod = await import('@/lib/session')
    createSessionToken = sessionMod.createSessionToken

    testEmail = `recover-fixture-${stamp}@popoth.test`
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: userPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'Recover',
      last_name: 'Fixture',
    })
    if (profErr) throw profErr
  }, 30_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    // Recover route mutates these tables on every call; clean up everything
    // the test user might have touched. Order matters for FKs.
    await admin.from('budget_transfers').delete().eq('profile_id', testUserId)
    await admin.from('real_income_entries').delete().eq('profile_id', testUserId)
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.from('estimated_incomes').delete().eq('profile_id', testUserId)
    await admin.from('bank_balances').delete().eq('profile_id', testUserId)
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('recap_snapshots').delete().eq('profile_id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 30_000)

  // Each test recreates the baseline row state so recover starts from a
  // known shape. The route deletes-by-owner before re-inserting, so we
  // need an existing bank_balances row for the v1 UPDATE path to succeed.
  beforeEach(async () => {
    await admin.from('budget_transfers').delete().eq('profile_id', testUserId)
    await admin.from('real_income_entries').delete().eq('profile_id', testUserId)
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.from('estimated_incomes').delete().eq('profile_id', testUserId)
    await admin.from('bank_balances').delete().eq('profile_id', testUserId)
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('recap_snapshots').delete().eq('profile_id', testUserId)

    const { error } = await admin.from('bank_balances').insert({
      profile_id: testUserId,
      group_id: null,
      balance: 0,
    })
    if (error) throw error
  })

  async function insertSnapshot(payload: SnapshotPayloadV1 | SnapshotPayloadV2): Promise<string> {
    const { data, error } = await admin
      .from('recap_snapshots')
      .insert({
        profile_id: testUserId,
        group_id: null,
        snapshot_month: month,
        snapshot_year: year,
        snapshot_data: payload as unknown as Json,
        is_active: true,
      })
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error('snapshot insert returned no id')
    return data.id
  }

  async function callRecover(snapshotId: string): Promise<{
    success: boolean
    recovery_results: {
      bank_balance: boolean
      piggy_bank: boolean
      estimated_incomes: number
      estimated_budgets: number
      real_incomes: number
      real_expenses: number
      budget_transfers: number
      errors: string[]
    }
    has_errors: boolean
  }> {
    const token = await createSessionToken(testUserId, testEmail)
    const req = new Request('http://localhost/api/monthly-recap/recover', {
      method: 'POST',
      headers: {
        cookie: `session=${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ context: 'profile', snapshot_id: snapshotId, confirm: true }),
    })
    // The route handler types its argument as NextRequest, but reads only the
    // standard Request surface (cookie header, json body) — see route lines
    // 37, 45. Cast preserves the strict signature without pulling in the
    // server-only NextRequest constructor in the test runtime.
    const res = await recoverPOST(req as unknown as Parameters<RecoverRouteMod['POST']>[0])
    return await res.json()
  }

  // Cas A — v1 snapshot path: scalar `bank_balance: number`, no
  // `bank_balances` array. Hits the else-if at route:275 which UPDATEs
  // the existing row and assigns `recoveryResults.bank_balance = true`
  // (route:288). Asserts strict boolean true — a regression to a numeric
  // count would surface as `1` here.
  it('v1 snapshot → bank_balance is strictly boolean true', async () => {
    const v1: SnapshotPayloadV1 = {
      snapshot_version: 1,
      context: 'profile',
      estimated_incomes: buildEstimatedIncomes(
        testUserId,
      ) as SnapshotPayloadV1['estimated_incomes'],
      estimated_budgets: buildEstimatedBudgets(
        testUserId,
      ) as SnapshotPayloadV1['estimated_budgets'],
      real_income_entries: [],
      real_expenses: [],
      bank_balance: 1234,
    }
    const id = await insertSnapshot(v1)
    const body = await callRecover(id)

    expect(body.success).toBe(true)
    expect(body.recovery_results.bank_balance).toStrictEqual(true)
    // piggy_bank is v2-only, so v1 leaves it at the init false.
    expect(body.recovery_results.piggy_bank).toStrictEqual(false)
  }, 30_000)

  // Cas B — v2 snapshot with empty bank_balances/piggy_bank arrays AND
  // null scalar `bank_balance`. Both branches at route:268 and route:275
  // skip; recoveryResults.bank_balance stays at its init `false`. Same
  // for piggy_bank. Asserts the init value is preserved as strict
  // boolean — a regression that defaults to `0` here would break.
  it('v2 snapshot with empty arrays + null bank_balance → both flags strictly false', async () => {
    const v2: SnapshotPayloadV2 = {
      snapshot_version: 2,
      context: 'profile',
      created_at: new Date().toISOString(),
      profiles: [],
      estimated_incomes: buildEstimatedIncomes(
        testUserId,
      ) as SnapshotPayloadV2['estimated_incomes'],
      estimated_budgets: buildEstimatedBudgets(
        testUserId,
      ) as SnapshotPayloadV2['estimated_budgets'],
      real_income_entries: [],
      real_expenses: [],
      bank_balances: [],
      bank_balance: null,
      piggy_bank: [],
      remaining_to_live_snapshots: [],
      budget_transfers: [],
      monthly_recaps: [],
      _table_counts: {},
    }
    const id = await insertSnapshot(v2)
    const body = await callRecover(id)

    expect(body.success).toBe(true)
    expect(body.recovery_results.bank_balance).toStrictEqual(false)
    expect(body.recovery_results.piggy_bank).toStrictEqual(false)
  }, 30_000)

  // Cas C — v2 snapshot with a single bank_balances row AND a single
  // piggy_bank row. Hits the v2 path at route:268 / route:300 which
  // calls restoreTable; the fix branches resultKey to assign `true` for
  // these two keys (route:235-236). Asserts strict boolean true — the
  // pre-fix code assigned `data.length` (= 1) here, which is the bug.
  it('v2 snapshot with rows → both flags strictly boolean true (not numeric count)', async () => {
    const v2: SnapshotPayloadV2 = {
      snapshot_version: 2,
      context: 'profile',
      created_at: new Date().toISOString(),
      profiles: [],
      estimated_incomes: buildEstimatedIncomes(
        testUserId,
      ) as SnapshotPayloadV2['estimated_incomes'],
      estimated_budgets: buildEstimatedBudgets(
        testUserId,
      ) as SnapshotPayloadV2['estimated_budgets'],
      real_income_entries: [],
      real_expenses: [],
      bank_balances: [
        {
          profile_id: testUserId,
          group_id: null,
          balance: 555,
        } as unknown as SnapshotPayloadV2['bank_balances'][number],
      ],
      bank_balance: 555,
      piggy_bank: [
        {
          profile_id: testUserId,
          group_id: null,
          amount: 42,
        } as unknown as SnapshotPayloadV2['piggy_bank'][number],
      ],
      remaining_to_live_snapshots: [],
      budget_transfers: [],
      monthly_recaps: [],
      _table_counts: {},
    }
    const id = await insertSnapshot(v2)
    const body = await callRecover(id)

    expect(body.success).toBe(true)
    expect(body.recovery_results.bank_balance).toStrictEqual(true)
    expect(body.recovery_results.piggy_bank).toStrictEqual(true)
  }, 30_000)
})
