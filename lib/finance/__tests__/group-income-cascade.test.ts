/**
 * Tests gated (SUPABASE_FINANCE_TESTS=1) pour le Sprint Group-Income-Cascade
 * (2026-05-28) — valide la cascade end-to-end DB :
 *
 *   estimated_incomes INSERT/UPDATE/DELETE (group_id)
 *   → trigger M3 sync_group_monthly_income_estimate
 *   → groups.monthly_income_estimate UPDATE
 *   → trigger M4 groups_income_contribution_recalc
 *   → calculate_group_contributions (M2 modifiée)
 *   → UPSERT group_contributions avec contribution_base = max(0, B − R)
 *
 * Stratégie : on crée un groupe 2 membres (salaires 3000/2000), des budgets
 * groupe et des revenus groupe via INSERT direct ; on snapshot
 * group_contributions après chaque mutation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Database } from '@/lib/database.types'

type FinCalcMod = typeof import('@/lib/finance')

const ENABLED = process.env.SUPABASE_FINANCE_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('group-income-cascade (Sprint 2026-05-28)', () => {
  let admin: SupabaseClient<Database>
  let getGroupFinancialData: FinCalcMod['getGroupFinancialData']

  const stamp = Date.now()
  const aliceEmail = `gic-alice-${stamp}@popoth.test`
  const bobEmail = `gic-bob-${stamp}@popoth.test`
  const password = `gic-${randomUUID()}`
  let aliceId: string
  let bobId: string
  let groupId: string
  let incomeGroupId: string | null = null

  // Helper : récupère la contribution courante d'un membre.
  async function getContribution(profileId: string): Promise<number> {
    const { data, error } = await admin
      .from('group_contributions')
      .select('contribution_amount')
      .eq('group_id', groupId)
      .eq('profile_id', profileId)
      .maybeSingle()
    if (error) throw error
    return data?.contribution_amount ?? 0
  }

  // Helper : lit le mirror monthly_income_estimate du groupe.
  async function getGroupIncomeMirror(): Promise<number> {
    const { data, error } = await admin
      .from('groups')
      .select('monthly_income_estimate')
      .eq('id', groupId)
      .single()
    if (error) throw error
    return data.monthly_income_estimate
  }

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'group-income-cascade tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const finMod = await import('@/lib/finance')
    getGroupFinancialData = finMod.getGroupFinancialData

    // 1. Create 2 users + profiles (Alice 3000, Bob 2000).
    const { data: aliceData, error: aliceErr } = await admin.auth.admin.createUser({
      email: aliceEmail,
      password,
      email_confirm: true,
    })
    if (aliceErr || !aliceData.user) throw aliceErr ?? new Error('alice createUser failed')
    aliceId = aliceData.user.id

    const { data: bobData, error: bobErr } = await admin.auth.admin.createUser({
      email: bobEmail,
      password,
      email_confirm: true,
    })
    if (bobErr || !bobData.user) throw bobErr ?? new Error('bob createUser failed')
    bobId = bobData.user.id

    const { error: profilesErr } = await admin.from('profiles').insert([
      { id: aliceId, first_name: 'Alice', last_name: 'Gic', salary: 3000 },
      { id: bobId, first_name: 'Bob', last_name: 'Gic', salary: 2000 },
    ])
    if (profilesErr) throw profilesErr

    // 2. Create group with Alice as creator (monthly_budget_estimate seed
    //    irrelevant — overridden by sync_group_monthly_budget_estimate).
    const { data: groupRow, error: groupErr } = await admin
      .from('groups')
      .insert({ name: `GIC Test ${stamp}`, creator_id: aliceId, monthly_budget_estimate: 0 })
      .select('id')
      .single()
    if (groupErr || !groupRow) throw groupErr ?? new Error('group insert failed')
    groupId = groupRow.id

    // 3. Link both profiles to the group (trigger recalculate_contributions fires).
    const { error: linkErr } = await admin
      .from('profiles')
      .update({ group_id: groupId })
      .in('id', [aliceId, bobId])
    if (linkErr) throw linkErr

    // 4. Seed group bank + piggy (avoid .single() PGRST116 on later reads).
    await admin.from('bank_balances').insert({ profile_id: null, group_id: groupId, balance: 0 })
    await admin.from('piggy_bank').insert({ profile_id: null, group_id: groupId, amount: 0 })

    // 5. Create a group budget of 1000 — triggers sync_group_monthly_budget_estimate
    //    and groups_budget_contribution_recalc → calculate_group_contributions.
    //    Expected contributions WITHOUT income mirror : 3000/5000 × 1000 = 600 / 2000/5000 × 1000 = 400.
    const { error: budgetErr } = await admin.from('estimated_budgets').insert({
      profile_id: null,
      group_id: groupId,
      name: 'Group budget 1000',
      estimated_amount: 1000,
    })
    if (budgetErr) throw budgetErr
  }, 60_000)

  afterAll(async () => {
    if (!groupId) return
    // Cleanup cascade order (FK dependencies) :
    await admin
      .from('real_income_entries')
      .delete()
      .or(`profile_id.in.(${aliceId},${bobId}),group_id.eq.${groupId}`)
    await admin
      .from('real_expenses')
      .delete()
      .or(`profile_id.in.(${aliceId},${bobId}),group_id.eq.${groupId}`)
    await admin
      .from('estimated_incomes')
      .delete()
      .or(`profile_id.in.(${aliceId},${bobId}),group_id.eq.${groupId}`)
    await admin
      .from('estimated_budgets')
      .delete()
      .or(`profile_id.in.(${aliceId},${bobId}),group_id.eq.${groupId}`)
    await admin.from('group_contributions').delete().eq('group_id', groupId)
    await admin
      .from('piggy_bank')
      .delete()
      .or(`profile_id.in.(${aliceId},${bobId}),group_id.eq.${groupId}`)
    await admin
      .from('bank_balances')
      .delete()
      .or(`profile_id.in.(${aliceId},${bobId}),group_id.eq.${groupId}`)
    // Detach profiles from group BEFORE deleting group (FK ON DELETE SET NULL).
    await admin.from('profiles').update({ group_id: null }).in('id', [aliceId, bobId])
    await admin.from('groups').delete().eq('id', groupId)
    await admin.from('profiles').delete().in('id', [aliceId, bobId])
    await admin.auth.admin.deleteUser(aliceId)
    await admin.auth.admin.deleteUser(bobId)
  }, 60_000)

  it('baseline — sans revenu groupe, contributions = prorata du budget complet', async () => {
    expect(await getGroupIncomeMirror()).toBe(0)
    expect(await getContribution(aliceId)).toBe(600)
    expect(await getContribution(bobId)).toBe(400)
  }, 30_000)

  it('M1 — ajout d’un revenu estimé groupe de 300 → contributions baissent (base 700)', async () => {
    const { data: income, error } = await admin
      .from('estimated_incomes')
      .insert({
        profile_id: null,
        group_id: groupId,
        name: 'Group allocation 300',
        estimated_amount: 300,
      })
      .select('id')
      .single()
    if (error || !income) throw error ?? new Error('group income insert failed')
    incomeGroupId = income.id

    // M3 trigger fires : groups.monthly_income_estimate ← 300
    expect(await getGroupIncomeMirror()).toBe(300)
    // M4 trigger fires → calculate_group_contributions(group_id) avec contribution_base = max(0, 1000-300) = 700.
    //   Alice : 3000/5000 × 700 = 420 ; Bob : 2000/5000 × 700 = 280.
    expect(await getContribution(aliceId)).toBe(420)
    expect(await getContribution(bobId)).toBe(280)
  }, 30_000)

  it('M2 — édition revenu 300 → 700 → contributions baissent encore (base 300)', async () => {
    if (!incomeGroupId) throw new Error('previous test did not set incomeGroupId')
    const { error } = await admin
      .from('estimated_incomes')
      .update({ estimated_amount: 700 })
      .eq('id', incomeGroupId)
    if (error) throw error

    expect(await getGroupIncomeMirror()).toBe(700)
    // contribution_base = max(0, 1000-700) = 300. Alice 3/5×300=180, Bob 2/5×300=120.
    expect(await getContribution(aliceId)).toBe(180)
    expect(await getContribution(bobId)).toBe(120)
  }, 30_000)

  it('M3 — surplus (revenu 1500 > budget 1000) → contributions = 0 + RAV groupe = 500', async () => {
    if (!incomeGroupId) throw new Error('previous test did not set incomeGroupId')
    const { error } = await admin
      .from('estimated_incomes')
      .update({ estimated_amount: 1500 })
      .eq('id', incomeGroupId)
    if (error) throw error

    expect(await getGroupIncomeMirror()).toBe(1500)
    // contribution_base = max(0, 1000-1500) = 0 → contributions = 0
    expect(await getContribution(aliceId)).toBe(0)
    expect(await getContribution(bobId)).toBe(0)

    // RAV groupe = incomeCompensation(1500 estimé sans real) + 0 contributions
    //            − 1000 budgets − 0 exceptional − 0 deficits = 500 (cagnotte).
    const data = await getGroupFinancialData(groupId)
    expect(data.remainingToLive).toBe(500)
  }, 30_000)

  it('M4 — real income > estimé groupe → RAV monte du delta positif (compensation)', async () => {
    if (!incomeGroupId) throw new Error('previous test did not set incomeGroupId')
    // Reset revenue estimé à 300 (sortir du surplus pour observer la compensation classique).
    await admin.from('estimated_incomes').update({ estimated_amount: 300 }).eq('id', incomeGroupId)

    // Insert real income groupe linké à l'estimé, montant 500 > 300.
    const todayIso = new Date().toISOString().split('T')[0]!
    const { error } = await admin.from('real_income_entries').insert({
      profile_id: null,
      group_id: groupId,
      amount: 500,
      description: 'group real income surplus',
      entry_date: todayIso,
      estimated_income_id: incomeGroupId,
      is_exceptional: false,
      created_by_profile_id: aliceId,
    })
    if (error) throw error

    // Contributions sont calculées sur l'estimé (300), pas sur le réel (500) → inchangées.
    expect(await getContribution(aliceId)).toBe(420)
    expect(await getContribution(bobId)).toBe(280)

    // RAV : incomeCompensation prend le real (500) au lieu de l'estimé (300).
    //   incomeContribution = 500 (compensation strictement real puisque > 0)
    //   totalGroupContributions = 700 (Alice 420 + Bob 280)
    //   estimatedBudgets = 1000
    //   RAV = 500 + 0 + 700 − 1000 − 0 − 0 = 200 (= 500−300 delta de la compensation)
    const data = await getGroupFinancialData(groupId)
    expect(data.remainingToLive).toBe(200)
  }, 30_000)

  it('M5 — suppression du revenu estimé → contributions remontent à la valeur initiale', async () => {
    if (!incomeGroupId) throw new Error('previous test did not set incomeGroupId')
    // D'abord nettoyer le real lié (FK ou simple cohérence).
    await admin.from('real_income_entries').delete().eq('estimated_income_id', incomeGroupId)

    // Puis supprimer l'estimé → M3 trigger → mirror retombe à 0 → M4 trigger →
    // contributions revertent à la valeur initiale (base 1000).
    const { error } = await admin.from('estimated_incomes').delete().eq('id', incomeGroupId)
    if (error) throw error
    incomeGroupId = null

    expect(await getGroupIncomeMirror()).toBe(0)
    expect(await getContribution(aliceId)).toBe(600)
    expect(await getContribution(bobId)).toBe(400)
  }, 30_000)
})
