import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import type { Database, Json } from '@/lib/database.types'
import type { SnapshotPayloadV1, SnapshotPayloadV2 } from '@/lib/recap-snapshot.types'

// Dynamic-import pattern (mirror app/api/monthly-recap/complete/__tests__/
// route.integration.test.ts): route.ts pulls in lib/supabase-server which
// crashes at module-load when env vars are missing, even if the describe
// block is later skipped.
type RouteMod = typeof import('@/app/api/monthly-recap/recover/route')
type SessionMod = typeof import('@/lib/session')

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Characterization tests on POST /api/monthly-recap/recover.
 *
 * Pins the route's response shape + DB side effects BEFORE the Sprint
 * Refactor-Recover split into lib/recap/{recover-algorithm,recover-persist}.ts.
 * Must keep passing byte-identical after the route is rewired.
 *
 * Coverage:
 *   - CAS 1 happy v2 snapshot: seeded rows wiped + replaced by snapshot content
 *     + boolean flags strict true for bank_balance/piggy_bank + snapshot
 *     is_active flipped to false (intent of step 8 deactivation).
 *   - CAS 2 v1 fallback: scalar bank_balance triggers UPDATE path L238-253
 *     + recoveryResults.bank_balance === true (strict boolean Sprint
 *     Lint-Followups invariant).
 *   - CAS 3 empty v2 arrays: no rows restored + boolean flags strict false
 *     (init value preserved).
 *   - 400 schema: confirm=false rejected by recoverRecapBodySchema literal(true).
 *   - 401 no session cookie: withAuthAndProfile rejects.
 *
 * The 3 boolean-semantic regressions (Sprint Lint-Followups Item 1, Cas A/B/C
 * in lib/__tests__/api-regressions.test.ts:170-423) cover the strict boolean
 * type invariant from a different angle and stay gated on SUPABASE_API_TESTS=1.
 * They are orthogonal: this file pins the full pipeline + cleanup; that file
 * pins just the boolean shape in recoveryResults.
 */
describe.skipIf(!ENABLED)('POST /api/monthly-recap/recover — characterization', () => {
  let admin: SupabaseClient<Database>
  let POST: RouteMod['POST']
  let createSessionToken: SessionMod['createSessionToken']

  const stamp = Date.now()
  const testEmail = `recap-recover-${stamp}@popoth.test`
  let testUserId: string
  let testToken: string

  const month = new Date().getMonth() + 1
  const year = new Date().getFullYear()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'recover characterization tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    if (!process.env.JWT_SECRET_KEY) {
      throw new Error(
        'recover characterization tests require JWT_SECRET_KEY (lib/session.ts signs the cookie)',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const routeMod = await import('@/app/api/monthly-recap/recover/route')
    POST = routeMod.POST

    const sessionMod = await import('@/lib/session')
    createSessionToken = sessionMod.createSessionToken

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: `recover-${randomUUID()}`,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'Recover',
      last_name: 'Caract',
    })
    if (profErr) throw profErr

    testToken = await createSessionToken(testUserId, testEmail)
  }, 60_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    // FK-safe cleanup; budget_transfers + real_expenses reference
    // estimated_budgets so they clear first.
    await admin.from('budget_transfers').delete().eq('profile_id', testUserId)
    await admin.from('real_income_entries').delete().eq('profile_id', testUserId)
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.from('estimated_incomes').delete().eq('profile_id', testUserId)
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('bank_balances').delete().eq('profile_id', testUserId)
    await admin.from('recap_snapshots').delete().eq('profile_id', testUserId)
    await admin.from('profiles').delete().eq('id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 60_000)

  // Reset rows the route mutates. User + profile + JWT survive so each test
  // starts from a clean financial state without paying the user creation
  // cost. Mirror complete/route.integration.test.ts:resetUserFinancialState.
  async function resetUserFinancialState(): Promise<void> {
    await admin.from('budget_transfers').delete().eq('profile_id', testUserId)
    await admin.from('real_income_entries').delete().eq('profile_id', testUserId)
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.from('estimated_incomes').delete().eq('profile_id', testUserId)
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('bank_balances').delete().eq('profile_id', testUserId)
    await admin.from('recap_snapshots').delete().eq('profile_id', testUserId)
  }

  function buildRequest(body: unknown, token?: string): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token !== undefined) headers.cookie = `session=${token}`
    return new Request('http://localhost/api/monthly-recap/recover', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  }

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

  // ------------------------------------------------------------------------
  // CAS 1 — happy v2 snapshot: full pipeline (deletes pre-existing + inserts
  // snapshot contents) + boolean flags strict true + snapshot deactivation
  // ------------------------------------------------------------------------
  it('CAS 1 happy v2 snapshot: tables restored + boolean flags strict true + snapshot deactivated', async () => {
    await resetUserFinancialState()

    // 1. Seed PRE-EXISTING state that should be DELETED by recovery.
    await admin.from('bank_balances').insert({
      profile_id: testUserId,
      group_id: null,
      balance: 999, // sentinel: should be overwritten to 555 (snapshot value)
    })
    await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 100, // sentinel: should be overwritten to 42 (snapshot value)
    })
    await admin.from('estimated_incomes').insert({
      profile_id: testUserId,
      group_id: null,
      name: 'pre-existing income (should be wiped)',
      estimated_amount: 800,
    })

    // 2. Build a v2 snapshot whose contents differ from the pre-existing
    //    state. After recovery, DB must match the snapshot, not the pre.
    const snapshotIncomeId = randomUUID()
    const snapshotBudgetId = randomUUID()
    const snapshotExpenseId = randomUUID()
    const snapshotIncomeEntryId = randomUUID()
    const snapshotPiggyId = randomUUID()
    const snapshotBankId = randomUUID()
    const snapshotTransferId = randomUUID()
    const todayIso = new Date().toISOString().split('T')[0]!

    const v2: SnapshotPayloadV2 = {
      snapshot_version: 2,
      context: 'profile',
      created_at: new Date().toISOString(),
      profiles: [],
      estimated_incomes: [
        {
          id: snapshotIncomeId,
          profile_id: testUserId,
          group_id: null,
          name: 'cas1 snapshot income',
          estimated_amount: 1200,
        } as unknown as SnapshotPayloadV2['estimated_incomes'][number],
      ],
      estimated_budgets: [
        {
          id: snapshotBudgetId,
          profile_id: testUserId,
          group_id: null,
          name: 'cas1 snapshot budget',
          estimated_amount: 300,
          cumulated_savings: 75,
        } as unknown as SnapshotPayloadV2['estimated_budgets'][number],
      ],
      real_income_entries: [
        {
          id: snapshotIncomeEntryId,
          profile_id: testUserId,
          group_id: null,
          amount: 1200,
          description: 'cas1 snapshot income entry',
          entry_date: todayIso,
        } as unknown as SnapshotPayloadV2['real_income_entries'][number],
      ],
      real_expenses: [
        {
          id: snapshotExpenseId,
          profile_id: testUserId,
          group_id: null,
          amount: 50,
          description: 'cas1 snapshot expense',
          expense_date: todayIso,
          estimated_budget_id: snapshotBudgetId,
          is_exceptional: false,
        } as unknown as SnapshotPayloadV2['real_expenses'][number],
      ],
      bank_balances: [
        {
          id: snapshotBankId,
          profile_id: testUserId,
          group_id: null,
          balance: 555,
          current_remaining_to_live: 200,
        } as unknown as SnapshotPayloadV2['bank_balances'][number],
      ],
      bank_balance: 555,
      piggy_bank: [
        {
          id: snapshotPiggyId,
          profile_id: testUserId,
          group_id: null,
          amount: 42,
        } as unknown as SnapshotPayloadV2['piggy_bank'][number],
      ],
      remaining_to_live_snapshots: [],
      budget_transfers: [
        {
          // from=null represents a piggy_bank → budget transfer; satisfies
          // the budget_transfers_different_budgets_check CHECK constraint
          // (which forbids from === to when both are non-null).
          id: snapshotTransferId,
          profile_id: testUserId,
          group_id: null,
          from_budget_id: null,
          to_budget_id: snapshotBudgetId,
          transfer_amount: 25,
          transfer_date: todayIso,
        } as unknown as SnapshotPayloadV2['budget_transfers'][number],
      ],
      monthly_recaps: [],
      _table_counts: {},
    }
    const snapshotId = await insertSnapshot(v2)

    // 3. Call POST recover.
    const response = await POST(
      buildRequest({ context: 'profile', snapshot_id: snapshotId, confirm: true }, testToken),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    // Lock top-level response shape
    expect(body.success).toBe(true)
    expect(typeof body.message).toBe('string')
    expect(body.snapshot_id).toBe(snapshotId)
    expect(typeof body.snapshot_date).toBe('string')
    expect(body.context).toBe('profile')
    expect(body.month).toBe(month)
    expect(body.year).toBe(year)

    // recovery_results shape: counts for tables + strict booleans for bank/piggy
    const results = body.recovery_results as Record<string, unknown>
    // Surface any silent recovery errors before asserting strict shape so
    // the diagnostic is in the assertion message (CAS 1 must run clean).
    expect(results.errors).toEqual([])
    expect(body.has_errors).toBe(false)

    expect(results.estimated_incomes).toBe(1)
    expect(results.estimated_budgets).toBe(1)
    expect(results.real_incomes).toBe(1)
    expect(results.real_expenses).toBe(1)
    expect(results.bank_balance).toStrictEqual(true) // CRITICAL Sprint Lint-Followups invariant
    expect(results.piggy_bank).toStrictEqual(true) // CRITICAL Sprint Lint-Followups invariant
    expect(results.budget_transfers).toBe(1)
    expect(results.errors).toEqual([])

    // DB side effect: tables reflect snapshot content (DELETE + INSERT happened)
    const { data: budgetsAfter } = await admin
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq('profile_id', testUserId)
    expect(budgetsAfter).toHaveLength(1)
    expect(budgetsAfter![0]!.name).toBe('cas1 snapshot budget')
    expect(Number(budgetsAfter![0]!.estimated_amount)).toBe(300)
    expect(Number(budgetsAfter![0]!.cumulated_savings)).toBe(75)

    const { data: incomesAfter } = await admin
      .from('estimated_incomes')
      .select('name, estimated_amount')
      .eq('profile_id', testUserId)
    expect(incomesAfter).toHaveLength(1)
    expect(incomesAfter![0]!.name).toBe('cas1 snapshot income')

    const { data: bankAfter } = await admin
      .from('bank_balances')
      .select('balance')
      .eq('profile_id', testUserId)
      .single()
    expect(Number(bankAfter?.balance)).toBe(555) // snapshot value, not pre-existing 999

    const { data: piggyAfter } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', testUserId)
      .single()
    expect(Number(piggyAfter?.amount)).toBe(42) // snapshot value, not pre-existing 100

    const { data: transfersAfter } = await admin
      .from('budget_transfers')
      .select('id, transfer_amount')
      .eq('profile_id', testUserId)
    expect(transfersAfter).toHaveLength(1)
    expect(Number(transfersAfter![0]!.transfer_amount)).toBe(25)

    // Step 8: snapshot deactivated (is_active flipped to false)
    const { data: snapshotAfter } = await admin
      .from('recap_snapshots')
      .select('is_active')
      .eq('id', snapshotId)
      .single()
    expect(snapshotAfter?.is_active).toBe(false)
  }, 60_000)

  // ------------------------------------------------------------------------
  // CAS 2 — v1 fallback: scalar bank_balance triggers UPDATE path L238-253
  // ------------------------------------------------------------------------
  it('CAS 2 v1 fallback: scalar bank_balance + boolean strict true via UPDATE path', async () => {
    await resetUserFinancialState()

    // For v1 UPDATE path to work, the bank_balances row MUST already exist
    // (the path does .update().eq() rather than insert).
    await admin.from('bank_balances').insert({
      profile_id: testUserId,
      group_id: null,
      balance: 0, // will be overwritten to 1234 (v1 scalar)
    })

    const v1: SnapshotPayloadV1 = {
      snapshot_version: 1,
      context: 'profile',
      estimated_incomes: [
        {
          id: randomUUID(),
          profile_id: testUserId,
          group_id: null,
          name: 'cas2 v1 income',
          estimated_amount: 500,
        } as unknown as SnapshotPayloadV1['estimated_incomes'][number],
      ],
      estimated_budgets: [
        {
          id: randomUUID(),
          profile_id: testUserId,
          group_id: null,
          name: 'cas2 v1 budget',
          estimated_amount: 100,
        } as unknown as SnapshotPayloadV1['estimated_budgets'][number],
      ],
      real_income_entries: [],
      real_expenses: [],
      bank_balance: 1234, // scalar v1 path
    }
    const snapshotId = await insertSnapshot(v1)

    const response = await POST(
      buildRequest({ context: 'profile', snapshot_id: snapshotId, confirm: true }, testToken),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.success).toBe(true)

    const results = body.recovery_results as Record<string, unknown>
    // v1 path: bank_balance via UPDATE → result key set to strict true
    expect(results.bank_balance).toStrictEqual(true)
    // piggy_bank is v2-only — stays at init false
    expect(results.piggy_bank).toStrictEqual(false)
    // v1 has no budget_transfers, no piggy — counts default
    expect(results.budget_transfers).toBe(0)
    // Lists populated
    expect(results.estimated_incomes).toBe(1)
    expect(results.estimated_budgets).toBe(1)

    // DB side effect: bank_balances.balance updated to scalar value
    const { data: bankAfter } = await admin
      .from('bank_balances')
      .select('balance')
      .eq('profile_id', testUserId)
      .single()
    expect(Number(bankAfter?.balance)).toBe(1234)
  }, 60_000)

  // ------------------------------------------------------------------------
  // CAS 3 — v2 snapshot with empty bank/piggy/transfers arrays:
  // restoreTable early-returns on empty data, init values preserved as
  // strict booleans (init false). Pins the early-return semantic so a
  // future regression that "always assigns true on no-op" breaks the suite.
  // ------------------------------------------------------------------------
  it('CAS 3 v2 with empty arrays: boolean flags strict false + budget_transfers count = 0', async () => {
    await resetUserFinancialState()

    const v2: SnapshotPayloadV2 = {
      snapshot_version: 2,
      context: 'profile',
      created_at: new Date().toISOString(),
      profiles: [],
      estimated_incomes: [
        {
          id: randomUUID(),
          profile_id: testUserId,
          group_id: null,
          name: 'cas3 v2 income',
          estimated_amount: 100,
        } as unknown as SnapshotPayloadV2['estimated_incomes'][number],
      ],
      estimated_budgets: [
        {
          id: randomUUID(),
          profile_id: testUserId,
          group_id: null,
          name: 'cas3 v2 budget',
          estimated_amount: 50,
        } as unknown as SnapshotPayloadV2['estimated_budgets'][number],
      ],
      real_income_entries: [],
      real_expenses: [],
      bank_balances: [], // empty → restoreTable early-return
      bank_balance: null, // v1 fallback skipped
      piggy_bank: [], // empty → restoreTable early-return
      remaining_to_live_snapshots: [],
      budget_transfers: [], // empty
      monthly_recaps: [],
      _table_counts: {},
    }
    const snapshotId = await insertSnapshot(v2)

    const response = await POST(
      buildRequest({ context: 'profile', snapshot_id: snapshotId, confirm: true }, testToken),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.success).toBe(true)

    const results = body.recovery_results as Record<string, unknown>
    // Both flags stay at init false (strict boolean — NOT 0 or null)
    expect(results.bank_balance).toStrictEqual(false)
    expect(results.piggy_bank).toStrictEqual(false)
    expect(results.budget_transfers).toBe(0)
    expect(results.real_incomes).toBe(0)
    expect(results.real_expenses).toBe(0)
    // Non-empty arrays still restore
    expect(results.estimated_incomes).toBe(1)
    expect(results.estimated_budgets).toBe(1)
  }, 60_000)

  // ------------------------------------------------------------------------
  // Validation — 400 on confirm=false (recoverRecapBodySchema literal(true))
  // ------------------------------------------------------------------------
  it('returns 400 on confirm=false (literal(true) refine)', async () => {
    const response = await POST(buildRequest({ context: 'profile', confirm: false }, testToken))
    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(typeof body.error).toBe('string')
  })

  // ------------------------------------------------------------------------
  // Auth — 401 without session cookie
  // ------------------------------------------------------------------------
  it('returns 401 without session cookie', async () => {
    const response = await POST(buildRequest({ context: 'profile', confirm: true }, undefined))
    expect(response.status).toBe(401)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.error).toBe('Session invalide')
  })
})
