import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

// Sprint Salary-Edit-Gating (2026-05-25) — gated tests for isPlannerEmpty +
// canEditSalary. Pattern miroir toggle-applied-to-balance : dynamic import
// in beforeAll, FK-safe cleanup cascade.
//
// Le helper scope solo regarde uniquement les 4 tables planificateur
// filtrées profile_id. Le helper scope group regarde profile_id OR group_id
// (les deux scopes doivent être vides pour autoriser l'édition du salaire).

type PlannerMod = typeof import('@/lib/finance/planner-emptiness')

const ENABLED = process.env.SUPABASE_FINANCE_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('planner-emptiness (Sprint Salary-Edit-Gating)', () => {
  let admin: SupabaseClient<Database>
  let isPlannerEmpty: PlannerMod['isPlannerEmpty']
  let canEditSalary: PlannerMod['canEditSalary']

  let soloUserId: string
  let groupUserId: string
  let otherGroupUserId: string // 2e membre du groupe pour valider l'iso multi-membre
  let groupId: string

  const stamp = Date.now()
  const soloEmail = `planner-solo-${stamp}@popoth.test`
  const groupEmail = `planner-group-${stamp}@popoth.test`
  const otherEmail = `planner-other-${stamp}@popoth.test`

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'planner-emptiness tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const mod = await import('@/lib/finance/planner-emptiness')
    isPlannerEmpty = mod.isPlannerEmpty
    canEditSalary = mod.canEditSalary

    const [solo, ingroup, other] = await Promise.all([
      admin.auth.admin.createUser({
        email: soloEmail,
        password: randomUUID(),
        email_confirm: true,
      }),
      admin.auth.admin.createUser({
        email: groupEmail,
        password: randomUUID(),
        email_confirm: true,
      }),
      admin.auth.admin.createUser({
        email: otherEmail,
        password: randomUUID(),
        email_confirm: true,
      }),
    ])
    if (solo.error || !solo.data.user) throw solo.error ?? new Error('createUser solo failed')
    if (ingroup.error || !ingroup.data.user)
      throw ingroup.error ?? new Error('createUser group failed')
    if (other.error || !other.data.user) throw other.error ?? new Error('createUser other failed')
    soloUserId = solo.data.user.id
    groupUserId = ingroup.data.user.id
    otherGroupUserId = other.data.user.id

    const { data: group, error: groupErr } = await admin
      .from('groups')
      .insert({
        name: `planner-group-${stamp}`,
        monthly_budget_estimate: 0,
        creator_id: groupUserId,
      })
      .select('id')
      .single()
    if (groupErr || !group) throw groupErr ?? new Error('group insert failed')
    groupId = group.id

    const { error: profErr } = await admin.from('profiles').insert([
      { id: soloUserId, first_name: 'Solo', last_name: 'Test', salary: 1000 },
      { id: groupUserId, first_name: 'Group', last_name: 'Test', salary: 1000, group_id: groupId },
      {
        id: otherGroupUserId,
        first_name: 'Other',
        last_name: 'Test',
        salary: 1000,
        group_id: groupId,
      },
    ])
    if (profErr) throw profErr
  }, 30_000)

  afterAll(async () => {
    if (!admin) return
    // FK-safe cleanup cascade. Profiles ON DELETE CASCADE pour la plupart des
    // tables planificateur, mais on purge explicitement par sécurité.
    const profileIds = [soloUserId, groupUserId, otherGroupUserId].filter(Boolean)
    if (profileIds.length === 0) return

    await admin.from('real_expenses').delete().in('profile_id', profileIds)
    await admin.from('real_expenses').delete().eq('group_id', groupId)
    await admin.from('real_income_entries').delete().in('profile_id', profileIds)
    await admin.from('real_income_entries').delete().eq('group_id', groupId)
    await admin.from('estimated_budgets').delete().in('profile_id', profileIds)
    await admin.from('estimated_budgets').delete().eq('group_id', groupId)
    await admin.from('estimated_incomes').delete().in('profile_id', profileIds)
    await admin.from('estimated_incomes').delete().eq('group_id', groupId)
    // Detach profiles from group so groups DELETE doesn't FK-block
    await admin.from('profiles').update({ group_id: null }).in('id', profileIds)
    await admin.from('groups').delete().eq('id', groupId)
    for (const uid of profileIds) {
      await admin.auth.admin.deleteUser(uid)
    }
  }, 30_000)

  afterEach(async () => {
    // Wipe planner rows between tests so each one starts vierge.
    const profileIds = [soloUserId, groupUserId, otherGroupUserId]
    await admin.from('real_expenses').delete().in('profile_id', profileIds)
    await admin.from('real_expenses').delete().eq('group_id', groupId)
    await admin.from('real_income_entries').delete().in('profile_id', profileIds)
    await admin.from('real_income_entries').delete().eq('group_id', groupId)
    await admin.from('estimated_budgets').delete().in('profile_id', profileIds)
    await admin.from('estimated_budgets').delete().eq('group_id', groupId)
    await admin.from('estimated_incomes').delete().in('profile_id', profileIds)
    await admin.from('estimated_incomes').delete().eq('group_id', groupId)
  })

  describe('isPlannerEmpty — solo scope', () => {
    it('returns true when profile has 0 rows in all 4 tables', async () => {
      const empty = await isPlannerEmpty({ type: 'profile', profileId: soloUserId })
      expect(empty).toBe(true)
    })

    it('returns false when profile has 1 estimated_budget', async () => {
      const { error } = await admin
        .from('estimated_budgets')
        .insert({ profile_id: soloUserId, name: 'Test budget', estimated_amount: 100 })
      if (error) throw error

      const empty = await isPlannerEmpty({ type: 'profile', profileId: soloUserId })
      expect(empty).toBe(false)
    })

    it('returns false when profile has 1 estimated_income', async () => {
      const { error } = await admin
        .from('estimated_incomes')
        .insert({ profile_id: soloUserId, name: 'Test income', estimated_amount: 200 })
      if (error) throw error

      const empty = await isPlannerEmpty({ type: 'profile', profileId: soloUserId })
      expect(empty).toBe(false)
    })

    it('returns false when profile has 1 real_expense', async () => {
      const { error } = await admin.from('real_expenses').insert({
        profile_id: soloUserId,
        amount: 50,
        description: 'Test expense',
        expense_date: '2026-05-25',
        is_exceptional: true,
      })
      if (error) throw error

      const empty = await isPlannerEmpty({ type: 'profile', profileId: soloUserId })
      expect(empty).toBe(false)
    })

    it('returns false when profile has 1 real_income_entry', async () => {
      const { error } = await admin.from('real_income_entries').insert({
        profile_id: soloUserId,
        amount: 300,
        description: 'Test income entry',
        entry_date: '2026-05-25',
        is_exceptional: true,
      })
      if (error) throw error

      const empty = await isPlannerEmpty({ type: 'profile', profileId: soloUserId })
      expect(empty).toBe(false)
    })
  })

  describe('isPlannerEmpty — group scope (checks perso + groupe)', () => {
    it('returns true when both perso and group have 0 rows', async () => {
      const empty = await isPlannerEmpty({
        type: 'group',
        profileId: groupUserId,
        groupId,
      })
      expect(empty).toBe(true)
    })

    it('returns false when user has a personal estimated_budget (group empty)', async () => {
      const { error } = await admin
        .from('estimated_budgets')
        .insert({ profile_id: groupUserId, name: 'Perso budget', estimated_amount: 100 })
      if (error) throw error

      const empty = await isPlannerEmpty({
        type: 'group',
        profileId: groupUserId,
        groupId,
      })
      expect(empty).toBe(false)
    })

    it('returns false when group has an estimated_budget (perso empty)', async () => {
      const { error } = await admin
        .from('estimated_budgets')
        .insert({ group_id: groupId, name: 'Group budget', estimated_amount: 100 })
      if (error) throw error

      const empty = await isPlannerEmpty({
        type: 'group',
        profileId: groupUserId,
        groupId,
      })
      expect(empty).toBe(false)
    })

    it('returns false when another group member has a real_expense (scope checks groupe)', async () => {
      // Insert via the otherGroupUserId — under group scope, this row counts
      // via group_id match. (En réalité, real_expenses pour un membre se font
      // sous profile_id du membre, pas group_id. Donc on simule une dépense
      // groupe avec group_id.)
      const { error } = await admin.from('real_expenses').insert({
        group_id: groupId,
        amount: 25,
        description: 'Group expense',
        expense_date: '2026-05-25',
        is_exceptional: true,
      })
      if (error) throw error

      const empty = await isPlannerEmpty({
        type: 'group',
        profileId: groupUserId,
        groupId,
      })
      expect(empty).toBe(false)
    })

    it("doesn't pick up another user's solo data when scoped to group", async () => {
      // Solo user has a budget, but the group scope should ignore it (different profile_id, no group_id).
      const { error } = await admin
        .from('estimated_budgets')
        .insert({ profile_id: soloUserId, name: 'Solo unrelated', estimated_amount: 999 })
      if (error) throw error

      const empty = await isPlannerEmpty({
        type: 'group',
        profileId: groupUserId,
        groupId,
      })
      expect(empty).toBe(true)
    })
  })

  describe('canEditSalary — wraps scope selection by profile.group_id', () => {
    it('uses profile scope when group_id is null', async () => {
      // Add a row to group budget → does NOT block solo user (different scope)
      const { error } = await admin
        .from('estimated_budgets')
        .insert({ group_id: groupId, name: 'Unrelated group budget', estimated_amount: 100 })
      if (error) throw error

      const decision = await canEditSalary({ id: soloUserId, group_id: null })
      expect(decision.editable).toBe(true)
      expect(decision.reason).toBeNull()
    })

    it('uses group scope when group_id is non-null and detects group data', async () => {
      const { error } = await admin
        .from('estimated_budgets')
        .insert({ group_id: groupId, name: 'Blocking group budget', estimated_amount: 100 })
      if (error) throw error

      const decision = await canEditSalary({ id: groupUserId, group_id: groupId })
      expect(decision.editable).toBe(false)
      expect(decision.reason).toBe('planner-not-empty')
    })

    it('returns editable=true when in group but both scopes empty', async () => {
      const decision = await canEditSalary({ id: groupUserId, group_id: groupId })
      expect(decision.editable).toBe(true)
      expect(decision.reason).toBeNull()
    })
  })
})
