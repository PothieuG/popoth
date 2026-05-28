import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Database } from '@/lib/database.types'

// NOTE: lib/finance/* is loaded dynamically inside beforeAll because it
// transitively evaluates lib/supabase-server.ts which calls createClient at
// module load — that fails when NEXT_PUBLIC_SUPABASE_URL is not set, even if
// the describe block is later skipped. Pattern mirrors
// lib/__tests__/api-regressions.test.ts and lib/finance/__tests__/rpc-concurrency.test.ts.
type FinCalcMod = typeof import('@/lib/finance')

const ENABLED = process.env.SUPABASE_FINANCE_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)(
  'financial-data orchestrator — full fixture (Sprint Refactor-I4 follow-up)',
  () => {
    let admin: SupabaseClient<Database>
    let getProfileFinancialData: FinCalcMod['getProfileFinancialData']
    let getGroupFinancialData: FinCalcMod['getGroupFinancialData']

    const stamp = Date.now()
    const testEmail = `finance-fixture-${stamp}@popoth.test`
    const testPassword = `finance-${randomUUID()}`
    let testUserId: string
    let testGroupId: string
    let estimatedIncome800Id: string
    let budget200Id: string
    let groupEstimatedIncome1000Id: string
    let groupBudget600Id: string

    // Golden math for the profile path
    // - profile.salary = 1500
    // - estimated_incomes: 800 + 200 → totalEstimatedIncome = 800+200+1500 = 2500
    // - real_incomes: 750 linked to 800 + 100 exceptional → totalRealIncome = 850
    // - estimated_budgets: 200 + 300 → totalEstimatedBudgets = 500
    // - real_expenses: 150 linked to budget200 + 80 exceptional → totalRealExpenses = 230
    // - bank_balance = 500 → availableBalance = 500 (Sprint Long-Press-Toggle-
    //   Apply-To-Balance 2026-05-23 : pure bank semantic, transactions n'affectent
    //   le solde affiché qu'après long-press apply via toggle_real_*_applied_to_balance)
    // - piggy_bank = 50, no cumulated_savings on budgets → totalSavings = 50
    // - incomeCompensation = 750 (est 800 has real 750) + 200 (est 200 has no real) = 950
    // - incomeContribution = 950 + 1500 salary = 2450
    // - exceptionalIncomes = 100; exceptionalExpenses = 80
    // - budget deficits = 0 (budget200: spent 150 < 200; budget300: spent 0 < 300)
    // - remainingToLive = 2450 + 100 - 500 - 80 - 0 = 1970
    const GOLDEN_PROFILE = {
      availableBalance: 500,
      remainingToLive: 1970,
      totalSavings: 50,
      totalEstimatedIncome: 2500,
      totalEstimatedBudgets: 500,
      totalRealIncome: 850,
      totalRealExpenses: 230,
      // Sprint 16 V3 — salaire exposé en virtual row (profile.salary = 1500 > 0).
      // Sprint Projets-Épargne 03 — totalMonthlyProjects=0 + savingsProjects=[]
      // exposés en permanence (la fixture ne seed pas de projets).
      meta: {
        readOnlyIncomes: [{ kind: 'salary', label: 'Salaire', amount: 1500 }],
        totalMonthlyProjects: 0,
        savingsProjects: [],
      },
    }

    // Golden math for the group path (single-member group → contribution =
    // 100% of contribution_base via the calculate_group_contributions trigger).
    //
    // Sprint Group-Budget-Auto-Sync (2026-05-19) — le trigger
    // `estimated_budgets_sync_group_budget` réécrit `groups.monthly_budget_estimate`
    // à `SUM(estimated_budgets.estimated_amount)` à chaque INSERT/UPDATE/DELETE
    // d'un budget. La valeur initialement seedée (GROUP_MONTHLY_BUDGET=750) est
    // immédiatement overridée à 600 par l'INSERT du budget600 ci-dessous.
    //
    // Sprint Group-Income-Cascade (2026-05-28) — le trigger symétrique
    // `estimated_incomes_sync_group_income` mirror `monthly_income_estimate`
    // à SUM(estimated_incomes) = 1000 dès l'INSERT du groupEstimatedIncome.
    // calculate_group_contributions calcule désormais :
    //   contribution_base = MAX(0, 600 − 1000) = 0  (cas surplus)
    //   contribution      = (1500/1500) × 0 = 0     (personne ne paye)
    // Le surplus 400 (1000 − 600) reste en RAV groupe positif (cagnotte).
    //
    // - estimated_incomes: 1000 → totalEstimatedIncome = 1000 (no salary for group)
    // - real_incomes: 1000 linked → totalRealIncome = 1000
    // - estimated_budgets: 600 → totalEstimatedBudgets = 600 (auto-sync mbe=600)
    // - real_expenses: 400 linked → totalRealExpenses = 400
    // - bank_balance = 1200 → availableBalance = 1200 (pure bank semantic)
    // - piggy_bank = 100 → totalSavings = 100
    // - incomeCompensation = 1000 (real == est) → incomeContribution = 1000 (no salary)
    // - exceptionalIncomes = 0; exceptionalExpenses = 0
    // - totalGroupContributions = 0 (Sprint Group-Income-Cascade : surplus)
    // - remainingToLive = 1000 + 0 + 0 - 600 - 0 - 0 = 400
    const GROUP_MONTHLY_BUDGET = 750
    const GROUP_EXPECTED_CONTRIBUTION = 0
    const GOLDEN_GROUP = {
      availableBalance: 1200,
      remainingToLive: 400,
      totalSavings: 100,
      totalEstimatedIncome: 1000,
      totalEstimatedBudgets: 600,
      totalRealIncome: 1000,
      totalRealExpenses: 400,
      // Sprint 16 V3 — une ligne read-only par membre avec contribution > 0.
      // Sprint Group-Income-Cascade : contribution = 0 (surplus) →
      // ligne filtrée (`groupContributions.filter(c => c.contribution_amount > 0)` dans
      // financial-data.ts:332) → readOnlyIncomes vide.
      // groupSalaryTotal = somme(salaires snapshot) = 1500 inchangé.
      meta: {
        readOnlyIncomes: [],
        groupSalaryTotal: 1500,
        totalMonthlyProjects: 0,
        savingsProjects: [],
      },
    }

    beforeAll(async () => {
      if (!SUPABASE_URL || !SERVICE_KEY) {
        throw new Error(
          'financial-data tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
        )
      }

      admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })

      const finCalcMod = await import('@/lib/finance')
      getProfileFinancialData = finCalcMod.getProfileFinancialData
      getGroupFinancialData = finCalcMod.getGroupFinancialData

      const { data: userData, error: userErr } = await admin.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      })
      if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
      testUserId = userData.user.id

      // Profile inserted with group_id = null first; we link after the group
      // exists so trigger_recalculate_contributions can build a deterministic
      // group_contributions row.
      const { error: profErr } = await admin.from('profiles').insert({
        id: testUserId,
        first_name: 'Finance',
        last_name: 'Fixture',
        salary: 1500,
      })
      if (profErr) throw profErr

      const { error: profileBankErr } = await admin.from('bank_balances').insert({
        profile_id: testUserId,
        group_id: null,
        balance: 500,
      })
      if (profileBankErr) throw profileBankErr

      const { error: profilePiggyErr } = await admin.from('piggy_bank').insert({
        profile_id: testUserId,
        group_id: null,
        amount: 50,
      })
      if (profilePiggyErr) throw profilePiggyErr

      const { data: est800, error: est800Err } = await admin
        .from('estimated_incomes')
        .insert({
          profile_id: testUserId,
          group_id: null,
          name: 'fixture income 800',
          estimated_amount: 800,
        })
        .select('id')
        .single()
      if (est800Err || !est800) throw est800Err ?? new Error('estimated_incomes 800 returned no id')
      estimatedIncome800Id = est800.id

      const { error: est200Err } = await admin.from('estimated_incomes').insert({
        profile_id: testUserId,
        group_id: null,
        name: 'fixture income 200',
        estimated_amount: 200,
      })
      if (est200Err) throw est200Err

      const todayIso = new Date().toISOString().split('T')[0]!
      const { error: realIncomeErr } = await admin.from('real_income_entries').insert([
        {
          profile_id: testUserId,
          group_id: null,
          amount: 750,
          description: 'real for estimated 800',
          entry_date: todayIso,
          estimated_income_id: estimatedIncome800Id,
          is_exceptional: false,
        },
        {
          profile_id: testUserId,
          group_id: null,
          amount: 100,
          description: 'exceptional income',
          entry_date: todayIso,
          estimated_income_id: null,
          is_exceptional: true,
        },
      ])
      if (realIncomeErr) throw realIncomeErr

      const { data: budget200, error: budget200Err } = await admin
        .from('estimated_budgets')
        .insert({
          profile_id: testUserId,
          group_id: null,
          name: 'fixture budget 200',
          estimated_amount: 200,
        })
        .select('id')
        .single()
      if (budget200Err || !budget200)
        throw budget200Err ?? new Error('estimated_budgets 200 returned no id')
      budget200Id = budget200.id

      const { error: budget300Err } = await admin.from('estimated_budgets').insert({
        profile_id: testUserId,
        group_id: null,
        name: 'fixture budget 300',
        estimated_amount: 300,
      })
      if (budget300Err) throw budget300Err

      const { error: realExpenseErr } = await admin.from('real_expenses').insert([
        {
          profile_id: testUserId,
          group_id: null,
          amount: 150,
          description: 'real expense linked to budget 200',
          expense_date: todayIso,
          estimated_budget_id: budget200Id,
          is_exceptional: false,
        },
        {
          profile_id: testUserId,
          group_id: null,
          amount: 80,
          description: 'exceptional expense',
          expense_date: todayIso,
          estimated_budget_id: null,
          is_exceptional: true,
        },
      ])
      if (realExpenseErr) throw realExpenseErr

      const { data: groupRow, error: groupErr } = await admin
        .from('groups')
        .insert({
          name: `Finance Fixture Group ${stamp}`,
          creator_id: testUserId,
          monthly_budget_estimate: GROUP_MONTHLY_BUDGET,
        })
        .select('id')
        .single()
      if (groupErr || !groupRow) throw groupErr ?? new Error('groups insert returned no id')
      testGroupId = groupRow.id

      const { error: groupBankErr } = await admin.from('bank_balances').insert({
        profile_id: null,
        group_id: testGroupId,
        balance: 1200,
      })
      if (groupBankErr) throw groupBankErr

      const { error: groupPiggyErr } = await admin.from('piggy_bank').insert({
        profile_id: null,
        group_id: testGroupId,
        amount: 100,
      })
      if (groupPiggyErr) throw groupPiggyErr

      const { data: groupEst1000, error: groupEst1000Err } = await admin
        .from('estimated_incomes')
        .insert({
          profile_id: null,
          group_id: testGroupId,
          name: 'group estimated income 1000',
          estimated_amount: 1000,
        })
        .select('id')
        .single()
      if (groupEst1000Err || !groupEst1000)
        throw groupEst1000Err ?? new Error('group estimated income 1000 returned no id')
      groupEstimatedIncome1000Id = groupEst1000.id

      const { error: groupRealIncomeErr } = await admin.from('real_income_entries').insert({
        profile_id: null,
        group_id: testGroupId,
        amount: 1000,
        description: 'group real income matched',
        entry_date: todayIso,
        estimated_income_id: groupEstimatedIncome1000Id,
        is_exceptional: false,
      })
      if (groupRealIncomeErr) throw groupRealIncomeErr

      const { data: groupBudget600, error: groupBudget600Err } = await admin
        .from('estimated_budgets')
        .insert({
          profile_id: null,
          group_id: testGroupId,
          name: 'group budget 600',
          estimated_amount: 600,
        })
        .select('id')
        .single()
      if (groupBudget600Err || !groupBudget600)
        throw groupBudget600Err ?? new Error('group budget 600 returned no id')
      groupBudget600Id = groupBudget600.id

      const { error: groupRealExpenseErr } = await admin.from('real_expenses').insert({
        profile_id: null,
        group_id: testGroupId,
        amount: 400,
        description: 'group real expense linked',
        expense_date: todayIso,
        estimated_budget_id: groupBudget600Id,
        is_exceptional: false,
      })
      if (groupRealExpenseErr) throw groupRealExpenseErr

      // Linking the profile to the group fires trigger_recalculate_contributions
      // which auto-inserts a group_contributions row sized by salary proportion.
      // With a single member, contribution_amount = monthly_budget_estimate.
      const { error: linkErr } = await admin
        .from('profiles')
        .update({ group_id: testGroupId })
        .eq('id', testUserId)
      if (linkErr) throw linkErr
    }, 60_000)

    afterAll(async () => {
      if (!admin || !testUserId) return
      // FK-safe cleanup order. group_contributions has composite FK to both
      // profiles and groups so it must clear first; unlink profile before
      // dropping the group so triggers don't fight us on the group delete.
      await admin.from('group_contributions').delete().eq('group_id', testGroupId)
      await admin.from('profiles').update({ group_id: null }).eq('id', testUserId)
      await admin.from('real_income_entries').delete().eq('group_id', testGroupId)
      await admin.from('real_expenses').delete().eq('group_id', testGroupId)
      await admin.from('estimated_incomes').delete().eq('group_id', testGroupId)
      await admin.from('estimated_budgets').delete().eq('group_id', testGroupId)
      await admin.from('piggy_bank').delete().eq('group_id', testGroupId)
      await admin.from('bank_balances').delete().eq('group_id', testGroupId)
      await admin.from('groups').delete().eq('id', testGroupId)
      await admin.from('real_income_entries').delete().eq('profile_id', testUserId)
      await admin.from('real_expenses').delete().eq('profile_id', testUserId)
      await admin.from('estimated_incomes').delete().eq('profile_id', testUserId)
      await admin.from('estimated_budgets').delete().eq('profile_id', testUserId)
      await admin.from('piggy_bank').delete().eq('profile_id', testUserId)
      await admin.from('bank_balances').delete().eq('profile_id', testUserId)
      await admin.auth.admin.deleteUser(testUserId)
    }, 60_000)

    it('case 1 — profile golden math: 7 FinancialData fields match the seed', async () => {
      const data = await getProfileFinancialData(testUserId)
      expect(data).toEqual(GOLDEN_PROFILE)
    }, 30_000)

    it('case 2 — group golden math: trigger contribution + 7 fields match', async () => {
      // Sanity-check the trigger output before asserting golden RAV. If the
      // calculate_group_contributions trigger ever drifts (e.g. switches to a
      // floored value, or adds a safety margin), this assertion fails before
      // the golden RAV check so the failure mode is clear.
      const { data: contribution, error: contribErr } = await admin
        .from('group_contributions')
        .select('contribution_amount, salary')
        .eq('group_id', testGroupId)
        .eq('profile_id', testUserId)
        .single()
      expect(contribErr).toBeNull()
      expect(contribution?.contribution_amount).toBe(GROUP_EXPECTED_CONTRIBUTION)

      const data = await getGroupFinancialData(testGroupId)
      // Sprint Group-Income-Cascade : enrichit GOLDEN_GROUP avec les fields
      // dynamiques (testUserId-dependent) hydratés par Sprint Group-RAV-Recap
      // et Sprint Fix-Group-Recap-RavEstime — précédemment absents de
      // GOLDEN_GROUP, le test passait silencieusement parce que ces fields
      // étaient ajoutés tard et le harness gated rarement re-run.
      const GOLDEN_GROUP_WITH_DYNAMIC = {
        ...GOLDEN_GROUP,
        meta: {
          ...GOLDEN_GROUP.meta,
          totalGroupContributions: 0,
          groupMembersRav: [
            {
              profileId: testUserId,
              firstName: 'Finance',
              salary: 1500,
              currentRav: 1970,
            },
          ],
          groupMembersPersonalRavTotal: 1970,
        },
      }
      expect(data).toEqual(GOLDEN_GROUP_WITH_DYNAMIC)
    }, 30_000)

    it('case 6 — saveRavToDatabase persists remainingToLive matching the returned value', async () => {
      const data = await getProfileFinancialData(testUserId)
      const { data: bank, error } = await admin
        .from('bank_balances')
        .select('current_remaining_to_live')
        .eq('profile_id', testUserId)
        .single()
      expect(error).toBeNull()
      expect(bank?.current_remaining_to_live).toBe(data.remainingToLive)
      expect(bank?.current_remaining_to_live).toBe(GOLDEN_PROFILE.remainingToLive)
    }, 30_000)
  },
)

describe.skipIf(!ENABLED)('financial-data orchestrator — edge cases', () => {
  let admin: SupabaseClient<Database>
  let getProfileFinancialData: FinCalcMod['getProfileFinancialData']
  let getGroupFinancialData: FinCalcMod['getGroupFinancialData']

  const stamp = Date.now()
  const noDataEmail = `finance-nodata-${stamp}@popoth.test`
  const noDataPassword = `nodata-${randomUUID()}`
  let noDataUserId: string
  let noDataGroupId: string

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'financial-data edge tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const finCalcMod = await import('@/lib/finance')
    getProfileFinancialData = finCalcMod.getProfileFinancialData
    getGroupFinancialData = finCalcMod.getGroupFinancialData

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: noDataEmail,
      password: noDataPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    noDataUserId = userData.user.id

    // Profile with NO estimated rows, only a bank balance, salary null so no
    // hidden contribution leaks into the incomeCompensation path.
    const { error: profErr } = await admin.from('profiles').insert({
      id: noDataUserId,
      first_name: 'NoData',
      last_name: 'Fixture',
    })
    if (profErr) throw profErr

    const { error: bankErr } = await admin.from('bank_balances').insert({
      profile_id: noDataUserId,
      group_id: null,
      balance: 250,
    })
    if (bankErr) throw bankErr

    // Group with NO estimated rows, only a bank balance. The noData user is
    // the creator but we do NOT link them as a member → no group_contributions
    // row is auto-created, isolating the "empty group" code path.
    const { data: groupRow, error: groupErr } = await admin
      .from('groups')
      .insert({
        name: `Finance NoData Group ${stamp}`,
        creator_id: noDataUserId,
        monthly_budget_estimate: 0,
      })
      .select('id')
      .single()
    if (groupErr || !groupRow) throw groupErr ?? new Error('groups insert returned no id')
    noDataGroupId = groupRow.id

    const { error: groupBankErr } = await admin.from('bank_balances').insert({
      profile_id: null,
      group_id: noDataGroupId,
      balance: 175,
    })
    if (groupBankErr) throw groupBankErr
  }, 60_000)

  afterAll(async () => {
    if (!admin || !noDataUserId) return
    await admin.from('group_contributions').delete().eq('group_id', noDataGroupId)
    await admin.from('bank_balances').delete().eq('group_id', noDataGroupId)
    await admin.from('groups').delete().eq('id', noDataGroupId)
    await admin.from('bank_balances').delete().eq('profile_id', noDataUserId)
    await admin.auth.admin.deleteUser(noDataUserId)
  }, 60_000)

  it('case 3 — profile without estimated rows: availableBalance = bankBalance, RAV = 0', async () => {
    const data = await getProfileFinancialData(noDataUserId)
    expect(data.availableBalance).toBe(250)
    expect(data.totalEstimatedIncome).toBe(0)
    expect(data.totalEstimatedBudgets).toBe(0)
    expect(data.totalRealIncome).toBe(0)
    expect(data.totalRealExpenses).toBe(0)
    expect(data.totalSavings).toBe(0)
    expect(data.remainingToLive).toBe(0)
  }, 30_000)

  it('case 4 — group without estimated rows: availableBalance = bankBalance, RAV = 0', async () => {
    const data = await getGroupFinancialData(noDataGroupId)
    expect(data.availableBalance).toBe(175)
    expect(data.totalEstimatedIncome).toBe(0)
    expect(data.totalEstimatedBudgets).toBe(0)
    expect(data.totalRealIncome).toBe(0)
    expect(data.totalRealExpenses).toBe(0)
    expect(data.totalSavings).toBe(0)
    expect(data.remainingToLive).toBe(0)
  }, 30_000)

  it('case 5 — fail-soft: unknown UUIDs return all-zero FinancialData, never throw', async () => {
    // Sprint 16 V3 — `meta` est toujours exposé, même sur UUID inconnu (le
    // happy path n'arrête pas, il calcule juste avec 0 partout). Profile :
    // pas de groupSalaryTotal (perso only). Groupe : groupSalaryTotal = 0
    // (aucune contribution row → sum vide).
    const PROFILE_EMPTY_SHAPE = {
      availableBalance: 0,
      remainingToLive: 0,
      totalSavings: 0,
      totalEstimatedIncome: 0,
      totalEstimatedBudgets: 0,
      totalRealIncome: 0,
      totalRealExpenses: 0,
      meta: { readOnlyIncomes: [], totalMonthlyProjects: 0, savingsProjects: [] },
    }
    const GROUP_EMPTY_SHAPE = {
      ...PROFILE_EMPTY_SHAPE,
      meta: {
        readOnlyIncomes: [],
        groupSalaryTotal: 0,
        // Sprint Fix-Group-Recap-RavEstime (2026-05-27) — totalGroupContributions
        // est toujours exposé en groupe (même 0). Sprint Group-Income-Cascade
        // 2026-05-28 : explicite dans l'empty shape.
        totalGroupContributions: 0,
        totalMonthlyProjects: 0,
        savingsProjects: [],
      },
    }

    const profileData = await getProfileFinancialData(randomUUID())
    expect(profileData).toEqual(PROFILE_EMPTY_SHAPE)

    const groupData = await getGroupFinancialData(randomUUID())
    expect(groupData).toEqual(GROUP_EMPTY_SHAPE)
  }, 30_000)
})

// Sprint 16 Monthly Recap V3 (2026-05-25) — virtual read-only rows.
// Couvre `meta.readOnlyIncomes` selon le contexte :
//   - perso : ligne `Salaire` si profile.salary > 0
//   - groupe : 1 ligne `Contribution de <prénom>` par membre avec
//              contribution_amount > 0, triée par prénom
// Les cas single-member-group et profile-with-salary sont couverts par les
// goldens ci-dessus. Ce describe cible : profile sans salaire + groupe
// multi-membres + group sans contribution > 0.
describe.skipIf(!ENABLED)('financial-data — meta.readOnlyIncomes (Sprint 16)', () => {
  let admin: SupabaseClient<Database>
  let getProfileFinancialData: FinCalcMod['getProfileFinancialData']
  let getGroupFinancialData: FinCalcMod['getGroupFinancialData']

  const stamp = Date.now()
  const noSalaryEmail = `finance-nosalary-${stamp}@popoth.test`
  const noSalaryPassword = `nosalary-${randomUUID()}`
  let noSalaryUserId: string

  // Multi-member group fixture : Alice (2000€) + Bob (1000€), budget 1500€.
  // Trigger calcule : Alice = (2000/3000)*1500 = 1000, Bob = (1000/3000)*1500 = 500.
  // Tri alphabétique attendu : Alice (1000) en premier, Bob (500) en second.
  const aliceEmail = `finance-alice-${stamp}@popoth.test`
  const alicePassword = `alice-${randomUUID()}`
  let aliceUserId: string

  const bobEmail = `finance-bob-${stamp}@popoth.test`
  const bobPassword = `bob-${randomUUID()}`
  let bobUserId: string

  let multiGroupId: string

  // Groupe vide : aucune contribution (monthly_budget=0). Vérifie le
  // fallback empty array.
  const emptyGroupCreatorEmail = `finance-empty-${stamp}@popoth.test`
  const emptyGroupCreatorPassword = `empty-${randomUUID()}`
  let emptyGroupCreatorId: string
  let emptyGroupId: string

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'financial-data meta tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const finCalcMod = await import('@/lib/finance')
    getProfileFinancialData = finCalcMod.getProfileFinancialData
    getGroupFinancialData = finCalcMod.getGroupFinancialData

    // Profile sans salaire : valide que readOnlyIncomes reste vide en perso.
    const { data: noSalaryUser, error: noSalaryErr } = await admin.auth.admin.createUser({
      email: noSalaryEmail,
      password: noSalaryPassword,
      email_confirm: true,
    })
    if (noSalaryErr || !noSalaryUser.user) throw noSalaryErr ?? new Error('createUser failed')
    noSalaryUserId = noSalaryUser.user.id

    const { error: noSalaryProfErr } = await admin.from('profiles').insert({
      id: noSalaryUserId,
      first_name: 'NoSalary',
      last_name: 'Fixture',
    })
    if (noSalaryProfErr) throw noSalaryProfErr

    // Multi-member group : Alice + Bob, salary > 0 → trigger calcule
    // contributions proportionnelles au salaire (monthly_budget=1500).
    const { data: aliceUser, error: aliceErr } = await admin.auth.admin.createUser({
      email: aliceEmail,
      password: alicePassword,
      email_confirm: true,
    })
    if (aliceErr || !aliceUser.user) throw aliceErr ?? new Error('alice createUser failed')
    aliceUserId = aliceUser.user.id

    const { data: bobUser, error: bobErr } = await admin.auth.admin.createUser({
      email: bobEmail,
      password: bobPassword,
      email_confirm: true,
    })
    if (bobErr || !bobUser.user) throw bobErr ?? new Error('bob createUser failed')
    bobUserId = bobUser.user.id

    const { error: aliceProfErr } = await admin.from('profiles').insert({
      id: aliceUserId,
      first_name: 'Alice',
      last_name: 'Fixture',
      salary: 2000,
    })
    if (aliceProfErr) throw aliceProfErr

    const { error: bobProfErr } = await admin.from('profiles').insert({
      id: bobUserId,
      first_name: 'Bob',
      last_name: 'Fixture',
      salary: 1000,
    })
    if (bobProfErr) throw bobProfErr

    const { data: multiGroupRow, error: multiGroupErr } = await admin
      .from('groups')
      .insert({
        name: `Multi-Member Group ${stamp}`,
        creator_id: aliceUserId,
        monthly_budget_estimate: 1500,
      })
      .select('id')
      .single()
    if (multiGroupErr || !multiGroupRow)
      throw multiGroupErr ?? new Error('multi group insert returned no id')
    multiGroupId = multiGroupRow.id

    const { error: aliceLinkErr } = await admin
      .from('profiles')
      .update({ group_id: multiGroupId })
      .eq('id', aliceUserId)
    if (aliceLinkErr) throw aliceLinkErr

    const { error: bobLinkErr } = await admin
      .from('profiles')
      .update({ group_id: multiGroupId })
      .eq('id', bobUserId)
    if (bobLinkErr) throw bobLinkErr

    // Groupe vide : creator sans member-link → group_contributions reste
    // sans ligne → readOnlyIncomes = [].
    const { data: emptyCreator, error: emptyCreatorErr } = await admin.auth.admin.createUser({
      email: emptyGroupCreatorEmail,
      password: emptyGroupCreatorPassword,
      email_confirm: true,
    })
    if (emptyCreatorErr || !emptyCreator.user)
      throw emptyCreatorErr ?? new Error('empty creator createUser failed')
    emptyGroupCreatorId = emptyCreator.user.id

    const { error: emptyCreatorProfErr } = await admin.from('profiles').insert({
      id: emptyGroupCreatorId,
      first_name: 'EmptyCreator',
      last_name: 'Fixture',
    })
    if (emptyCreatorProfErr) throw emptyCreatorProfErr

    const { data: emptyGroupRow, error: emptyGroupErr } = await admin
      .from('groups')
      .insert({
        name: `Empty Group ${stamp}`,
        creator_id: emptyGroupCreatorId,
        monthly_budget_estimate: 0,
      })
      .select('id')
      .single()
    if (emptyGroupErr || !emptyGroupRow)
      throw emptyGroupErr ?? new Error('empty group insert returned no id')
    emptyGroupId = emptyGroupRow.id
  }, 60_000)

  afterAll(async () => {
    if (!admin) return
    await admin.from('group_contributions').delete().eq('group_id', multiGroupId)
    await admin.from('profiles').update({ group_id: null }).in('id', [aliceUserId, bobUserId])
    await admin.from('groups').delete().eq('id', multiGroupId)
    await admin.from('groups').delete().eq('id', emptyGroupId)
    await admin
      .from('profiles')
      .delete()
      .in('id', [noSalaryUserId, aliceUserId, bobUserId, emptyGroupCreatorId])
    await admin.auth.admin.deleteUser(noSalaryUserId)
    await admin.auth.admin.deleteUser(aliceUserId)
    await admin.auth.admin.deleteUser(bobUserId)
    await admin.auth.admin.deleteUser(emptyGroupCreatorId)
  }, 60_000)

  it('profile sans salaire (null) → meta.readOnlyIncomes vide', async () => {
    const data = await getProfileFinancialData(noSalaryUserId)
    expect(data.meta?.readOnlyIncomes).toEqual([])
  }, 30_000)

  it('group multi-membres → 1 ligne par membre, triée par prénom', async () => {
    const data = await getGroupFinancialData(multiGroupId)
    expect(data.meta?.readOnlyIncomes).toEqual([
      { kind: 'contribution', label: 'Contribution de Alice', amount: 1000 },
      { kind: 'contribution', label: 'Contribution de Bob', amount: 500 },
    ])
  }, 30_000)

  it('group multi-membres → meta.groupSalaryTotal = somme des salaires (Alice 2000 + Bob 1000 = 3000)', async () => {
    const data = await getGroupFinancialData(multiGroupId)
    expect(data.meta?.groupSalaryTotal).toBe(3000)
  }, 30_000)

  it('group sans contribution (monthly_budget=0, aucun membre) → meta.readOnlyIncomes vide', async () => {
    const data = await getGroupFinancialData(emptyGroupId)
    expect(data.meta?.readOnlyIncomes).toEqual([])
  }, 30_000)

  it('group sans membre → meta.groupSalaryTotal = 0 (plafond budget = 0)', async () => {
    const data = await getGroupFinancialData(emptyGroupId)
    expect(data.meta?.groupSalaryTotal).toBe(0)
  }, 30_000)
})

// Sprint 15 Monthly Recap V3 (2026-05-27) + Part 35 (2026-05-27) — filter
// carried_from_recap_id IS NULL. Fixture mixant transactions normales + carry-
// overs dans les 2 états (A = is_carried_over=true en attente, B =
// is_carried_over=false validée post long-press). Le filtre doit exclure les
// DEUX états des sums totalRealExpenses/totalRealIncome ET du calcul de
// spent_per_budget (indirect via totalBudgetDeficits → remainingToLive).
// Une carry-over validée ne doit pas re-impacter le RAV du mois courant
// (elle a déjà été comptée dans le RAV de son mois d'origine).
describe.skipIf(!ENABLED)('financial-data — carry-over filter (Sprint 15 + Part 35)', () => {
  let admin: SupabaseClient<Database>
  let getProfileFinancialData: FinCalcMod['getProfileFinancialData']

  const stamp = Date.now()
  const carryEmail = `finance-carry-${stamp}@popoth.test`
  const carryPassword = `carry-${randomUUID()}`
  let carryUserId: string
  let carryRecapId: string

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'financial-data carry-over tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const finCalcMod = await import('@/lib/finance')
    getProfileFinancialData = finCalcMod.getProfileFinancialData

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: carryEmail,
      password: carryPassword,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    carryUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: carryUserId,
      first_name: 'CarryFilter',
      last_name: 'Fixture',
    })
    if (profErr) throw profErr

    const { error: bankErr } = await admin.from('bank_balances').insert({
      profile_id: carryUserId,
      balance: 1000,
    })
    if (bankErr) throw bankErr

    // Recap row used as carried_from_recap_id FK.
    const { data: recapData, error: recapErr } = await admin
      .from('monthly_recaps')
      .insert({
        profile_id: carryUserId,
        recap_month: 4,
        recap_year: 2026,
        current_step: 'completed',
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (recapErr || !recapData) throw recapErr ?? new Error('insert recap failed')
    carryRecapId = recapData.id

    // 3 dépenses normales (sum 150) + 2 carry-overs state A (sum 80) + 1
    // carry-over state B (60). Filter `carried_from_recap_id IS NULL` exclut
    // state A ET state B → totalRealExpenses = 150 (pas 290).
    await admin.from('real_expenses').insert([
      {
        profile_id: carryUserId,
        amount: 50,
        description: 'normal 1',
        expense_date: '2026-05-10',
        is_exceptional: true,
        is_carried_over: false,
      },
      {
        profile_id: carryUserId,
        amount: 70,
        description: 'normal 2',
        expense_date: '2026-05-12',
        is_exceptional: true,
        is_carried_over: false,
      },
      {
        profile_id: carryUserId,
        amount: 30,
        description: 'normal 3',
        expense_date: '2026-05-15',
        is_exceptional: true,
        is_carried_over: false,
      },
      {
        profile_id: carryUserId,
        amount: 45,
        description: 'carry 1 (state A — en attente)',
        expense_date: '2026-04-20',
        is_exceptional: true,
        is_carried_over: true,
        carried_from_recap_id: carryRecapId,
      },
      {
        profile_id: carryUserId,
        amount: 35,
        description: 'carry 2 (state A — en attente)',
        expense_date: '2026-04-22',
        is_exceptional: true,
        is_carried_over: true,
        carried_from_recap_id: carryRecapId,
      },
      {
        profile_id: carryUserId,
        amount: 60,
        description: 'carry 3 (state B — validée post long-press)',
        expense_date: '2026-04-25',
        is_exceptional: true,
        is_carried_over: false,
        carried_from_recap_id: carryRecapId,
        applied_to_balance_at: new Date().toISOString(),
      },
    ])

    // 2 revenus normaux (sum 300) + 1 carry-over state A (200) + 1 carry-over
    // state B (90). Filter exclut les 2 états → totalRealIncome = 300 (pas 590).
    await admin.from('real_income_entries').insert([
      {
        profile_id: carryUserId,
        amount: 100,
        description: 'income normal 1',
        entry_date: '2026-05-05',
        is_exceptional: true,
        is_carried_over: false,
      },
      {
        profile_id: carryUserId,
        amount: 200,
        description: 'income normal 2',
        entry_date: '2026-05-07',
        is_exceptional: true,
        is_carried_over: false,
      },
      {
        profile_id: carryUserId,
        amount: 200,
        description: 'income carry 1 (state A — en attente)',
        entry_date: '2026-04-25',
        is_exceptional: true,
        is_carried_over: true,
        carried_from_recap_id: carryRecapId,
      },
      {
        profile_id: carryUserId,
        amount: 90,
        description: 'income carry 2 (state B — validée post long-press)',
        entry_date: '2026-04-28',
        is_exceptional: true,
        is_carried_over: false,
        carried_from_recap_id: carryRecapId,
        applied_to_balance_at: new Date().toISOString(),
      },
    ])
  }, 60_000)

  afterAll(async () => {
    if (!admin || !carryUserId) return
    await admin.from('real_expenses').delete().eq('profile_id', carryUserId)
    await admin.from('real_income_entries').delete().eq('profile_id', carryUserId)
    await admin.from('bank_balances').delete().eq('profile_id', carryUserId)
    await admin.from('monthly_recaps').delete().eq('profile_id', carryUserId)
    await admin.auth.admin.deleteUser(carryUserId)
  }, 30_000)

  it('totalRealExpenses excludes carry-over rows in BOTH states (150, not 290)', async () => {
    // 3 normales (150) + 2 state A (80) + 1 state B (60) = 290 brut.
    // Filter exclut state A et state B → 150.
    const data = await getProfileFinancialData(carryUserId)
    expect(data.totalRealExpenses).toBe(150)
  }, 30_000)

  it('totalRealIncome excludes carry-over rows in BOTH states (300, not 590)', async () => {
    // 2 normaux (300) + 1 state A (200) + 1 state B (90) = 590 brut.
    // Filter exclut state A et state B → 300.
    const data = await getProfileFinancialData(carryUserId)
    expect(data.totalRealIncome).toBe(300)
  }, 30_000)

  it('remainingToLive uses filtered sums (carry-overs not in RAV, both states)', async () => {
    // Profile with no estimated budgets/incomes, no salary → all calcs flow
    // through exceptionalIncomes/Expenses. RAV formula:
    //   RAV = incomeContribution + exceptionalIncomes - estimatedBudgets - exceptionalExpenses - deficits
    //   RAV = 0 + 300 - 0 - 150 - 0 = 150
    // Si le filter carried_from_recap_id IS NULL était remplacé par
    // is_carried_over=false seul (régression Part 35) :
    //   RAV erroné = 0 + (300+90) - 0 - (150+60) - 0 = 180 (state B comptée
    //   alors qu'elle ne devrait pas, double-comptage cross-mois).
    const data = await getProfileFinancialData(carryUserId)
    expect(data.remainingToLive).toBe(150)
  }, 30_000)

  it('Part 35 regression-guard: state B carry-over (validated post long-press) is excluded from RAV', async () => {
    // Cas explicite — sans le fix Part 35 (filter `is_carried_over=false` seul),
    // ce test échouerait : la state B row (60€ expense + 90€ income, applied_
    // to_balance_at != null, is_carried_over=false, carried_from_recap_id !=
    // null) serait incluse dans les totaux, faisant baisser le RAV de 30€.
    const data = await getProfileFinancialData(carryUserId)
    expect(data.totalRealExpenses).toBe(150) // pas 210
    expect(data.totalRealIncome).toBe(300) // pas 390
    expect(data.remainingToLive).toBe(150) // pas 180
  }, 30_000)
})
