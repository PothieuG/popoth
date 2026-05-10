import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Database } from '@/lib/database.types'

// Sprint Audit-Functions-v2 / B2 — gated behavior tests for the 4 trigger
// functions captured in supabase/migrations/20260512000000_capture_trigger_functions.sql.
// db:check-functions only verifies presence in pg_proc, not behavior — a stub
// like `BEGIN RETURN NEW; END;` would pass that check while silently breaking
// auto-creation of group_contributions. These tests exercise the side-effects
// end-to-end against staging.
//
// Pattern mirrors lib/__tests__/api-regressions.test.ts (gating, fixture
// creation, cascade cleanup). No dynamic-import of @/lib/* needed here —
// only @supabase/supabase-js + raw SQL via .from()/.update().

const ENABLED = process.env.SUPABASE_TRIGGER_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('trigger behavior (Sprint Audit-Functions-v2 B2)', () => {
  let admin: SupabaseClient<Database>
  let userId1: string
  let userId2: string
  let groupId: string
  // Sprint 2-followup-v3 / Item 1 — secondary group used by Case 5 to verify
  // FK ON DELETE SET NULL on profiles.group_id. Tracked at describe scope so
  // afterAll can clean it up if the test fails before its DELETE.
  let groupId2: string | null = null

  const stamp = Date.now()
  const email1 = `audit-functions-v2-b2-1-${stamp}@popoth.test`
  const email2 = `audit-functions-v2-b2-2-${stamp}@popoth.test`
  const password = `b2-${randomUUID()}`

  // Salaries chosen so proportional contributions diverge from equal split.
  const SALARY_1 = 1000
  const SALARY_2 = 2000
  const INITIAL_BUDGET = 300
  const DOUBLED_BUDGET = 600

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Trigger behavior tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: u1, error: e1 } = await admin.auth.admin.createUser({
      email: email1,
      password,
      email_confirm: true,
    })
    if (e1 || !u1.user) throw e1 ?? new Error('createUser 1 failed')
    userId1 = u1.user.id

    const { data: u2, error: e2 } = await admin.auth.admin.createUser({
      email: email2,
      password,
      email_confirm: true,
    })
    if (e2 || !u2.user) throw e2 ?? new Error('createUser 2 failed')
    userId2 = u2.user.id

    const { error: pErr } = await admin.from('profiles').insert([
      { id: userId1, first_name: 'B2', last_name: 'Member1', salary: SALARY_1 },
      { id: userId2, first_name: 'B2', last_name: 'Member2', salary: SALARY_2 },
    ])
    if (pErr) throw pErr

    const { error: bErr } = await admin.from('bank_balances').insert({
      profile_id: userId1,
      group_id: null,
      balance: 100,
    })
    if (bErr) throw bErr

    const { data: g, error: gErr } = await admin
      .from('groups')
      .insert({
        name: `B2 Test Group ${stamp}`,
        monthly_budget_estimate: INITIAL_BUDGET,
        creator_id: userId1,
      })
      .select('id')
      .single()
    if (gErr || !g) throw gErr ?? new Error('group insert failed')
    groupId = g.id
  }, 30_000)

  afterAll(async () => {
    if (!admin) return
    // Order matters: child rows of profiles/groups before profiles before
    // auth.users (which cascades to profiles via Supabase auth FK).
    if (groupId) {
      await admin.from('group_contributions').delete().eq('group_id', groupId)
      await admin.from('groups').delete().eq('id', groupId)
    }
    if (groupId2) {
      await admin.from('group_contributions').delete().eq('group_id', groupId2)
      await admin.from('groups').delete().eq('id', groupId2)
    }
    if (userId1) {
      await admin.from('group_contributions').delete().eq('profile_id', userId1)
      await admin.from('bank_balances').delete().eq('profile_id', userId1)
      await admin.auth.admin.deleteUser(userId1)
    }
    if (userId2) {
      await admin.from('group_contributions').delete().eq('profile_id', userId2)
      await admin.auth.admin.deleteUser(userId2)
    }
  }, 30_000)

  // Case 1 — trigger_recalculate_contributions (AFTER UPDATE on profiles).
  // When a profile.group_id transitions NULL → set, the trigger calls
  // calculate_group_contributions which INSERTs a row in group_contributions.
  it('trigger_recalculate_contributions auto-creates a contribution on profile JOIN', async () => {
    const { error: updErr } = await admin
      .from('profiles')
      .update({ group_id: groupId })
      .eq('id', userId1)
    expect(updErr).toBeNull()

    const { data, error } = await admin
      .from('group_contributions')
      .select('profile_id, group_id, salary, contribution_amount')
      .eq('profile_id', userId1)
      .eq('group_id', groupId)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(Number(data?.[0]?.salary)).toBe(SALARY_1)
    // user1 alone in group → entire budget is their contribution.
    expect(Number(data?.[0]?.contribution_amount)).toBeCloseTo(INITIAL_BUDGET, 2)
  }, 30_000)

  // Case 2 — trigger_group_budget_change (AFTER UPDATE on groups).
  // After both members are joined, doubling the group budget should recompute
  // each member's contribution_amount. Asserts the value moved (without
  // pinning the formula — calculate_group_contributions split logic may
  // evolve).
  it('trigger_group_budget_change recalcs contributions when budget changes', async () => {
    // Add user2 to the group (also fires trigger_recalculate_contributions,
    // which is fine — we just need the row in place before the budget UPDATE).
    const { error: joinErr } = await admin
      .from('profiles')
      .update({ group_id: groupId })
      .eq('id', userId2)
    expect(joinErr).toBeNull()

    const { data: before, error: readErr } = await admin
      .from('group_contributions')
      .select('profile_id, contribution_amount')
      .eq('group_id', groupId)
      .order('profile_id', { ascending: true })
    expect(readErr).toBeNull()
    expect(before).toHaveLength(2)
    const beforeMap = new Map(before!.map((r) => [r.profile_id, Number(r.contribution_amount)]))

    const { error: budgetErr } = await admin
      .from('groups')
      .update({ monthly_budget_estimate: DOUBLED_BUDGET })
      .eq('id', groupId)
    expect(budgetErr).toBeNull()

    const { data: after, error: read2Err } = await admin
      .from('group_contributions')
      .select('profile_id, contribution_amount')
      .eq('group_id', groupId)
    expect(read2Err).toBeNull()
    expect(after).toHaveLength(2)
    for (const row of after!) {
      const oldAmount = beforeMap.get(row.profile_id)
      expect(oldAmount).toBeDefined()
      expect(Number(row.contribution_amount)).not.toBe(oldAmount)
    }

    // Sum should equal the new budget (proportional split conserves total).
    const total = after!.reduce((s, r) => s + Number(r.contribution_amount), 0)
    expect(total).toBeCloseTo(DOUBLED_BUDGET, 2)
  }, 30_000)

  // Case 3 — cleanup_group_contributions (BEFORE DELETE on groups).
  // Deleting a group must wipe all dependent group_contributions rows
  // (no FK CASCADE on this table — the trigger does the cleanup).
  it('cleanup_group_contributions wipes contributions when the group is deleted', async () => {
    const { error: delErr } = await admin.from('groups').delete().eq('id', groupId)
    expect(delErr).toBeNull()

    const { data, error } = await admin
      .from('group_contributions')
      .select('id')
      .eq('group_id', groupId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)

    // Mark groupId so afterAll skips the redundant DELETE.
    groupId = ''
  }, 30_000)

  // Case 4 — update_updated_at_column (BEFORE UPDATE on bank_balances).
  // Touches updated_at on every UPDATE, regardless of which column changed.
  it('update_updated_at_column advances bank_balances.updated_at on UPDATE', async () => {
    const { data: before, error: readErr } = await admin
      .from('bank_balances')
      .select('balance, updated_at')
      .eq('profile_id', userId1)
      .single()
    expect(readErr).toBeNull()
    const beforeTs = new Date(before!.updated_at!).getTime()

    // Tiny pause so now() in the trigger ticks past the read timestamp.
    // PG now() is microsecond-precision but rounds to JS millisecond on the
    // wire; a 50ms gap eliminates flakiness without being slow.
    await new Promise((r) => setTimeout(r, 50))

    const { error: updErr } = await admin
      .from('bank_balances')
      .update({ balance: Number(before!.balance) + 1 })
      .eq('profile_id', userId1)
    expect(updErr).toBeNull()

    const { data: after, error: read2Err } = await admin
      .from('bank_balances')
      .select('updated_at')
      .eq('profile_id', userId1)
      .single()
    expect(read2Err).toBeNull()
    const afterTs = new Date(after!.updated_at!).getTime()

    expect(afterTs).toBeGreaterThan(beforeTs)
  }, 30_000)

  // Case 5 — Sprint 2-followup-v3 / Item 1.
  // Regression guard for the FK profiles_group_id_fkey ON DELETE SET NULL.
  // Not a trigger function strictly speaking, but lives in this file because
  // it covers the same surface (what happens when a group is deleted).
  // Pivot story: Sprint v3 originally proposed a BEFORE DELETE trigger to
  // null profiles.group_id on group deletion - investigation found the FK
  // already does this, so the trigger was dropped (see migration
  // 20260515000001_drop_redundant_group_members_trigger.sql). This test
  // pins the FK behavior so a future schema change that drops or alters the
  // FK action surfaces in CI.
  it('FK ON DELETE SET NULL nulls profiles.group_id when group is deleted', async () => {
    // Cases 1-3 left both users with profiles.group_id = NULL (Case 3 deleted
    // the seed group, FK SET NULL fired). Re-create a fresh group + JOIN.
    const { data: g, error: gErr } = await admin
      .from('groups')
      .insert({
        name: `B2 v3 Test Group ${stamp}`,
        monthly_budget_estimate: 200,
        creator_id: userId1,
      })
      .select('id')
      .single()
    expect(gErr).toBeNull()
    expect(g).toBeTruthy()
    groupId2 = g!.id

    const { error: j1Err } = await admin
      .from('profiles')
      .update({ group_id: groupId2 })
      .eq('id', userId1)
    expect(j1Err).toBeNull()
    const { error: j2Err } = await admin
      .from('profiles')
      .update({ group_id: groupId2 })
      .eq('id', userId2)
    expect(j2Err).toBeNull()

    // Sanity: both members joined.
    const { data: pre, error: preErr } = await admin
      .from('profiles')
      .select('id, group_id')
      .in('id', [userId1, userId2])
    expect(preErr).toBeNull()
    for (const row of pre!) {
      expect(row.group_id).toBe(groupId2)
    }

    // Action: delete the group. FK ON DELETE SET NULL should fire.
    const { error: delErr } = await admin.from('groups').delete().eq('id', groupId2!)
    expect(delErr).toBeNull()

    // Assert: both profiles.group_id back to NULL.
    const { data: post, error: postErr } = await admin
      .from('profiles')
      .select('id, group_id')
      .in('id', [userId1, userId2])
    expect(postErr).toBeNull()
    expect(post).toHaveLength(2)
    for (const row of post!) {
      expect(row.group_id).toBeNull()
    }

    // Mark groupId2 cleared so afterAll skips the redundant DELETE.
    groupId2 = null
  }, 30_000)
})
