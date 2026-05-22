/**
 * Sprint Recap-V2-Dev-Tools (2026-05-22) — applies a declarative scenario
 * to a user's finances (wipe + reseed) so the dev can iterate on the V2
 * recap flow with consistent input states. Server-only — uses supabaseServer
 * (bypasses RLS). Caller MUST gate via blockInProduction().
 */

import type { Database } from '@/lib/database.types'
import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import {
  getScenario,
  type ScenarioBudget,
  type ScenarioExpense,
  type ScenarioIncome,
  type ScenarioKey,
  type ScenarioRealIncome,
} from './recap-v2-scenarios'

type EstimatedBudgetInsert = Database['public']['Tables']['estimated_budgets']['Insert']
type RealExpenseInsert = Database['public']['Tables']['real_expenses']['Insert']
type EstimatedIncomeInsert = Database['public']['Tables']['estimated_incomes']['Insert']
type RealIncomeInsert = Database['public']['Tables']['real_income_entries']['Insert']

export interface ApplyScenarioResult {
  success: boolean
  scenario: ScenarioKey
  summary: {
    profile_id: string
    group_id: string | null
    budgets_created: number
    expenses_created: number
    incomes_created: number
    real_incomes_created: number
    piggy_bank_set: number
    bank_balance_set: number
  }
  errors: string[]
}

export async function applyScenario(
  userId: string,
  key: ScenarioKey,
): Promise<ApplyScenarioResult> {
  const scenario = getScenario(key)
  const baseSummary = {
    profile_id: userId,
    group_id: null as string | null,
    budgets_created: 0,
    expenses_created: 0,
    incomes_created: 0,
    real_incomes_created: 0,
    piggy_bank_set: 0,
    bank_balance_set: 0,
  }

  if (!scenario) {
    return {
      success: false,
      scenario: key,
      summary: baseSummary,
      errors: [`Scénario inconnu : ${key}`],
    }
  }

  const errors: string[] = []
  const summary = { ...baseSummary }

  await wipeUserFinances(userId, errors)

  let groupId: string | null = null
  if (scenario.setup.group?.create) {
    groupId = await ensureGroupForCreator(userId, errors)
  } else {
    const { error } = await supabaseServer
      .from('profiles')
      .update({ group_id: null })
      .eq('id', userId)
    if (error) errors.push(`unlink group: ${error.message}`)
  }
  summary.group_id = groupId

  const profileBudgetIds = await insertBudgets(userId, null, scenario.setup.budgets, errors)
  summary.budgets_created += profileBudgetIds.size
  summary.expenses_created += await insertExpenses(
    userId,
    null,
    scenario.setup.expenses,
    profileBudgetIds,
    errors,
  )

  if (scenario.setup.incomes) {
    summary.incomes_created += await insertIncomes(userId, null, scenario.setup.incomes, errors)
  }
  if (scenario.setup.realIncomes) {
    summary.real_incomes_created += await insertRealIncomes(
      userId,
      null,
      scenario.setup.realIncomes,
      errors,
    )
  }

  if (groupId && scenario.setup.group?.budgets?.length) {
    const groupBudgetIds = await insertBudgets(null, groupId, scenario.setup.group.budgets, errors)
    summary.budgets_created += groupBudgetIds.size
    if (scenario.setup.group.expenses) {
      summary.expenses_created += await insertExpenses(
        userId,
        groupId,
        scenario.setup.group.expenses,
        groupBudgetIds,
        errors,
      )
    }
    if (scenario.setup.group.incomes) {
      summary.incomes_created += await insertIncomes(
        null,
        groupId,
        scenario.setup.group.incomes,
        errors,
      )
    }
    if (scenario.setup.group.realIncomes) {
      summary.real_incomes_created += await insertRealIncomes(
        userId,
        groupId,
        scenario.setup.group.realIncomes,
        errors,
      )
    }
  }

  const piggyAmount = scenario.setup.piggy_bank_amount ?? 0
  await upsertPiggyBankProfile(userId, piggyAmount, errors)
  summary.piggy_bank_set = piggyAmount

  if (groupId) {
    await upsertPiggyBankGroup(groupId, 0, errors)
  }

  const bankBalance = scenario.setup.bank_balance ?? 0
  const bankRtL = scenario.setup.bank_current_remaining_to_live ?? 0
  await upsertBankBalanceProfile(userId, bankBalance, bankRtL, errors)
  summary.bank_balance_set = bankBalance

  // Final cleanup : drop any V2 recap row for the current month so the
  // gating redirects to /monthly-recap on next nav (the seed is supposed to
  // simulate a "month not yet closed" state, even if the user had previously
  // clôturé this month via the V2 stub button).
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const { error: dropProfileV2 } = await supabaseServer
    .from('monthly_recaps_v2')
    .delete()
    .eq('profile_id', userId)
    .eq('recap_month', month)
    .eq('recap_year', year)
  if (dropProfileV2) errors.push(`drop monthly_recaps_v2 profile: ${dropProfileV2.message}`)

  if (groupId) {
    const { error: dropGroupV2 } = await supabaseServer
      .from('monthly_recaps_v2')
      .delete()
      .eq('group_id', groupId)
      .eq('recap_month', month)
      .eq('recap_year', year)
    if (dropGroupV2) errors.push(`drop monthly_recaps_v2 group: ${dropGroupV2.message}`)
  }

  if (errors.length > 0) {
    logger.warn('[applyScenario] partial errors', { key, errors })
  }

  return {
    success: errors.length === 0,
    scenario: key,
    summary,
    errors,
  }
}

async function wipeUserFinances(userId: string, errors: string[]): Promise<void> {
  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('group_id')
    .eq('id', userId)
    .single()
  const groupId = profile?.group_id ?? null

  // Order : children (transfers, expenses, incomes) → parents (budgets) → recaps
  const profileDeletes = [
    () => supabaseServer.from('budget_transfers').delete().eq('profile_id', userId),
    () => supabaseServer.from('real_expenses').delete().eq('profile_id', userId),
    () => supabaseServer.from('real_income_entries').delete().eq('profile_id', userId),
    () => supabaseServer.from('estimated_budgets').delete().eq('profile_id', userId),
    () => supabaseServer.from('estimated_incomes').delete().eq('profile_id', userId),
    () => supabaseServer.from('monthly_recaps').delete().eq('profile_id', userId),
    () => supabaseServer.from('monthly_recaps_v2').delete().eq('profile_id', userId),
  ]
  for (const op of profileDeletes) {
    const { error } = await op()
    if (error) errors.push(`wipe profile: ${error.message}`)
  }

  if (groupId) {
    const groupDeletes = [
      () => supabaseServer.from('budget_transfers').delete().eq('group_id', groupId),
      () => supabaseServer.from('real_expenses').delete().eq('group_id', groupId),
      () => supabaseServer.from('real_income_entries').delete().eq('group_id', groupId),
      () => supabaseServer.from('estimated_budgets').delete().eq('group_id', groupId),
      () => supabaseServer.from('estimated_incomes').delete().eq('group_id', groupId),
      () => supabaseServer.from('monthly_recaps').delete().eq('group_id', groupId),
      () => supabaseServer.from('monthly_recaps_v2').delete().eq('group_id', groupId),
    ]
    for (const op of groupDeletes) {
      const { error } = await op()
      if (error) errors.push(`wipe group: ${error.message}`)
    }
  }

  // Snapshots : deactivate (audit trail preserved)
  await supabaseServer.from('recap_snapshots').update({ is_active: false }).eq('profile_id', userId)
  await supabaseServer
    .from('recap_snapshots_v2')
    .update({ is_active: false })
    .eq('profile_id', userId)
  if (groupId) {
    await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('group_id', groupId)
    await supabaseServer
      .from('recap_snapshots_v2')
      .update({ is_active: false })
      .eq('group_id', groupId)
  }
}

async function ensureGroupForCreator(userId: string, errors: string[]): Promise<string | null> {
  // If user already has a group, reuse it
  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('group_id')
    .eq('id', userId)
    .single()

  if (profile?.group_id) {
    return profile.group_id
  }

  // Else create a new group with this user as creator
  const stamp = Date.now()
  const { data: group, error: groupErr } = await supabaseServer
    .from('groups')
    .insert({
      name: `Dev Group ${stamp}`,
      creator_id: userId,
      monthly_budget_estimate: 0,
    })
    .select('id')
    .single()

  if (groupErr || !group) {
    errors.push(`create group: ${groupErr?.message ?? 'unknown'}`)
    return null
  }

  // Link user to the new group
  const { error: linkErr } = await supabaseServer
    .from('profiles')
    .update({ group_id: group.id })
    .eq('id', userId)
  if (linkErr) {
    errors.push(`link group: ${linkErr.message}`)
  }

  return group.id
}

async function insertBudgets(
  profileId: string | null,
  groupId: string | null,
  budgets: ScenarioBudget[],
  errors: string[],
): Promise<Map<string, string>> {
  const nameToId = new Map<string, string>()
  if (budgets.length === 0) return nameToId

  const rows: EstimatedBudgetInsert[] = budgets.map((b) => ({
    ...(profileId ? { profile_id: profileId } : {}),
    ...(groupId ? { group_id: groupId } : {}),
    name: b.name,
    estimated_amount: b.estimated_amount,
    cumulated_savings: b.cumulated_savings ?? 0,
    is_monthly_recurring: false,
  }))

  const { data, error } = await supabaseServer
    .from('estimated_budgets')
    .insert(rows)
    .select('id, name')

  if (error || !data) {
    errors.push(`insert budgets: ${error?.message ?? 'unknown'}`)
    return nameToId
  }

  for (const row of data) {
    nameToId.set(row.name, row.id)
  }
  return nameToId
}

async function insertExpenses(
  userId: string,
  groupId: string | null,
  expenses: ScenarioExpense[],
  budgetIds: Map<string, string>,
  errors: string[],
): Promise<number> {
  if (expenses.length === 0) return 0
  const now = new Date()
  const dateIso = now.toISOString().slice(0, 10)

  const rows: RealExpenseInsert[] = []
  for (const e of expenses) {
    const budgetId = budgetIds.get(e.budget_name)
    if (!budgetId) {
      errors.push(`expense skipped: budget '${e.budget_name}' not found`)
      continue
    }
    rows.push({
      ...(groupId ? { group_id: groupId } : { profile_id: userId }),
      created_by_profile_id: userId,
      estimated_budget_id: budgetId,
      amount: e.amount,
      amount_from_budget: e.amount,
      description: e.description ?? `Dépense ${e.budget_name}`,
      expense_date: dateIso,
      is_exceptional: false,
    })
  }

  if (rows.length === 0) return 0
  const { data, error } = await supabaseServer.from('real_expenses').insert(rows).select('id')
  if (error || !data) {
    errors.push(`insert expenses: ${error?.message ?? 'unknown'}`)
    return 0
  }
  return data.length
}

async function insertIncomes(
  profileId: string | null,
  groupId: string | null,
  incomes: ScenarioIncome[],
  errors: string[],
): Promise<number> {
  if (incomes.length === 0) return 0
  const rows: EstimatedIncomeInsert[] = incomes.map((i) => ({
    ...(profileId ? { profile_id: profileId } : {}),
    ...(groupId ? { group_id: groupId } : {}),
    name: i.name,
    estimated_amount: i.estimated_amount,
    is_monthly_recurring: true,
  }))

  const { data, error } = await supabaseServer.from('estimated_incomes').insert(rows).select('id')
  if (error || !data) {
    errors.push(`insert incomes: ${error?.message ?? 'unknown'}`)
    return 0
  }
  return data.length
}

async function insertRealIncomes(
  userId: string,
  groupId: string | null,
  realIncomes: ScenarioRealIncome[],
  errors: string[],
): Promise<number> {
  if (realIncomes.length === 0) return 0
  const dateIso = new Date().toISOString().slice(0, 10)

  const rows: RealIncomeInsert[] = realIncomes.map((r) => ({
    ...(groupId ? { group_id: groupId } : { profile_id: userId }),
    created_by_profile_id: userId,
    amount: r.amount,
    description: r.description ?? 'Revenu',
    entry_date: dateIso,
    is_exceptional: r.is_exceptional ?? false,
  }))

  const { data, error } = await supabaseServer.from('real_income_entries').insert(rows).select('id')
  if (error || !data) {
    errors.push(`insert real incomes: ${error?.message ?? 'unknown'}`)
    return 0
  }
  return data.length
}

async function upsertPiggyBankProfile(
  userId: string,
  amount: number,
  errors: string[],
): Promise<void> {
  await supabaseServer.from('piggy_bank').delete().eq('profile_id', userId)
  const { error } = await supabaseServer.from('piggy_bank').insert({
    profile_id: userId,
    amount,
    last_updated: new Date().toISOString(),
  })
  if (error) errors.push(`upsert piggy profile: ${error.message}`)
}

async function upsertPiggyBankGroup(
  groupId: string,
  amount: number,
  errors: string[],
): Promise<void> {
  await supabaseServer.from('piggy_bank').delete().eq('group_id', groupId)
  const { error } = await supabaseServer.from('piggy_bank').insert({
    group_id: groupId,
    amount,
    last_updated: new Date().toISOString(),
  })
  if (error) errors.push(`upsert piggy group: ${error.message}`)
}

async function upsertBankBalanceProfile(
  userId: string,
  balance: number,
  remainingToLive: number,
  errors: string[],
): Promise<void> {
  await supabaseServer.from('bank_balances').delete().eq('profile_id', userId)
  const { error } = await supabaseServer.from('bank_balances').insert({
    profile_id: userId,
    balance,
    current_remaining_to_live: remainingToLive,
    updated_at: new Date().toISOString(),
  })
  if (error) errors.push(`upsert bank profile: ${error.message}`)
}
