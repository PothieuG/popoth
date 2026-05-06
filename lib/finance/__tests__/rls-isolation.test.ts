import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const RLS_TESTS_ENABLED = process.env.SUPABASE_RLS_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!RLS_TESTS_ENABLED)('RLS isolation (Sprint DB D1-D3)', () => {
  let admin: SupabaseClient
  let userAId: string
  let userBId: string
  let clientA: SupabaseClient
  let clientB: SupabaseClient

  const stamp = Date.now()
  const emailA = `rls-test-a-${stamp}@popoth.test`
  const emailB = `rls-test-b-${stamp}@popoth.test`
  const passwordA = `rls-A-${randomUUID()}`
  const passwordB = `rls-B-${randomUUID()}`

  async function buildClientForUser(email: string, password: string): Promise<SupabaseClient> {
    const tmp = createClient(SUPABASE_URL!, ANON_KEY!)
    const { data, error } = await tmp.auth.signInWithPassword({ email, password })
    if (error || !data.session) throw error ?? new Error('signInWithPassword returned no session')
    return createClient(SUPABASE_URL!, ANON_KEY!, {
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
    admin = createClient(SUPABASE_URL, SERVICE_KEY, {
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

    const { error: seedError } = await admin
      .from('piggy_bank')
      .insert({ profile_id: userAId, group_id: null, amount: 100 })
    if (seedError) throw seedError
  })

  afterAll(async () => {
    if (userAId) {
      await admin.from('piggy_bank').delete().eq('profile_id', userAId)
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

  // D2 group_contributions and D3 remaining_to_live_snapshots assertions require
  // the baseline schema (column names, NOT NULL set) which lands in commit 2.
  // Marking as todo until then; manual verification via Studio is acceptable in
  // the meantime per the post-migration audit query in RLS-FINDINGS.md.
  it.todo('D2 group_contributions: non-member sees zero rows of another group')
  it.todo('D3 remaining_to_live_snapshots: authenticated INSERT is rejected')
})
