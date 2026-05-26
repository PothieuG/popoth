import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

/**
 * Sprint Projets-Épargne 03 — gated DB tests : projets dans la formule RAV.
 *
 * Vérifie que `_loadFinancialData` :
 *   1. SELECT `savings_projects` après les budgets (étape 3.bis)
 *   2. Agrège `sum(monthly_allocation)` dans `totalEstimatedBudgets`
 *   3. Expose `meta.totalMonthlyProjects` et `meta.savingsProjects[]`
 *   4. Diminue le RAV de `sum(monthly_allocation)` versus un orchestrateur
 *      sans projets (delta strictement = total projects)
 *
 * Pattern miroir financial-data.test.ts (dynamic import dans beforeAll pour
 * skip clean sans env vars, fixture FK-safe afterAll).
 */

type FinCalcMod = typeof import('@/lib/finance')

const ENABLED = process.env.SUPABASE_FINANCE_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('financial-data + savings_projects (Sprint Projets-Épargne 03)', () => {
  let admin: SupabaseClient<Database>
  let getProfileFinancialData: FinCalcMod['getProfileFinancialData']
  let getGroupFinancialData: FinCalcMod['getGroupFinancialData']

  const stamp = Date.now()
  const profileEmail = `proj-rav-profile-${stamp}@popoth.test`
  const profilePassword = `proj-${randomUUID()}`
  const groupCreatorEmail = `proj-rav-group-${stamp}@popoth.test`
  const groupCreatorPassword = `proj-${randomUUID()}`
  let profileUserId: string
  let groupCreatorUserId: string
  let testGroupId: string

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'financial-data-with-projects tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const finCalcMod = await import('@/lib/finance')
    getProfileFinancialData = finCalcMod.getProfileFinancialData
    getGroupFinancialData = finCalcMod.getGroupFinancialData

    // Profile user — pas de groupe, pas de salaire, pas de budgets : RAV
    // partira de 0 et reflètera EXACTEMENT le poids des projets.
    const { data: profUser, error: profUserErr } = await admin.auth.admin.createUser({
      email: profileEmail,
      password: profilePassword,
      email_confirm: true,
    })
    if (profUserErr || !profUser.user) throw profUserErr ?? new Error('profile createUser failed')
    profileUserId = profUser.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: profileUserId,
      first_name: 'ProjRav',
      last_name: 'Profile',
    })
    if (profErr) throw profErr

    // Group creator — créé en parallèle pour cas 2 (group RAV).
    const { data: gcUser, error: gcUserErr } = await admin.auth.admin.createUser({
      email: groupCreatorEmail,
      password: groupCreatorPassword,
      email_confirm: true,
    })
    if (gcUserErr || !gcUser.user) throw gcUserErr ?? new Error('group creator createUser failed')
    groupCreatorUserId = gcUser.user.id

    const { error: gcProfErr } = await admin.from('profiles').insert({
      id: groupCreatorUserId,
      first_name: 'ProjRav',
      last_name: 'GroupCreator',
      salary: 2000,
    })
    if (gcProfErr) throw gcProfErr

    const { data: groupRow, error: groupErr } = await admin
      .from('groups')
      .insert({
        name: `ProjRav Group ${stamp}`,
        creator_id: groupCreatorUserId,
        monthly_budget_estimate: 0,
      })
      .select('id')
      .single()
    if (groupErr || !groupRow) throw groupErr ?? new Error('group insert returned no id')
    testGroupId = groupRow.id

    // Link creator to group → trigger calculate_group_contributions builds
    // one group_contributions row sized by salary proportion.
    const { error: linkErr } = await admin
      .from('profiles')
      .update({ group_id: testGroupId })
      .eq('id', groupCreatorUserId)
    if (linkErr) throw linkErr
  }, 60_000)

  afterAll(async () => {
    if (!admin) return
    if (testGroupId) {
      await admin.from('savings_projects').delete().eq('group_id', testGroupId)
      await admin.from('group_contributions').delete().eq('group_id', testGroupId)
      await admin.from('profiles').update({ group_id: null }).eq('id', groupCreatorUserId)
      await admin.from('groups').delete().eq('id', testGroupId)
    }
    if (profileUserId) {
      await admin.from('savings_projects').delete().eq('profile_id', profileUserId)
      await admin.auth.admin.deleteUser(profileUserId)
    }
    if (groupCreatorUserId) {
      await admin.from('savings_projects').delete().eq('profile_id', groupCreatorUserId)
      await admin.auth.admin.deleteUser(groupCreatorUserId)
    }
  }, 60_000)

  // ============================================================================
  // Case 1 — profile with 2 projects of 100€/month each → totalEstimatedBudgets
  // includes 200, RAV drops by 200, meta exposes both rows.
  // ============================================================================
  it('case 1 — profile + 2 projects (100€/month each) : totalEstimatedBudgets += 200, RAV -= 200', async () => {
    const baseline = await getProfileFinancialData(profileUserId)
    expect(baseline.meta?.totalMonthlyProjects).toBe(0)
    expect(baseline.meta?.savingsProjects).toEqual([])
    const baselineBudgets = baseline.totalEstimatedBudgets
    const baselineRav = baseline.remainingToLive

    const { data: p1Row, error: p1Err } = await admin
      .from('savings_projects')
      .insert({
        profile_id: profileUserId,
        group_id: null,
        name: 'Project A',
        target_amount: 1200,
        monthly_allocation: 100,
        deadline_date: '2027-05-01',
      })
      .select('id')
      .single()
    if (p1Err || !p1Row) throw p1Err ?? new Error('project A insert returned no id')

    const { data: p2Row, error: p2Err } = await admin
      .from('savings_projects')
      .insert({
        profile_id: profileUserId,
        group_id: null,
        name: 'Project B',
        target_amount: 2400,
        monthly_allocation: 100,
        deadline_date: '2028-05-01',
      })
      .select('id')
      .single()
    if (p2Err || !p2Row) throw p2Err ?? new Error('project B insert returned no id')

    const withProjects = await getProfileFinancialData(profileUserId)
    expect(withProjects.totalEstimatedBudgets).toBe(baselineBudgets + 200)
    expect(withProjects.remainingToLive).toBe(baselineRav - 200)
    expect(withProjects.meta?.totalMonthlyProjects).toBe(200)
    expect(withProjects.meta?.savingsProjects).toHaveLength(2)
    const names = withProjects.meta?.savingsProjects?.map((p) => p.name).sort() ?? []
    expect(names).toEqual(['Project A', 'Project B'])
    const allocations = withProjects.meta?.savingsProjects?.map((p) => p.monthlyAllocation) ?? []
    expect(allocations.every((v) => v === 100)).toBe(true)

    // Cleanup so case 3 starts clean
    await admin.from('savings_projects').delete().eq('id', p1Row.id)
    await admin.from('savings_projects').delete().eq('id', p2Row.id)
  }, 60_000)

  // ============================================================================
  // Case 2 — group with 1 project 50€ → group RAV drops by 50.
  // ============================================================================
  it('case 2 — group + 1 project 50€/month : totalEstimatedBudgets += 50, group RAV -= 50', async () => {
    const baseline = await getGroupFinancialData(testGroupId)
    expect(baseline.meta?.totalMonthlyProjects).toBe(0)
    expect(baseline.meta?.savingsProjects).toEqual([])
    const baselineBudgets = baseline.totalEstimatedBudgets
    const baselineRav = baseline.remainingToLive

    const { data: groupProjRow, error: groupProjErr } = await admin
      .from('savings_projects')
      .insert({
        profile_id: null,
        group_id: testGroupId,
        name: 'Group Trip',
        target_amount: 600,
        monthly_allocation: 50,
        deadline_date: '2027-12-01',
      })
      .select('id')
      .single()
    if (groupProjErr || !groupProjRow)
      throw groupProjErr ?? new Error('group project insert returned no id')

    const withProject = await getGroupFinancialData(testGroupId)
    expect(withProject.totalEstimatedBudgets).toBe(baselineBudgets + 50)
    expect(withProject.remainingToLive).toBe(baselineRav - 50)
    expect(withProject.meta?.totalMonthlyProjects).toBe(50)
    expect(withProject.meta?.savingsProjects).toHaveLength(1)
    expect(withProject.meta?.savingsProjects?.[0]?.name).toBe('Group Trip')
    expect(withProject.meta?.savingsProjects?.[0]?.monthlyAllocation).toBe(50)

    // Cleanup
    await admin.from('savings_projects').delete().eq('id', groupProjRow.id)
  }, 60_000)

  // ============================================================================
  // Case 3 — projet supprimé → totalMonthlyProjects diminue de son poids.
  // ============================================================================
  it('case 3 — projet supprimé → totalMonthlyProjects diminue + RAV remonte', async () => {
    const { data: pRow, error: pErr } = await admin
      .from('savings_projects')
      .insert({
        profile_id: profileUserId,
        group_id: null,
        name: 'To delete',
        target_amount: 900,
        monthly_allocation: 75,
        deadline_date: '2027-11-01',
      })
      .select('id')
      .single()
    if (pErr || !pRow) throw pErr ?? new Error('to-delete project insert returned no id')

    const withProject = await getProfileFinancialData(profileUserId)
    expect(withProject.meta?.totalMonthlyProjects).toBe(75)
    const ravWithProject = withProject.remainingToLive

    // Delete the project (no piggy crediting needed in this sprint — sprint
    // 02 helper handles that ; here we just want to verify the orchestrateur
    // re-reads the table fresh).
    await admin.from('savings_projects').delete().eq('id', pRow.id)

    const afterDelete = await getProfileFinancialData(profileUserId)
    expect(afterDelete.meta?.totalMonthlyProjects).toBe(0)
    expect(afterDelete.meta?.savingsProjects).toEqual([])
    expect(afterDelete.remainingToLive).toBe(ravWithProject + 75)
  }, 60_000)

  // ============================================================================
  // Case 4 — aucun projet → meta.savingsProjects = [] et totalMonthlyProjects = 0.
  // ============================================================================
  it('case 4 — aucun projet : meta.savingsProjects = [] et totalMonthlyProjects = 0', async () => {
    const data = await getProfileFinancialData(profileUserId)
    expect(data.meta?.totalMonthlyProjects).toBe(0)
    expect(data.meta?.savingsProjects).toEqual([])
  }, 30_000)
})
