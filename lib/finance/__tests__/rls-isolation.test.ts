import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Database } from '@/lib/database'

const RLS_TESTS_ENABLED = process.env.SUPABASE_RLS_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!RLS_TESTS_ENABLED)('RLS isolation (Sprint DB D1-D3)', () => {
  let admin: SupabaseClient<Database>
  let userAId: string
  let userBId: string
  let clientA: SupabaseClient<Database>
  let clientB: SupabaseClient<Database>
  let groupAId: string

  const stamp = Date.now()
  const emailA = `rls-test-a-${stamp}@popoth.test`
  const emailB = `rls-test-b-${stamp}@popoth.test`
  const passwordA = `rls-A-${randomUUID()}`
  const passwordB = `rls-B-${randomUUID()}`

  async function buildClientForUser(email: string, password: string): Promise<SupabaseClient<Database>> {
    const tmp = createClient<Database>(SUPABASE_URL!, ANON_KEY!)
    const { data, error } = await tmp.auth.signInWithPassword({ email, password })
    if (error || !data.session) throw error ?? new Error('signInWithPassword returned no session')
    return createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      global: {
        headers: { Authorization: `Bearer ${data.session.access_token}` }
      },
      auth: { autoRefreshToken: false, persistSession: false }
    })
  }

  beforeAll(async () => {
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
      throw new Error(
        'RLS tests require NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY'
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const created = await Promise.all([
      admin.auth.admin.createUser({ email: emailA, password: passwordA, email_confirm: true }),
      admin.auth.admin.createUser({ email: emailB, password: passwordB, email_confirm: true })
    ])
    if (created[0].error || !created[0].data.user) throw created[0].error
    if (created[1].error || !created[1].data.user) throw created[1].error
    userAId = created[0].data.user.id
    userBId = created[1].data.user.id

    clientA = await buildClientForUser(emailA, passwordA)
    clientB = await buildClientForUser(emailB, passwordB)

    // D2 fixture: userA is a member of a test group; userB is unaffiliated.
    // The group_contributions policy (Sprint DB / D2) allows access only to
    // rows whose group_id matches the caller's profiles.group_id. The group
    // is created first because the profiles row needs a valid group_id FK.
    const { data: createdGroup, error: groupError } = await admin
      .from('groups')
      .insert({
        name: `rls-test-group-${stamp}`,
        monthly_budget_estimate: 0,
        creator_id: userAId,
      })
      .select('id')
      .single()
    if (groupError || !createdGroup) throw groupError ?? new Error('group insert returned no row')
    groupAId = createdGroup.id

    // profiles must exist before piggy_bank / group_contributions inserts
    // because both tables FK on profiles(id). We upsert here in case a
    // Supabase trigger has already created stub rows.
    const { error: profilesError } = await admin
      .from('profiles')
      .upsert(
        [
          { id: userAId, first_name: 'RLS', last_name: 'A', group_id: groupAId },
          { id: userBId, first_name: 'RLS', last_name: 'B', group_id: null },
        ],
        { onConflict: 'id' }
      )
    if (profilesError) throw profilesError

    const { error: seedError } = await admin
      .from('piggy_bank')
      .insert({ profile_id: userAId, group_id: null, amount: 100 })
    if (seedError) throw seedError

    // Upsert (not insert) because a trigger may have already created a
    // contributions row when userA's profile bound to groupAId. The unique
    // constraint group_contributions_unique_profile_group enforces one row
    // per (profile_id, group_id).
    const { error: contribError } = await admin
      .from('group_contributions')
      .upsert(
        {
          profile_id: userAId,
          group_id: groupAId,
          salary: 1000,
          contribution_amount: 100,
          contribution_percentage: 10,
        },
        { onConflict: 'profile_id,group_id' }
      )
    if (contribError) throw contribError
  })

  afterAll(async () => {
    if (groupAId) {
      // group_contributions rows cascade with the group, but be explicit so
      // the test is robust if FK behaviour changes.
      await admin.from('group_contributions').delete().eq('group_id', groupAId)
      await admin.from('groups').delete().eq('id', groupAId)
    }
    if (userAId) {
      await admin.from('piggy_bank').delete().eq('profile_id', userAId)
      // Clear group_id on the profile so the user delete cascade does not
      // hit the dangling group reference.
      await admin.from('profiles').update({ group_id: null }).eq('id', userAId)
      await admin.auth.admin.deleteUser(userAId)
    }
    if (userBId) {
      await admin.auth.admin.deleteUser(userBId)
    }
  })

  it('D1 piggy_bank: owner sees their row', async () => {
    const { data, error } = await clientA
      .from('piggy_bank')
      .select('profile_id, amount')
      .eq('profile_id', userAId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.amount).toBe(100)
  })

  it('D1 piggy_bank: non-owner sees nothing when probing another user', async () => {
    const { data, error } = await clientB
      .from('piggy_bank')
      .select('profile_id, amount')
      .eq('profile_id', userAId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('D1 piggy_bank: non-owner UPDATE affects zero rows', async () => {
    const { data, error } = await clientB
      .from('piggy_bank')
      .update({ amount: 9999 })
      .eq('profile_id', userAId)
      .select()
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)

    const { data: verify } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', userAId)
      .single()
    expect(verify?.amount).toBe(100)
  })

  it('D2 group_contributions: member sees their group rows', async () => {
    const { data, error } = await clientA
      .from('group_contributions')
      .select('group_id, profile_id, contribution_amount')
      .eq('group_id', groupAId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.profile_id).toBe(userAId)
    expect(data?.[0]?.contribution_amount).toBe(100)
  })

  it('D2 group_contributions: non-member sees zero rows of another group', async () => {
    const { data, error } = await clientB
      .from('group_contributions')
      .select('group_id, profile_id, contribution_amount')
      .eq('group_id', groupAId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it('D3 remaining_to_live_snapshots: authenticated INSERT is rejected', async () => {
    const { data, error } = await clientA
      .from('remaining_to_live_snapshots')
      .insert({
        profile_id: userAId,
        group_id: null,
        remaining_to_live: 0,
        available_balance: 0,
        total_savings: 0,
        total_estimated_income: 0,
        total_estimated_budgets: 0,
        total_real_income: 0,
        total_real_expenses: 0,
        snapshot_reason: 'rls-test',
      })
      .select()

    // Two valid policy outcomes: either the INSERT is silently filtered
    // (RLS hides it, returning a permission denied error or empty rows)
    // or postgres returns a 42501 / "new row violates row-level security"
    // error. Both prove the snapshot path is service-role-only.
    const rejected = (error !== null) || ((data ?? []).length === 0)
    expect(rejected).toBe(true)

    // Verify the row really did not land — service role count for the
    // sentinel reason should be zero.
    const { data: leak } = await admin
      .from('remaining_to_live_snapshots')
      .select('id')
      .eq('snapshot_reason', 'rls-test')
    expect(leak ?? []).toHaveLength(0)
  })
})
