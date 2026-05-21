import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import type { Database } from '@/lib/database.types'

// Dynamic-import pattern (mirror app/api/monthly-recap/process-step1/__tests__/
// route.integration.test.ts): route.ts pulls in lib/supabase-server which
// crashes at module-load when the env vars are missing, even if the describe
// block is later skipped.
type RouteMod = typeof import('@/app/api/monthly-recap/complete/route')
type SessionMod = typeof import('@/lib/session')

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Characterization tests on POST /api/monthly-recap/complete.
 *
 * These tests lock the route's response shape and DB side effects BEFORE
 * the Sprint Refactor-I6 split into lib/recap/{complete-algorithm,complete-persist}.ts.
 * They must keep passing byte-identical after the route is rewired in Sub-8.
 *
 * NOTE Sprint Refactor-I6 (2026-05-14): the latent atomicity bug at L484
 * (SELECT-then-UPDATE on cumulated_savings) is fixed inline via
 * updateBudgetCumulatedSavings RPC. Math is identical under sequential
 * load (these tests run serially) — caract tests pass byte-identical.
 *
 * Pattern mirror app/api/monthly-recap/process-step1/__tests__/route.integration.test.ts
 * (dynamic-import-in-beforeAll, FK-safe cleanup cascade). Each test seeds
 * the fixture rows it needs because the route deletes real_income_entries
 * / real_expenses / budget_transfers and mutates estimated_budgets —
 * sharing across tests is too pollution-prone.
 */
describe.skipIf(!ENABLED)('POST /api/monthly-recap/complete — characterization', () => {
  let admin: SupabaseClient<Database>
  let POST: RouteMod['POST']
  let createSessionToken: SessionMod['createSessionToken']

  const stamp = Date.now()
  const testEmail = `recap-complete-${stamp}@popoth.test`
  let testUserId: string
  let testToken: string

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'complete characterization tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const routeMod = await import('@/app/api/monthly-recap/complete/route')
    POST = routeMod.POST

    const sessionMod = await import('@/lib/session')
    createSessionToken = sessionMod.createSessionToken

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: `complete-${randomUUID()}`,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'Complete',
      last_name: 'Fixture',
    })
    if (profErr) throw profErr

    testToken = await createSessionToken(testUserId, testEmail)
  }, 60_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    // FK-safe cleanup; monthly_recaps + budget_transfers reference
    // estimated_budgets so they clear first; real_expenses references
    // estimated_budgets too.
    await admin.from('monthly_recaps').delete().eq('profile_id', testUserId)
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

  // Reset rows the route mutates. User + profile + JWT survive so each
  // test starts from a clean financial state without paying the user
  // creation cost.
  async function resetUserFinancialState(): Promise<void> {
    await admin.from('monthly_recaps').delete().eq('profile_id', testUserId)
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
    return new Request('http://localhost/api/monthly-recap/complete', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  }

  function buildSessionId(profileId: string): string {
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()
    return `profile_${profileId}_${month}_${year}_${Date.now()}`
  }

  // ------------------------------------------------------------------------
  // CAS 1 — carry_forward simple happy path
  // ------------------------------------------------------------------------
  it('CAS 1 carry_forward: response shape + monthly_recaps row + cleanup + surplus → cumulated_savings', async () => {
    await resetUserFinancialState()

    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()

    // Seed: budget 500 estimated, 0 spent → surplus 500 → cumulated_savings
    // goes from 0 to 500 (block 5 savings processing). No deficit (no
    // overspend), no exceptional (current_remaining_to_live = baseRtl).
    await admin.from('bank_balances').insert({
      profile_id: testUserId,
      group_id: null,
      balance: 1000,
      current_remaining_to_live: 500,
    })
    await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 50,
    })
    await admin.from('estimated_incomes').insert({
      profile_id: testUserId,
      group_id: null,
      name: 'cas1 income',
      estimated_amount: 500,
    })
    const { data: budget } = await admin
      .from('estimated_budgets')
      .insert({
        profile_id: testUserId,
        group_id: null,
        name: 'cas1 budget',
        estimated_amount: 500,
        cumulated_savings: 0,
        monthly_surplus: 0,
        monthly_deficit: 0,
      })
      .select('id')
      .single()

    const response = await POST(
      buildRequest(
        {
          context: 'profile',
          session_id: buildSessionId(testUserId),
          remaining_to_live_choice: { action: 'carry_forward', final_amount: 500 },
        },
        testToken,
      ),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    // Lock top-level response shape
    expect(body.success).toBe(true)
    expect(typeof body.message).toBe('string')
    expect(body.redirect_to_dashboard).toBe(true)

    const summary = body.summary as Record<string, unknown>
    expect(typeof summary.recap_id).toBe('string')
    expect(typeof summary.initial_remaining_to_live).toBe('number')
    expect(summary.final_remaining_to_live).toBe(500)
    expect(summary.action_taken).toBe('carry_forward')
    expect(summary.budget_used).toBe(null)
    expect(typeof summary.total_surplus).toBe('number')
    expect(typeof summary.total_deficit).toBe('number')
    expect(summary.incomes_reset).toBe(true)
    expect(summary.month).toBe(currentMonth)
    expect(summary.year).toBe(currentYear)
    expect(typeof summary.completed_at).toBe('string')

    // DB side effect: monthly_recaps row inserted with correct fields
    const { data: recap } = await admin
      .from('monthly_recaps')
      .select('*')
      .eq('id', summary.recap_id as string)
      .single()
    expect(recap).toBeTruthy()
    expect(recap?.profile_id).toBe(testUserId)
    expect(recap?.group_id).toBe(null)
    expect(recap?.current_step).toBe(3)
    expect(recap?.recap_month).toBe(currentMonth)
    expect(recap?.recap_year).toBe(currentYear)
    expect(recap?.remaining_to_live_source).toBe('carried_forward')
    expect(Number(recap?.final_remaining_to_live)).toBe(500)
    expect(recap?.completed_at).toBeTruthy()

    // DB side effect: surplus (500 - 0) → cumulated_savings (block 5).
    // ALSO carryover_spent_amount set to 0 (deficit = 0). Plus monthly_*
    // reset + last_monthly_update touched.
    const { data: budgetAfter } = await admin
      .from('estimated_budgets')
      .select(
        'cumulated_savings, monthly_surplus, monthly_deficit, carryover_spent_amount, last_monthly_update',
      )
      .eq('id', budget!.id)
      .single()
    expect(Number(budgetAfter?.cumulated_savings)).toBe(500)
    expect(Number(budgetAfter?.monthly_surplus)).toBe(0)
    expect(Number(budgetAfter?.monthly_deficit)).toBe(0)
    expect(Number(budgetAfter?.carryover_spent_amount)).toBe(0)
    expect(budgetAfter?.last_monthly_update).toBeTruthy()

    // Cleanup: real_expenses + real_income_entries + budget_transfers empty
    const { data: remainingExpenses } = await admin
      .from('real_expenses')
      .select('id')
      .eq('profile_id', testUserId)
    expect(remainingExpenses ?? []).toHaveLength(0)
    const { data: remainingIncomes } = await admin
      .from('real_income_entries')
      .select('id')
      .eq('profile_id', testUserId)
    expect(remainingIncomes ?? []).toHaveLength(0)
    const { data: remainingTransfers } = await admin
      .from('budget_transfers')
      .select('id')
      .eq('profile_id', testUserId)
    expect(remainingTransfers ?? []).toHaveLength(0)
  }, 60_000)

  // ------------------------------------------------------------------------
  // CAS 2 — deduct_from_budget happy path
  // ------------------------------------------------------------------------
  it('CAS 2 deduct_from_budget: recap remaining_to_live_source = from_budget_<name> + budget_used in summary', async () => {
    await resetUserFinancialState()

    await admin.from('bank_balances').insert({
      profile_id: testUserId,
      group_id: null,
      balance: 1000,
      current_remaining_to_live: 300,
    })
    await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 0,
    })
    await admin.from('estimated_incomes').insert({
      profile_id: testUserId,
      group_id: null,
      name: 'cas2 income',
      estimated_amount: 300,
    })
    const { data: budget } = await admin
      .from('estimated_budgets')
      .insert({
        profile_id: testUserId,
        group_id: null,
        name: 'Compte courant',
        estimated_amount: 300,
        cumulated_savings: 0,
      })
      .select('id, name')
      .single()

    const response = await POST(
      buildRequest(
        {
          context: 'profile',
          session_id: buildSessionId(testUserId),
          remaining_to_live_choice: {
            action: 'deduct_from_budget',
            budget_id: budget!.id,
            final_amount: 50,
          },
        },
        testToken,
      ),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    const summary = body.summary as Record<string, unknown>
    expect(summary.action_taken).toBe('deduct_from_budget')
    expect(summary.budget_used).toBe(budget!.name)
    expect(summary.final_remaining_to_live).toBe(50)

    const { data: recap } = await admin
      .from('monthly_recaps')
      .select('remaining_to_live_source, remaining_to_live_amount, final_remaining_to_live')
      .eq('id', summary.recap_id as string)
      .single()
    expect(recap?.remaining_to_live_source).toBe(`from_budget_${budget!.name}`)
    expect(Number(recap?.remaining_to_live_amount)).toBe(50)
    expect(Number(recap?.final_remaining_to_live)).toBe(50)
  }, 60_000)

  // ------------------------------------------------------------------------
  // CAS 3 — deficit + surplus mixed (exercises carryover_spent_amount + RPC
  // path on cumulated_savings + Block 4 exceptional expense for uncovered deficit)
  // ------------------------------------------------------------------------
  it('CAS 3 mixed deficit + surplus: A.carryover=200 + B.cumulated_savings=150 + 1 exceptional row (uncovered deficit)', async () => {
    await resetUserFinancialState()

    // Runtime math (loadCompleteSnapshot → decideCompleteAllocation → applyCompleteDecision):
    //
    //   1. Seed bank.current_rtl=400, totalEstimatedIncome=700, totalEstimatedBudgets=300.
    //   2. loadCompleteSnapshot step 2 calls getProfileFinancialData which RECOMPUTES
    //      the RAV from scratch and OVERWRITES bank_balances via saveRavToDatabase
    //      (lib/finance/financial-data.ts:207). getProfileFinancialData computes:
    //        incomeContribution = 700 (estimated, no real entries)
    //        totalBudgetDeficits = 200 (A: 300 spent on 100 estimated)
    //        remainingToLive = 700 + 0 - 300 - 0 - 200 = 200 → SAVED to bank
    //   3. loadCompleteSnapshot step 6 re-reads bank.current_rtl post-overwrite = 200.
    //   4. Algorithm: baseRtl = 700 - 300 = 400; difference = 200 - 400 = -200;
    //      preTrans/postTrans = 200/200 → deficitCoveredByTransfers = 0 (no transfers).
    //      Carryover ≠ transfers in the algorithm's adjustedDifference formula, so
    //      the 200 deficit going to carryover is NOT credited as "covered".
    //      adjustedDifference = -200 → exceptional expense of 200 created.
    //   5. Step 3 cleanup DELETE wipes the 2 seeded real_expenses.
    //   6. Step 5 INSERTs the exceptional expense (amount=200, is_exceptional=true)
    //      AFTER the cleanup → 1 row remains in real_expenses.
    //
    // Per-budget effects:
    //   Budget A: estimated=100, real_expense=300 → deficit=200 → carryover=200, no surplus
    //   Budget B: estimated=200, real_expense=50  → deficit=0,  surplus=150 → cumulated_savings=0+150=150
    //
    // CONTRACT (pinned by this test): the algorithm intentionally creates an
    // exceptional expense when the recomputed RAV is below the base RAV (i.e.
    // there are deficits not covered by transfers). This is the design pinned
    // by lib/recap/__tests__/complete-algorithm.test.ts Block 4. The seemingly
    // "double-counted" interaction with carryover_spent_amount is a SEPARATE
    // concern (CLAUDE.md §11 — investigation deferred, no production incident).

    await admin.from('bank_balances').insert({
      profile_id: testUserId,
      group_id: null,
      balance: 1000,
      current_remaining_to_live: 400,
    })
    await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 0,
    })
    await admin.from('estimated_incomes').insert({
      profile_id: testUserId,
      group_id: null,
      name: 'cas3 income',
      estimated_amount: 700,
    })
    const { data: budgets } = await admin
      .from('estimated_budgets')
      .insert([
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas3 deficit',
          estimated_amount: 100,
          cumulated_savings: 0,
        },
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas3 surplus',
          estimated_amount: 200,
          cumulated_savings: 0,
        },
      ])
      .select('id, name')
    expect(budgets).toHaveLength(2)
    const deficitId = budgets!.find((b) => b.name === 'cas3 deficit')!.id
    const surplusId = budgets!.find((b) => b.name === 'cas3 surplus')!.id

    const todayIso = new Date().toISOString().split('T')[0]!
    // amount_from_budget MUST be set explicitly — the table default is 0,
    // so omitting it breaks the deficit calc in _loadFinancialData
    // (lib/finance/financial-data.ts:138-143).
    await admin.from('real_expenses').insert([
      {
        profile_id: testUserId,
        group_id: null,
        amount: 300,
        amount_from_budget: 300,
        description: 'cas3 overspend',
        expense_date: todayIso,
        estimated_budget_id: deficitId,
        is_exceptional: false,
      },
      {
        profile_id: testUserId,
        group_id: null,
        amount: 50,
        amount_from_budget: 50,
        description: 'cas3 underspend',
        expense_date: todayIso,
        estimated_budget_id: surplusId,
        is_exceptional: false,
      },
    ])

    const response = await POST(
      buildRequest(
        {
          context: 'profile',
          session_id: buildSessionId(testUserId),
          remaining_to_live_choice: { action: 'carry_forward', final_amount: 400 },
        },
        testToken,
      ),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.success).toBe(true)

    // Deficit budget: carryover_spent_amount = adjustedSpent - estimated
    //   = (300 + 0 - 0) - 100 = 200
    const { data: deficitAfter } = await admin
      .from('estimated_budgets')
      .select('carryover_spent_amount, cumulated_savings')
      .eq('id', deficitId)
      .single()
    expect(Number(deficitAfter?.carryover_spent_amount)).toBe(200)
    expect(Number(deficitAfter?.cumulated_savings)).toBe(0)

    // Surplus budget: cumulated_savings = 0 + (200 - 50) = 150
    // (This exercises the atomicity fix path: updateBudgetCumulatedSavings RPC
    // delta +150 atomic add. Math identical to pre-refactor SELECT-then-UPDATE
    // because there's only one writer at a time in serial tests.)
    const { data: surplusAfter } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings, carryover_spent_amount')
      .eq('id', surplusId)
      .single()
    expect(Number(surplusAfter?.cumulated_savings)).toBe(150)
    expect(Number(surplusAfter?.carryover_spent_amount)).toBe(0)

    // Step 3 cleanup DELETE wipes the 2 seeded real_expenses ; Step 5 INSERTs
    // the exceptional expense (amount=200, is_exceptional=true) AFTER cleanup.
    // Net: exactly 1 row remains, the exceptional from Block 4.
    const { data: expensesAfter } = await admin
      .from('real_expenses')
      .select('id, amount, is_exceptional, estimated_budget_id, description, created_by_profile_id')
      .eq('profile_id', testUserId)
    expect(expensesAfter ?? []).toHaveLength(1)
    const exceptional = expensesAfter![0]!
    expect(Number(exceptional.amount)).toBe(200)
    expect(exceptional.is_exceptional).toBe(true)
    expect(exceptional.estimated_budget_id).toBe(null)
    expect(exceptional.description).toMatch(/^Écart de reste à vivre reporté du récap /)
    // Sprint Group-Transaction-Creator-Avatar : recap-generated exceptional
    // expense is attributed to the user who finalized the recap (testUserId
    // here = the JWT issuer for buildSessionId).
    expect(exceptional.created_by_profile_id).toBe(testUserId)
  }, 60_000)

  // ------------------------------------------------------------------------
  // Validation — 400 on deduct_from_budget without budget_id
  // (completeBodySchema discriminatedUnion rejects this shape)
  // ------------------------------------------------------------------------
  it('returns 400 on deduct_from_budget without budget_id', async () => {
    const response = await POST(
      buildRequest(
        {
          context: 'profile',
          session_id: buildSessionId(testUserId),
          remaining_to_live_choice: {
            action: 'deduct_from_budget',
            final_amount: 100,
            // missing budget_id — discriminatedUnion rejects
          },
        },
        testToken,
      ),
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(typeof body.error).toBe('string')
  })

  // ------------------------------------------------------------------------
  // Auth — 401 without session cookie
  // ------------------------------------------------------------------------
  it('returns 401 without session cookie', async () => {
    const response = await POST(
      buildRequest(
        {
          context: 'profile',
          session_id: buildSessionId(testUserId),
          remaining_to_live_choice: { action: 'carry_forward', final_amount: 100 },
        },
        undefined,
      ),
    )
    expect(response.status).toBe(401)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.error).toBe('Session invalide')
  })
})
