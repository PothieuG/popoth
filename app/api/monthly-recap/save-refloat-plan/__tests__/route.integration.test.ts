/**
 * Integration tests — renflouement manuel (Sprint Recap-Manual-Refloat,
 * 2026-10-01). Gated by `SUPABASE_RECAP_TESTS=1`.
 *
 * Parcours bout en bout sur une vraie base (migration
 * `20261001000000_recap_manual_refloat_plan.sql` requise) :
 *   - POST /prepare-deficit : surplus → économies, idempotent ;
 *   - POST /save-refloat-plan : bornes + écriture du plan, rien de débité ;
 *   - POST /advance-step : refus tant que le déficit n'est pas couvert ;
 *   - RPC apply_recap_refloat_plan : débite tirelire + économies, une fois.
 *
 * Scénario (profil vierge, 0 revenu) :
 *   - budget A estimé 200, rien dépensé            → surplus 200
 *   - budget B estimé 300, dette reportée 300       → surplus 0, pas de déficit
 *   - bilan = ravEffectif = −(200 + 300) = −500 ; tirelire 100.
 */

import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/database.types'
import { getRecapPeriod } from '@/lib/recap/period'

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const mockedAuth = { userId: '' }

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndGroup: (handler: AnyHandler) => async (request: NextRequest, rc?: unknown) =>
      handler(request, { userId: mockedAuth.userId, groupId: null }, rc),
    withAuthAndProfile: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, {
        userId: mockedAuth.userId,
        profile: { id: mockedAuth.userId, group_id: null, first_name: 'Test', last_name: 'User' },
      }),
    withAuth: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, { userId: mockedAuth.userId }),
  }
})

type Post = (req: NextRequest) => Promise<Response>

describe.skipIf(!ENABLED)('renflouement manuel — prepare / save / advance (gated)', () => {
  let admin: SupabaseClient<Database>
  let prepare: Post
  let save: Post
  let advance: Post

  let userId: string
  let budgetA: string
  let budgetB: string

  const { month: recapMonth, year: recapYear } = getRecapPeriod()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Recap manual refloat tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    prepare = (await import('@/app/api/monthly-recap/prepare-deficit/route')).POST as Post
    save = (await import('@/app/api/monthly-recap/save-refloat-plan/route')).POST as Post
    advance = (await import('@/app/api/monthly-recap/advance-step/route')).POST as Post

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await admin.auth.admin.createUser({
      email: `recap-manual-${Date.now()}@popoth.test`,
      password: randomUUID(),
      email_confirm: true,
    })
    if (error || !data.user) throw error
    userId = data.user.id
    mockedAuth.userId = userId

    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: userId, first_name: 'Rita', last_name: 'Renfloue' }, { onConflict: 'id' })
    if (profileError) throw profileError
  })

  afterEach(async () => {
    await resetState()
  })

  afterAll(async () => {
    if (admin && userId) {
      await resetState()
      await admin.auth.admin.deleteUser(userId)
    }
  })

  async function resetState() {
    await admin.from('monthly_recaps').delete().eq('profile_id', userId)
    await admin.from('estimated_budgets').delete().eq('profile_id', userId)
    await admin.from('piggy_bank').delete().eq('profile_id', userId)
  }

  function request(path: string, body: unknown): NextRequest {
    return new Request(`http://localhost/api/monthly-recap/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  }

  async function seedScenario(): Promise<string> {
    const { data: budgets, error: budgetsError } = await admin
      .from('estimated_budgets')
      .insert([
        {
          profile_id: userId,
          name: 'A',
          estimated_amount: 200,
          cumulated_savings: 0,
          carryover_spent_amount: 0,
          is_monthly_recurring: false,
        },
        {
          profile_id: userId,
          name: 'B',
          estimated_amount: 300,
          cumulated_savings: 0,
          carryover_spent_amount: 300,
          is_monthly_recurring: false,
        },
      ])
      .select('id, name')
    if (budgetsError || !budgets) throw budgetsError ?? new Error('budgets insert failed')
    budgetA = budgets.find((b) => b.name === 'A')!.id
    budgetB = budgets.find((b) => b.name === 'B')!.id

    const { error: piggyError } = await admin
      .from('piggy_bank')
      .insert({ profile_id: userId, amount: 100 })
    if (piggyError) throw piggyError

    const { data: recap, error: recapError } = await admin
      .from('monthly_recaps')
      .insert({
        profile_id: userId,
        recap_month: recapMonth,
        recap_year: recapYear,
        current_step: 'manage_bilan',
        started_by_profile_id: userId,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (recapError || !recap) throw recapError ?? new Error('recap insert failed')
    return recap.id
  }

  async function savingsOf(budgetId: string): Promise<number> {
    const { data } = await admin
      .from('estimated_budgets')
      .select('cumulated_savings')
      .eq('id', budgetId)
      .single()
    return Number(data?.cumulated_savings ?? 0)
  }

  async function piggyAmount(): Promise<number> {
    const { data } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', userId)
      .maybeSingle()
    return Number(data?.amount ?? 0)
  }

  it('prepare-deficit verse le surplus dans les économies, une seule fois', async () => {
    await seedScenario()

    const first = await prepare(request('prepare-deficit', { context: 'profile' }))
    expect(first.status).toBe(200)
    const body = (await first.json()) as {
      data: { surplusSavingsData: Record<string, number>; alreadyDone: boolean }
    }
    expect(body.data.surplusSavingsData).toEqual({ [budgetA]: 200 })
    expect(body.data.alreadyDone).toBe(false)
    expect(await savingsOf(budgetA)).toBe(200)

    const second = await prepare(request('prepare-deficit', { context: 'profile' }))
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { data: { alreadyDone: boolean } }
    expect(secondBody.data.alreadyDone).toBe(true)
    expect(await savingsOf(budgetA)).toBe(200)
  })

  it('deux préparations simultanées ne créditent qu’une fois', async () => {
    await seedScenario()

    const [r1, r2] = await Promise.all([
      prepare(request('prepare-deficit', { context: 'profile' })),
      prepare(request('prepare-deficit', { context: 'profile' })),
    ])
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(await savingsOf(budgetA)).toBe(200)
  })

  it('save-refloat-plan refuse tant que la préparation n’est pas faite', async () => {
    await seedScenario()

    const response = await save(
      request('save-refloat-plan', { context: 'profile', source: 'piggy', amount: 10 }),
    )
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toBe('not_prepared')
  })

  it('parcours complet : plan enregistré sans débit, Continuer bloqué puis autorisé, application au finalize', async () => {
    const recapId = await seedScenario()
    await prepare(request('prepare-deficit', { context: 'profile' }))

    // Tirelire : 100 → reste 400
    const piggy = await save(
      request('save-refloat-plan', { context: 'profile', source: 'piggy', amount: 100 }),
    )
    expect(piggy.status).toBe(200)

    // Budgets : A 250 (= 200 d'économies + 50 de budget) → reste 150
    const budgets = await save(
      request('save-refloat-plan', {
        context: 'profile',
        source: 'budgets',
        allocations: { [budgetA]: 250 },
      }),
    )
    expect(budgets.status).toBe(200)
    const budgetsBody = (await budgets.json()) as {
      data: { deficitRemaining: number; plan: { savings: Record<string, number> } }
    }
    expect(budgetsBody.data.deficitRemaining).toBe(150)
    expect(budgetsBody.data.plan.savings).toEqual({ [budgetA]: 200 })

    // Rien n'a été débité à ce stade
    expect(await piggyAmount()).toBe(100)
    expect(await savingsOf(budgetA)).toBe(200)

    // Continuer refusé : il reste 150 et B peut encore donner 300
    const blocked = await advance(
      request('advance-step', {
        context: 'profile',
        fromStep: 'manage_bilan',
        toStep: 'salary_update',
      }),
    )
    expect(blocked.status).toBe(409)
    expect(((await blocked.json()) as { error: string }).error).toBe('deficit_not_covered')

    // Au-delà de la limite d'un budget → 400
    const tooMuch = await save(
      request('save-refloat-plan', {
        context: 'profile',
        source: 'budgets',
        allocations: { [budgetA]: 250, [budgetB]: 301 },
      }),
    )
    expect(tooMuch.status).toBe(400)
    expect(((await tooMuch.json()) as { error: string }).error).toBe('budget_capacity_exceeded')

    // Plus que le reste → 400 overflow
    const overflow = await save(
      request('save-refloat-plan', {
        context: 'profile',
        source: 'budgets',
        allocations: { [budgetA]: 250, [budgetB]: 200 },
      }),
    )
    expect(overflow.status).toBe(400)
    expect(((await overflow.json()) as { error: string }).error).toBe('overflow')

    // B 150 → déficit couvert
    const covered = await save(
      request('save-refloat-plan', {
        context: 'profile',
        source: 'budgets',
        allocations: { [budgetA]: 250, [budgetB]: 150 },
      }),
    )
    expect(covered.status).toBe(200)
    expect(
      ((await covered.json()) as { data: { deficitRemaining: number } }).data.deficitRemaining,
    ).toBe(0)

    const { data: row } = await admin
      .from('monthly_recaps')
      .select('planned_piggy_refloat, planned_savings_refloat, budget_snapshot_data')
      .eq('id', recapId)
      .single()
    expect(Number(row?.planned_piggy_refloat)).toBe(100)
    expect(row?.planned_savings_refloat).toEqual({ [budgetA]: 200 })
    expect(row?.budget_snapshot_data).toEqual({ [budgetA]: 50, [budgetB]: 150 })

    const allowed = await advance(
      request('advance-step', {
        context: 'profile',
        fromStep: 'manage_bilan',
        toStep: 'salary_update',
      }),
    )
    expect(allowed.status).toBe(200)

    // Application (1re étape du finalize) : tirelire −100, économies A −200, une seule fois
    const { error: applyError } = await admin.rpc('apply_recap_refloat_plan', {
      p_recap_id: recapId,
    })
    expect(applyError).toBeNull()
    expect(await piggyAmount()).toBe(0)
    expect(await savingsOf(budgetA)).toBe(0)

    const { data: again } = await admin.rpc('apply_recap_refloat_plan', { p_recap_id: recapId })
    expect((again as { already_applied: boolean }).already_applied).toBe(true)
    expect(await piggyAmount()).toBe(0)
  })
})
