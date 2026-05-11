import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import type { Database } from '@/lib/database.types'

// Dynamic-import pattern (mirror lib/finance/__tests__/financial-data.test.ts):
// route.ts pulls in lib/supabase-server which crashes at module-load when the
// env vars are missing, even if the describe block is later skipped.
type RouteMod = typeof import('@/app/api/monthly-recap/process-step1/route')
type SessionMod = typeof import('@/lib/session')

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Characterization tests on POST /api/monthly-recap/process-step1.
 *
 * These tests lock the route's response shape and DB side effects BEFORE the
 * Sprint Refactor-I5 split into lib/recap/{step1-algorithm,step1-persist}.ts.
 * They must keep passing byte-identical after the route is rewired in
 * commit 7 — that is the gate.
 *
 * Pattern mirror lib/finance/__tests__/financial-data.test.ts (dynamic-import-
 * in-beforeAll, cleanup cascade FK-safe). Each test seeds the fixture rows
 * it needs (budgets/expenses/incomes/piggy/bank) in its own beforeEach
 * because the algorithm mutates piggy_bank.amount, estimated_budgets
 * .cumulated_savings, and inserts into budget_transfers — sharing across
 * tests is too pollution-prone.
 */
describe.skipIf(!ENABLED)('POST /api/monthly-recap/process-step1 — characterization', () => {
  let admin: SupabaseClient<Database>
  let POST: RouteMod['POST']
  let createSessionToken: SessionMod['createSessionToken']

  const stamp = Date.now()
  const testEmail = `recap-step1-${stamp}@popoth.test`
  let testUserId: string
  let testToken: string

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'process-step1 characterization tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const routeMod = await import('@/app/api/monthly-recap/process-step1/route')
    POST = routeMod.POST

    const sessionMod = await import('@/lib/session')
    createSessionToken = sessionMod.createSessionToken

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: `recap-${randomUUID()}`,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'Recap',
      last_name: 'Fixture',
    })
    if (profErr) throw profErr

    testToken = await createSessionToken(testUserId, testEmail)
  }, 60_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    // FK-safe cleanup; budget_transfers references estimated_budgets so it
    // clears first; real_expenses references estimated_budgets too.
    await admin.from('budget_transfers').delete().eq('profile_id', testUserId)
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('real_income_entries').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.from('estimated_incomes').delete().eq('profile_id', testUserId)
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('bank_balances').delete().eq('profile_id', testUserId)
    await admin.from('profiles').delete().eq('id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 60_000)

  // Reset only the rows the algorithm mutates. Other infrastructure (user,
  // profile, JWT) survives so each test starts from a clean financial state
  // without paying the user+profile creation cost.
  async function resetUserFinancialState(): Promise<void> {
    await admin.from('budget_transfers').delete().eq('profile_id', testUserId)
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('real_income_entries').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.from('estimated_incomes').delete().eq('profile_id', testUserId)
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('bank_balances').delete().eq('profile_id', testUserId)
  }

  function buildRequest(body: unknown, token?: string): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token !== undefined) headers.cookie = `session=${token}`
    return new Request('http://localhost/api/monthly-recap/process-step1', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  }

  // ------------------------------------------------------------------------
  // CAS 1 — excédent (revenu suffisant)
  // ------------------------------------------------------------------------
  it('CAS 1: excédent → response shape locked + piggy_bank incremented via RPC', async () => {
    await resetUserFinancialState()

    // High income relative to budgets → ravBudgetaire is positive AND
    // ravActuel ends up > ravBudgetaire → difference > 0 → CAS 1.
    await admin.from('bank_balances').insert({
      profile_id: testUserId,
      group_id: null,
      balance: 1000,
    })
    await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 50,
    })
    const { data: estIncome } = await admin
      .from('estimated_incomes')
      .insert({
        profile_id: testUserId,
        group_id: null,
        name: 'cas1 income',
        estimated_amount: 1000,
      })
      .select('id')
      .single()
    const todayIso = new Date().toISOString().split('T')[0]!
    await admin.from('real_income_entries').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 1200,
      description: 'cas1 real income',
      entry_date: todayIso,
      estimated_income_id: estIncome!.id,
      is_exceptional: false,
    })
    await admin.from('estimated_budgets').insert([
      {
        profile_id: testUserId,
        group_id: null,
        name: 'cas1 budget A',
        estimated_amount: 200,
      },
      {
        profile_id: testUserId,
        group_id: null,
        name: 'cas1 budget B',
        estimated_amount: 300,
      },
    ])

    const response = await POST(buildRequest({ context: 'profile' }, testToken))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    // Lock response shape — all top-level fields must be present.
    expect(body.success).toBe(true)
    expect(body.case).toBe('excedent')
    expect(typeof body.initial_rav).toBe('number')
    expect(typeof body.budgetary_rav).toBe('number')
    expect(typeof body.final_rav).toBe('number')
    expect(typeof body.difference).toBe('number')
    expect(typeof body.piggy_bank_final).toBe('number')
    expect(Array.isArray(body.operations_performed)).toBe(true)
    expect(Array.isArray(body.budgets_with_deficit_refloated)).toBe(true)
    expect(typeof body.timestamp).toBe('number')

    // The excédent path must add `difference` to piggy_bank (was 50€).
    expect(body.piggy_bank_final).toBeGreaterThan(50)

    // operations_performed must contain step '1.1' (excédent to piggy)
    const ops = body.operations_performed as Array<{ step: string; type: string }>
    expect(ops.some((o) => o.step === '1.1' && o.type === 'excedent_to_piggy_bank')).toBe(true)

    // DB side effect: piggy_bank.amount matches body.piggy_bank_final
    const { data: piggy } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', testUserId)
      .single()
    expect(piggy?.amount).toBe(body.piggy_bank_final)
  }, 60_000)

  // ------------------------------------------------------------------------
  // CAS 2 — déficit (revenu insuffisant) with savings only
  // ------------------------------------------------------------------------
  it('CAS 2 ÉTAPE 2.2: savings only → cumulated_savings decremented via RPC', async () => {
    await resetUserFinancialState()

    // Low income vs budgets → CAS 2 (déficit). Provide enough cumulated_savings
    // to cover the gap entirely → only ÉTAPE 2.2 fires.
    await admin.from('bank_balances').insert({
      profile_id: testUserId,
      group_id: null,
      balance: 2000,
    })
    await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 50,
    })
    // estimated_income = 300, totalEstimatedBudgets = 400 → ravBudgetaire = -100
    await admin.from('estimated_incomes').insert({
      profile_id: testUserId,
      group_id: null,
      name: 'cas2 income',
      estimated_amount: 300,
    })

    // 4 budgets: 1 deficit (real spent > estimated), 1 with savings (no spend), 2 neutral
    const { data: budgets } = await admin
      .from('estimated_budgets')
      .insert([
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas2 deficit',
          estimated_amount: 100,
          cumulated_savings: 0,
        },
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas2 savings A',
          estimated_amount: 100,
          cumulated_savings: 200,
        },
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas2 savings B',
          estimated_amount: 100,
          cumulated_savings: 300,
        },
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas2 neutral',
          estimated_amount: 100,
          cumulated_savings: 0,
        },
      ])
      .select('id, name, cumulated_savings')
    expect(budgets).toHaveLength(4)
    const deficitBudgetId = budgets!.find((b) => b.name === 'cas2 deficit')!.id
    const savingsBudgetAId = budgets!.find((b) => b.name === 'cas2 savings A')!.id
    const savingsBudgetBId = budgets!.find((b) => b.name === 'cas2 savings B')!.id

    // Spend more on the deficit budget than estimated.
    const todayIso = new Date().toISOString().split('T')[0]!
    await admin.from('real_expenses').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 300,
      // amount_from_budget MUST be set explicitly — the table default is 0, so
      // omitting it makes the budget-deficit calc in _loadFinancialData treat
      // the row as "0 from budget" (lib/finance/financial-data.ts:138-143).
      amount_from_budget: 300,
      description: 'cas2 overspend',
      expense_date: todayIso,
      estimated_budget_id: deficitBudgetId,
      is_exceptional: false,
    })

    const response = await POST(buildRequest({ context: 'profile' }, testToken))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    // Lock CAS 2 response shape additions
    expect(body.success).toBe(true)
    expect(body.case).toBe('deficit')
    expect(typeof body.gap_residuel).toBe('number')
    expect(typeof body.is_fully_balanced).toBe('boolean')

    // The savings budgets must have been decremented via RPC.
    const { data: savingsA } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', savingsBudgetAId)
      .single()
    const { data: savingsB } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', savingsBudgetBId)
      .single()
    expect(savingsA?.cumulated_savings).toBeLessThan(200)
    expect(savingsB?.cumulated_savings).toBeLessThan(300)

    // operations_performed includes step '2.2' for both savings budgets
    const ops = body.operations_performed as Array<{ step: string; type: string }>
    const step22Ops = ops.filter((o) => o.step === '2.2' && o.type === 'use_savings')
    expect(step22Ops.length).toBeGreaterThanOrEqual(1)
  }, 60_000)

  // ------------------------------------------------------------------------
  // CAS 2 — déficit with deficit refloat (ÉTAPE 2.3.1 fires)
  // ------------------------------------------------------------------------
  it('CAS 2 ÉTAPE 2.3.1: deficit refloat inserts budget_transfers (null → deficit_budget)', async () => {
    await resetUserFinancialState()

    await admin.from('bank_balances').insert({
      profile_id: testUserId,
      group_id: null,
      balance: 2000,
    })
    await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 50,
    })
    await admin.from('estimated_incomes').insert({
      profile_id: testUserId,
      group_id: null,
      name: 'cas2-refloat income',
      estimated_amount: 200,
    })

    const { data: budgets } = await admin
      .from('estimated_budgets')
      .insert([
        {
          profile_id: testUserId,
          group_id: null,
          name: 'refloat deficit',
          estimated_amount: 100,
          cumulated_savings: 0,
        },
        {
          profile_id: testUserId,
          group_id: null,
          name: 'refloat savings',
          estimated_amount: 100,
          cumulated_savings: 250,
        },
      ])
      .select('id, name')
    const deficitBudgetId = budgets!.find((b) => b.name === 'refloat deficit')!.id

    const todayIso = new Date().toISOString().split('T')[0]!
    await admin.from('real_expenses').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 200,
      amount_from_budget: 200,
      description: 'refloat overspend',
      expense_date: todayIso,
      estimated_budget_id: deficitBudgetId,
      is_exceptional: false,
    })

    const response = await POST(buildRequest({ context: 'profile' }, testToken))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    expect(body.case).toBe('deficit')

    // budget_transfers must contain at least one row null→deficitBudgetId
    // (step 2.3.1: refloat the deficit budget from general resources)
    const { data: transfers } = await admin
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount')
      .eq('profile_id', testUserId)
    expect(transfers).toBeTruthy()
    const refloatRow = transfers!.find(
      (t) => t.from_budget_id === null && t.to_budget_id === deficitBudgetId,
    )
    expect(refloatRow).toBeDefined()
    expect(Number(refloatRow!.transfer_amount)).toBeGreaterThan(0)

    // operations_performed must include step '2.3.1'
    const ops = body.operations_performed as Array<{ step: string; type: string }>
    expect(ops.some((o) => o.step === '2.3.1' && o.type === 'transfer_to_deficit')).toBe(true)
  }, 60_000)

  // ------------------------------------------------------------------------
  // Validation — 400 invalid body
  // ------------------------------------------------------------------------
  it('returns 400 on invalid context value', async () => {
    const response = await POST(buildRequest({ context: 'invalid' }, testToken))
    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(typeof body.error).toBe('string')
  })

  // ------------------------------------------------------------------------
  // Auth — 401 without session cookie
  // ------------------------------------------------------------------------
  it('returns 401 without session cookie', async () => {
    const response = await POST(buildRequest({ context: 'profile' }, undefined))
    expect(response.status).toBe(401)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.error).toBe('Session invalide')
  })
})
