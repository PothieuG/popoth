import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Database } from '@/lib/database.types'

// Feature "Contribution au groupe — dépense virtuelle perso" (2026-05-28)
//
// Tests gated SUPABASE_TRIGGER_TESTS=1 pour couvrir :
//   1. sync_contribution_real_expense (AFTER INSERT/UPDATE on group_contributions)
//      → upsert real_expenses, idempotence, déclencheur sur change amount.
//   2. credit_balance_on_contribution_delete (BEFORE DELETE on real_expenses)
//      → restitution solde si applied au moment de la suppression.
//   3. toggle_real_expense_applied_to_balance — branche drift re-validate
//      (apply quand déjà applied + amount changé via trigger).
//
// Pattern miroir lib/__tests__/trigger-behavior.test.ts : SUPABASE_TRIGGER_TESTS
// gating, FK-safe cleanup cascade dans afterAll.

const ENABLED = process.env.SUPABASE_TRIGGER_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('contribution real_expense trigger + drift RPC', () => {
  let admin: SupabaseClient<Database>
  const stamp = Date.now()
  const email = `contrib-trigger-${stamp}@popoth.test`
  const password = `contrib-${randomUUID()}`
  let userId: string
  let groupId: string
  let budgetId: string

  const SALARY = 1500
  const INITIAL_BUDGET = 500 // → contribution single-member = 500
  const BUMPED_BUDGET = 800 // → contribution = 800 (drift +300)
  const INITIAL_BALANCE = 2000

  async function readBalance(): Promise<number> {
    const { data, error } = await admin
      .from('bank_balances')
      .select('balance')
      .eq('profile_id', userId)
      .is('group_id', null)
      .single()
    if (error) throw error
    return Number(data?.balance)
  }

  async function getContributionRow() {
    const { data, error } = await admin
      .from('group_contributions')
      .select('id, contribution_amount')
      .eq('profile_id', userId)
      .eq('group_id', groupId)
      .single()
    if (error) throw error
    return data
  }

  async function getRealExpenseRow() {
    const { data } = await admin
      .from('real_expenses')
      .select('id, amount, description, is_exceptional, applied_to_balance_at, last_applied_amount')
      .eq('profile_id', userId)
      .not('contribution_id', 'is', null)
      .maybeSingle()
    return data
  }

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'contribution trigger tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    userId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: userId,
      first_name: 'ContribTrigger',
      last_name: 'Fixture',
      salary: SALARY,
    })
    if (profErr) throw profErr

    const { error: bankErr } = await admin.from('bank_balances').insert({
      profile_id: userId,
      group_id: null,
      balance: INITIAL_BALANCE,
    })
    if (bankErr) throw bankErr

    const { data: groupRow, error: gErr } = await admin
      .from('groups')
      .insert({
        name: `ContribGroup-${stamp}`,
        creator_id: userId,
        monthly_budget_estimate: 0, // sera auto-syncé par trigger budget
      })
      .select('id')
      .single()
    if (gErr || !groupRow) throw gErr ?? new Error('insert group failed')
    groupId = groupRow.id

    const { error: linkErr } = await admin
      .from('profiles')
      .update({ group_id: groupId })
      .eq('id', userId)
    if (linkErr) throw linkErr

    const { data: budgetRow, error: bErr } = await admin
      .from('estimated_budgets')
      .insert({
        profile_id: null,
        group_id: groupId,
        name: 'Contrib test budget',
        estimated_amount: INITIAL_BUDGET,
      })
      .select('id')
      .single()
    if (bErr || !budgetRow) throw bErr ?? new Error('insert budget failed')
    budgetId = budgetRow.id
  }, 60_000)

  afterAll(async () => {
    if (!admin || !userId) return
    // CASCADE depuis group_contributions DELETE → real_expenses contribution
    // row supprimée par le trigger BEFORE DELETE (qui restituera le solde si
    // appliquée). On nettoie ensuite manuellement le reste.
    await admin.from('estimated_budgets').delete().eq('group_id', groupId)
    await admin.from('group_contributions').delete().eq('group_id', groupId)
    await admin.from('profiles').update({ group_id: null }).eq('id', userId)
    await admin.from('real_expenses').delete().eq('profile_id', userId)
    await admin.from('groups').delete().eq('id', groupId)
    await admin.from('bank_balances').delete().eq('profile_id', userId)
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
  }, 60_000)

  it('1. trigger crée la row real_expenses contribution au join + budget initial', async () => {
    // Setup : user a été lié au groupe + budget initial inséré → triggers
    // calculate_group_contributions + sync_contribution_real_expense ont fire.
    const contrib = await getContributionRow()
    expect(contrib.contribution_amount).toBe(INITIAL_BUDGET)

    const re = await getRealExpenseRow()
    expect(re).not.toBeNull()
    expect(re!.amount).toBe(INITIAL_BUDGET)
    expect(re!.is_exceptional).toBe(true)
    expect(re!.applied_to_balance_at).toBeNull()
    expect(re!.last_applied_amount).toBeNull()
    expect(re!.description).toBe(`Contribution au groupe ContribGroup-${stamp}`)
  }, 30_000)

  it('2. UPDATE budget → trigger UPDATE amount, préserve applied_at + last_applied_amount', async () => {
    // Pré-condition : on valide d'abord la row au montant initial pour pouvoir
    // tester la préservation à l'update.
    const re = (await getRealExpenseRow())!
    const { error: rpcErr } = await admin.rpc('toggle_real_expense_applied_to_balance', {
      p_expense_id: re.id,
      p_apply: true,
    })
    expect(rpcErr).toBeNull()

    const afterApply = (await getRealExpenseRow())!
    expect(afterApply.applied_to_balance_at).not.toBeNull()
    expect(Number(afterApply.last_applied_amount)).toBe(INITIAL_BUDGET)

    // Bump budget → trigger sync_group_monthly_budget_estimate → recalc
    // contributions → sync_contribution_real_expense UPDATE.
    const { error: bumpErr } = await admin
      .from('estimated_budgets')
      .update({ estimated_amount: BUMPED_BUDGET })
      .eq('id', budgetId)
    expect(bumpErr).toBeNull()

    const afterBump = (await getRealExpenseRow())!
    expect(Number(afterBump.amount)).toBe(BUMPED_BUDGET) // amount mis à jour
    expect(afterBump.applied_to_balance_at).not.toBeNull() // applied_at préservé
    expect(Number(afterBump.last_applied_amount)).toBe(INITIAL_BUDGET) // last_applied préservé → drift
  }, 30_000)

  it('3. toggle apply en drift → balance ajustée du delta, last_applied_amount mis à jour', async () => {
    const balanceBefore = await readBalance()
    const re = (await getRealExpenseRow())!
    expect(Number(re.amount)).toBe(BUMPED_BUDGET)
    expect(Number(re.last_applied_amount)).toBe(INITIAL_BUDGET)

    // Re-apply → delta = BUMPED - INITIAL = 300. Balance débitée de 300.
    const { error: rpcErr } = await admin.rpc('toggle_real_expense_applied_to_balance', {
      p_expense_id: re.id,
      p_apply: true,
    })
    expect(rpcErr).toBeNull()

    const balanceAfter = await readBalance()
    expect(balanceAfter).toBe(balanceBefore - (BUMPED_BUDGET - INITIAL_BUDGET))

    const afterReapply = (await getRealExpenseRow())!
    expect(Number(afterReapply.last_applied_amount)).toBe(BUMPED_BUDGET) // sync
  }, 30_000)

  it('4. toggle un-apply → balance créditée de last_applied_amount, fields reset', async () => {
    const balanceBefore = await readBalance()
    const re = (await getRealExpenseRow())!
    const lastAppliedBefore = Number(re.last_applied_amount)

    const { error: rpcErr } = await admin.rpc('toggle_real_expense_applied_to_balance', {
      p_expense_id: re.id,
      p_apply: false,
    })
    expect(rpcErr).toBeNull()

    const balanceAfter = await readBalance()
    expect(balanceAfter).toBe(balanceBefore + lastAppliedBefore)

    const after = (await getRealExpenseRow())!
    expect(after.applied_to_balance_at).toBeNull()
    expect(after.last_applied_amount).toBeNull()
  }, 30_000)

  it('5. delete group_contributions (cascade) → row supprimée + balance restituée si applied', async () => {
    // Re-apply la row pour avoir un état "applied" au moment du DELETE.
    const re = (await getRealExpenseRow())!
    const { error: applyErr } = await admin.rpc('toggle_real_expense_applied_to_balance', {
      p_expense_id: re.id,
      p_apply: true,
    })
    expect(applyErr).toBeNull()

    const balanceBefore = await readBalance()
    const applied = (await getRealExpenseRow())!
    const lastApplied = Number(applied.last_applied_amount)
    expect(lastApplied).toBeGreaterThan(0)

    // DELETE manuel de la group_contributions row → CASCADE supprime real_expenses
    // → trigger BEFORE DELETE crédite la balance.
    const contrib = await getContributionRow()
    const { error: delErr } = await admin.from('group_contributions').delete().eq('id', contrib.id)
    expect(delErr).toBeNull()

    const balanceAfter = await readBalance()
    expect(balanceAfter).toBe(balanceBefore + lastApplied)

    // La row real_expenses contribution n'existe plus.
    const afterDelete = await getRealExpenseRow()
    expect(afterDelete).toBeNull()
  }, 30_000)
})
