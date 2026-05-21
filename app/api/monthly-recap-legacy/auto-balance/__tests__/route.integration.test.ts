import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import type { Database } from '@/lib/database.types'

// Dynamic-import pattern (mirror app/api/monthly-recap/{process-step1,complete}/__tests__/
// route.integration.test.ts): route.ts pulls in lib/supabase-server which
// crashes at module-load when the env vars are missing, even if the describe
// block is later skipped.
type RouteMod = typeof import('@/app/api/monthly-recap-legacy/auto-balance/route')
type SessionMod = typeof import('@/lib/session')

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Characterization tests on POST /api/monthly-recap/auto-balance.
 *
 * These tests lock the route's response shape and DB side effects BEFORE
 * the Sprint Refactor-Auto-Balance split into lib/recap/{auto-balance-algorithm,
 * auto-balance-persist}.ts. They must keep passing byte-identical after the
 * route is rewired in Commit 7.
 *
 * Pattern mirror app/api/monthly-recap/complete/__tests__/route.integration.test.ts
 * (dynamic-import-in-beforeAll, FK-safe cleanup cascade). Each test seeds
 * the fixture rows it needs because the route mutates piggy_bank,
 * estimated_budgets.cumulated_savings, and inserts into budget_transfers —
 * sharing across tests is too pollution-prone.
 *
 * Atomicity invariants (Sprint Auto-Balance-Atomic 2026-05-15 +
 * Sprint Auto-Balance-Atomic-Phase-B 2026-05-15):
 *   - savings transfers via transferWithSavingsDebit composite RPC
 *     (INSERT budget_transfers + debit cumulated_savings in one tx)
 *   - piggy transfers via transferPiggyToBudgetWithInsert composite RPC
 *     (debit piggy_bank + INSERT budget_transfers (from=NULL) in one tx)
 *   - surplus transfers via single batched INSERT into budget_transfers
 *     (no debit — surplus is computed, not stored as a column)
 *   - per-pair fail-soft via logger.warn + continue (not hard-500)
 */
describe.skipIf(!ENABLED)('POST /api/monthly-recap/auto-balance — characterization', () => {
  let admin: SupabaseClient<Database>
  let POST: RouteMod['POST']
  let createSessionToken: SessionMod['createSessionToken']

  const stamp = Date.now()
  const testEmail = `recap-autobalance-${stamp}@popoth.test`
  let testUserId: string
  let testToken: string

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'auto-balance characterization tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const routeMod = await import('@/app/api/monthly-recap-legacy/auto-balance/route')
    POST = routeMod.POST

    const sessionMod = await import('@/lib/session')
    createSessionToken = sessionMod.createSessionToken

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: `auto-balance-${randomUUID()}`,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'AutoBalance',
      last_name: 'Fixture',
    })
    if (profErr) throw profErr

    testToken = await createSessionToken(testUserId, testEmail)
  }, 60_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    // FK-safe cleanup: budget_transfers + real_expenses reference
    // estimated_budgets, so they clear first. piggy_bank has no
    // ON DELETE CASCADE on profile_id FK — explicit delete required
    // before auth.admin.deleteUser.
    await admin.from('budget_transfers').delete().eq('profile_id', testUserId)
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
    await admin.from('profiles').delete().eq('id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 60_000)

  // Reset rows the route mutates. User + profile + JWT survive so each
  // test starts from a clean financial state without paying the user
  // creation cost.
  async function resetUserFinancialState(): Promise<void> {
    await admin.from('budget_transfers').delete().eq('profile_id', testUserId)
    await admin.from('real_expenses').delete().eq('profile_id', testUserId)
    await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
    await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
  }

  function buildRequest(body: unknown, token?: string): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token !== undefined) headers.cookie = `session=${token}`
    return new Request('http://localhost/api/monthly-recap/auto-balance', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  }

  // ------------------------------------------------------------------------
  // CAS 1 — PHASE 0 only: piggy distribution
  //
  // Seed: piggy=200, 2 deficit budgets (each estimated=100, spent=200 → deficit=100),
  // no savings, no surplus.
  //
  // Expected algorithm path:
  //   PHASE 0: totalDeficit=200, amountToDistribute=min(200,200)=200
  //     - Each budget proportion=100/200=0.5 → contribution=100
  //   PHASE 1: skipped (totalSavings=0)
  //   PHASE 2: skipped (totalSurplus=0 — both deficit budgets have spent>estimated)
  //
  // Expected DB:
  //   - 2 transfers in response, source='piggy_bank', from_budget_id=null, amount=100 each
  //   - piggy_bank.amount = 0 (debited via transferPiggyToBudgetWithInsert)
  //   - 2 rows in budget_transfers (from_budget_id=null)
  // ------------------------------------------------------------------------
  it('CAS 1 piggy distribution: 2 transfers from piggy_bank, piggy debited to 0', async () => {
    await resetUserFinancialState()

    await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 200,
    })

    const { data: budgets } = await admin
      .from('estimated_budgets')
      .insert([
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas1 deficit A',
          estimated_amount: 100,
          cumulated_savings: 0,
        },
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas1 deficit B',
          estimated_amount: 100,
          cumulated_savings: 0,
        },
      ])
      .select('id, name')
    expect(budgets).toHaveLength(2)
    const aId = budgets!.find((b) => b.name === 'cas1 deficit A')!.id
    const bId = budgets!.find((b) => b.name === 'cas1 deficit B')!.id

    const todayIso = new Date().toISOString().split('T')[0]!
    await admin.from('real_expenses').insert([
      {
        profile_id: testUserId,
        group_id: null,
        amount: 200,
        amount_from_budget: 200,
        description: 'cas1 overspend A',
        expense_date: todayIso,
        estimated_budget_id: aId,
        is_exceptional: false,
      },
      {
        profile_id: testUserId,
        group_id: null,
        amount: 200,
        amount_from_budget: 200,
        description: 'cas1 overspend B',
        expense_date: todayIso,
        estimated_budget_id: bId,
        is_exceptional: false,
      },
    ])

    const response = await POST(buildRequest({ context: 'profile' }, testToken))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    // Top-level response shape
    expect(body.success).toBe(true)
    expect(typeof body.message).toBe('string')
    expect(body.piggy_bank_used).toBe(200)
    expect(body.savings_used).toBe(0)
    expect(body.surplus_used).toBe(0)
    expect(body.total_transferred).toBe(200)
    expect(body.transfers_count).toBe(2)
    expect(body.remaining_piggy_bank).toBe(0)
    expect(body.remaining_deficit).toBe(0)

    const transfers = body.transfers as Array<Record<string, unknown>>
    expect(transfers).toHaveLength(2)
    for (const t of transfers) {
      expect(t.source).toBe('piggy_bank')
      expect(t.from_budget_id).toBe(null)
      expect(t.from_budget_name).toBe('Tirelire 🐷')
      expect(Number(t.amount)).toBe(100)
    }

    // DB side effects: piggy debited atomically via composite RPC
    const { data: piggyAfter } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', testUserId)
      .single()
    expect(Number(piggyAfter?.amount)).toBe(0)

    const { data: transfersDb } = await admin
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount')
      .eq('profile_id', testUserId)
    expect(transfersDb ?? []).toHaveLength(2)
    for (const row of transfersDb!) {
      expect(row.from_budget_id).toBe(null)
      expect([aId, bId]).toContain(row.to_budget_id)
      expect(Number(row.transfer_amount)).toBe(100)
    }
  }, 60_000)

  // ------------------------------------------------------------------------
  // CAS 2 — PHASE 1 only: savings transfer
  //
  // Seed: piggy=0, 1 savings budget A (estimated=100, spent=100 → surplus=0,
  // cumulated_savings=150), 1 deficit budget B (estimated=100, spent=250 →
  // deficit=150).
  //
  // Expected algorithm path:
  //   PHASE 0: skipped (piggy=0)
  //   PHASE 1: totalSavings=150, remainingDeficit=150
  //     - For B (proportion=150/150=1): amountNeededForThisDeficit=min(150, 150*1)=150
  //       - A→B: 150/150 * 150 = 150 (atomic via transferWithSavingsDebit)
  //   PHASE 2: skipped (totalSurplus=0 — A and B both spent=estimated/overspent)
  //
  // Expected DB:
  //   - 1 transfer in response, source='savings', A→B amount=150
  //   - A.cumulated_savings = 0 (debited atomically via composite RPC)
  //   - 1 row in budget_transfers
  // ------------------------------------------------------------------------
  it('CAS 2 savings transfer: 1 transferWithSavingsDebit, cumulated_savings debited atomically', async () => {
    await resetUserFinancialState()

    await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 0,
    })

    const { data: budgets } = await admin
      .from('estimated_budgets')
      .insert([
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas2 savings A',
          estimated_amount: 100,
          cumulated_savings: 150,
        },
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas2 deficit B',
          estimated_amount: 100,
          cumulated_savings: 0,
        },
      ])
      .select('id, name')
    expect(budgets).toHaveLength(2)
    const aId = budgets!.find((b) => b.name === 'cas2 savings A')!.id
    const bId = budgets!.find((b) => b.name === 'cas2 deficit B')!.id

    const todayIso = new Date().toISOString().split('T')[0]!
    await admin.from('real_expenses').insert([
      {
        profile_id: testUserId,
        group_id: null,
        amount: 100,
        amount_from_budget: 100,
        description: 'cas2 A in-budget',
        expense_date: todayIso,
        estimated_budget_id: aId,
        is_exceptional: false,
      },
      {
        profile_id: testUserId,
        group_id: null,
        amount: 250,
        amount_from_budget: 250,
        description: 'cas2 B overspend',
        expense_date: todayIso,
        estimated_budget_id: bId,
        is_exceptional: false,
      },
    ])

    const response = await POST(buildRequest({ context: 'profile' }, testToken))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    expect(body.success).toBe(true)
    expect(body.piggy_bank_used).toBe(0)
    expect(body.savings_used).toBe(150)
    expect(body.surplus_used).toBe(0)
    expect(body.total_transferred).toBe(150)
    expect(body.transfers_count).toBe(1)

    const transfers = body.transfers as Array<Record<string, unknown>>
    expect(transfers).toHaveLength(1)
    expect(transfers[0]!.source).toBe('savings')
    expect(transfers[0]!.from_budget_id).toBe(aId)
    expect(transfers[0]!.to_budget_id).toBe(bId)
    expect(Number(transfers[0]!.amount)).toBe(150)

    // DB side effects: A.cumulated_savings debited atomically via composite RPC
    const { data: aAfter } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', aId)
      .single()
    expect(Number(aAfter?.cumulated_savings)).toBe(0)

    const { data: transfersDb } = await admin
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount')
      .eq('profile_id', testUserId)
    expect(transfersDb ?? []).toHaveLength(1)
    expect(transfersDb![0]!.from_budget_id).toBe(aId)
    expect(transfersDb![0]!.to_budget_id).toBe(bId)
    expect(Number(transfersDb![0]!.transfer_amount)).toBe(150)
  }, 60_000)

  // ------------------------------------------------------------------------
  // CAS 3 — PHASE 2 only: surplus distribution
  //
  // Seed: piggy=0, no savings, 2 surplus budgets (A: estimated=200 spent=50 →
  // surplus=150 | B: estimated=100 spent=50 → surplus=50), 1 deficit budget
  // (C: estimated=100, spent=200 → deficit=100).
  //
  // Expected algorithm path:
  //   PHASE 0: skipped (piggy=0)
  //   PHASE 1: skipped (totalSavings=0)
  //   PHASE 2: totalSurplus=200, remainingDeficit=100
  //     - remaining_deficits per-budget: C = max(0, 100 - 0 - 0) = 100
  //     - For C (proportion=100/100=1): amountNeededForThisDeficit=min(100, 200*1)=100
  //       - A→C: 150/200 * 100 = 75
  //       - B→C: 50/200 * 100 = 25
  //
  // Expected DB:
  //   - 2 transfers in response, source='surplus', total=100
  //   - NO debit on cumulated_savings (surplus is computed, not stored)
  //   - 2 rows in budget_transfers (batched INSERT)
  // ------------------------------------------------------------------------
  it('CAS 3 surplus distribution: 2 batched INSERT transfers, no debit on cumulated_savings', async () => {
    await resetUserFinancialState()

    await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 0,
    })

    const { data: budgets } = await admin
      .from('estimated_budgets')
      .insert([
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas3 surplus A',
          estimated_amount: 200,
          cumulated_savings: 0,
        },
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas3 surplus B',
          estimated_amount: 100,
          cumulated_savings: 0,
        },
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas3 deficit C',
          estimated_amount: 100,
          cumulated_savings: 0,
        },
      ])
      .select('id, name')
    expect(budgets).toHaveLength(3)
    const aId = budgets!.find((b) => b.name === 'cas3 surplus A')!.id
    const bId = budgets!.find((b) => b.name === 'cas3 surplus B')!.id
    const cId = budgets!.find((b) => b.name === 'cas3 deficit C')!.id

    const todayIso = new Date().toISOString().split('T')[0]!
    await admin.from('real_expenses').insert([
      {
        profile_id: testUserId,
        group_id: null,
        amount: 50,
        amount_from_budget: 50,
        description: 'cas3 A underspend',
        expense_date: todayIso,
        estimated_budget_id: aId,
        is_exceptional: false,
      },
      {
        profile_id: testUserId,
        group_id: null,
        amount: 50,
        amount_from_budget: 50,
        description: 'cas3 B underspend',
        expense_date: todayIso,
        estimated_budget_id: bId,
        is_exceptional: false,
      },
      {
        profile_id: testUserId,
        group_id: null,
        amount: 200,
        amount_from_budget: 200,
        description: 'cas3 C overspend',
        expense_date: todayIso,
        estimated_budget_id: cId,
        is_exceptional: false,
      },
    ])

    const response = await POST(buildRequest({ context: 'profile' }, testToken))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    expect(body.success).toBe(true)
    expect(body.piggy_bank_used).toBe(0)
    expect(body.savings_used).toBe(0)
    expect(body.surplus_used).toBe(100)
    expect(body.total_transferred).toBe(100)
    expect(body.transfers_count).toBe(2)

    const transfers = body.transfers as Array<Record<string, unknown>>
    expect(transfers).toHaveLength(2)
    for (const t of transfers) {
      expect(t.source).toBe('surplus')
      expect(t.to_budget_id).toBe(cId)
      expect([aId, bId]).toContain(t.from_budget_id)
    }
    // Math: A→C = 150/200 * 100 = 75; B→C = 50/200 * 100 = 25
    const amounts = transfers.map((t) => Number(t.amount)).sort((x, y) => x - y)
    expect(amounts).toEqual([25, 75])

    // DB side effects: NO debit on cumulated_savings (surplus is computed)
    const { data: budgetsAfter } = await admin
      .from('estimated_budgets')
      .select('id, cumulated_savings')
      .eq('profile_id', testUserId)
    for (const b of budgetsAfter!) {
      expect(Number(b.cumulated_savings)).toBe(0)
    }

    // budget_transfers: 2 rows from A/B → C
    const { data: transfersDb } = await admin
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount')
      .eq('profile_id', testUserId)
    expect(transfersDb ?? []).toHaveLength(2)
    for (const row of transfersDb!) {
      expect(row.to_budget_id).toBe(cId)
      expect([aId, bId]).toContain(row.from_budget_id)
    }
  }, 60_000)

  // ------------------------------------------------------------------------
  // CAS 4 — Mixed all 3 phases
  //
  // Seed: piggy=50, 1 savings budget A (estimated=100, spent=100, savings=100),
  // 1 surplus budget B (estimated=200, spent=50, surplus=150), 1 deficit budget
  // C (estimated=100, spent=400, deficit=300).
  //
  // Expected algorithm path:
  //   PHASE 0 piggy: totalDeficit=300, amountToDistribute=min(50,300)=50
  //     - C (proportion=300/300=1): contribution=50 (1 transfer NULL→C source=piggy_bank)
  //     - remainingDeficitToCover = 250
  //   PHASE 1 savings: totalSavings=100, remainingDeficit=250
  //     - remaining_deficit for C = 300 - 50 = 250
  //     - For C (proportion=250/250=1): amountNeededForThisDeficit=min(250, 100*1)=100
  //       - A→C: 100/100 * 100 = 100 (atomic via transferWithSavingsDebit)
  //   PHASE 2 surplus: totalSurplus=150, remainingDeficit (line 314) > 0
  //     - remaining_deficit for C = max(0, 300 - 50 - 100) = 150
  //     - For C (proportion=150/150=1): amountNeededForThisDeficit=min(150, 150*1)=150
  //       - B→C: 150/150 * 150 = 150 (batched INSERT)
  //
  // Expected: total_transferred=300, all deficit covered.
  // ------------------------------------------------------------------------
  it('CAS 4 mixed all 3 phases: 1 piggy + 1 savings + 1 surplus transfer', async () => {
    await resetUserFinancialState()

    await admin.from('piggy_bank').insert({
      profile_id: testUserId,
      group_id: null,
      amount: 50,
    })

    const { data: budgets } = await admin
      .from('estimated_budgets')
      .insert([
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas4 savings A',
          estimated_amount: 100,
          cumulated_savings: 100,
        },
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas4 surplus B',
          estimated_amount: 200,
          cumulated_savings: 0,
        },
        {
          profile_id: testUserId,
          group_id: null,
          name: 'cas4 deficit C',
          estimated_amount: 100,
          cumulated_savings: 0,
        },
      ])
      .select('id, name')
    expect(budgets).toHaveLength(3)
    const aId = budgets!.find((b) => b.name === 'cas4 savings A')!.id
    const bId = budgets!.find((b) => b.name === 'cas4 surplus B')!.id
    const cId = budgets!.find((b) => b.name === 'cas4 deficit C')!.id

    const todayIso = new Date().toISOString().split('T')[0]!
    await admin.from('real_expenses').insert([
      {
        profile_id: testUserId,
        group_id: null,
        amount: 100,
        amount_from_budget: 100,
        description: 'cas4 A in-budget',
        expense_date: todayIso,
        estimated_budget_id: aId,
        is_exceptional: false,
      },
      {
        profile_id: testUserId,
        group_id: null,
        amount: 50,
        amount_from_budget: 50,
        description: 'cas4 B underspend',
        expense_date: todayIso,
        estimated_budget_id: bId,
        is_exceptional: false,
      },
      {
        profile_id: testUserId,
        group_id: null,
        amount: 400,
        amount_from_budget: 400,
        description: 'cas4 C overspend',
        expense_date: todayIso,
        estimated_budget_id: cId,
        is_exceptional: false,
      },
    ])

    const response = await POST(buildRequest({ context: 'profile' }, testToken))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    expect(body.success).toBe(true)
    expect(body.piggy_bank_used).toBe(50)
    expect(body.savings_used).toBe(100)
    expect(body.surplus_used).toBe(150)
    expect(body.total_transferred).toBe(300)
    expect(body.transfers_count).toBe(3)
    expect(body.remaining_piggy_bank).toBe(0)
    expect(body.remaining_savings).toBe(0)
    expect(body.remaining_surplus).toBe(0)
    expect(body.remaining_deficit).toBe(0)

    const transfers = body.transfers as Array<Record<string, unknown>>
    expect(transfers).toHaveLength(3)
    const piggyTransfer = transfers.find((t) => t.source === 'piggy_bank')!
    const savingsTransfer = transfers.find((t) => t.source === 'savings')!
    const surplusTransfer = transfers.find((t) => t.source === 'surplus')!
    expect(piggyTransfer.from_budget_id).toBe(null)
    expect(piggyTransfer.to_budget_id).toBe(cId)
    expect(Number(piggyTransfer.amount)).toBe(50)
    expect(savingsTransfer.from_budget_id).toBe(aId)
    expect(savingsTransfer.to_budget_id).toBe(cId)
    expect(Number(savingsTransfer.amount)).toBe(100)
    expect(surplusTransfer.from_budget_id).toBe(bId)
    expect(surplusTransfer.to_budget_id).toBe(cId)
    expect(Number(surplusTransfer.amount)).toBe(150)

    // DB side effects: piggy debited, A.savings debited, B.savings unchanged
    const { data: piggyAfter } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', testUserId)
      .single()
    expect(Number(piggyAfter?.amount)).toBe(0)

    const { data: aAfter } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', aId)
      .single()
    expect(Number(aAfter?.cumulated_savings)).toBe(0)

    const { data: bAfter } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', bId)
      .single()
    // B is surplus, no debit on cumulated_savings (surplus is computed)
    expect(Number(bAfter?.cumulated_savings)).toBe(0)

    const { data: transfersDb } = await admin
      .from('budget_transfers')
      .select('from_budget_id, to_budget_id, transfer_amount')
      .eq('profile_id', testUserId)
    expect(transfersDb ?? []).toHaveLength(3)
  }, 60_000)

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
