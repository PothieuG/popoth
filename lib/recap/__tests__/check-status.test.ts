import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Database } from '@/lib/database.types'

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

type CheckStatusFn = typeof import('@/lib/recap/check-status').checkRecapStatus
type ErrorClass = typeof import('@/lib/recap/check-status').RecapStatusError

describe.skipIf(!ENABLED)('checkRecapStatus V3 (gated)', () => {
  let admin: SupabaseClient<Database>
  let checkRecapStatus: CheckStatusFn
  let RecapStatusError: ErrorClass

  // userA: profile in groupA, will be the initiator in some fixtures
  // userB: profile in groupA, used to test 'locked_by_other'
  // userC: profile without group, used to test 'NO_GROUP'
  let userAId: string
  let userBId: string
  let userCId: string
  let groupAId: string

  const stamp = Date.now()
  const emailA = `recap-status-a-${stamp}@popoth.test`
  const emailB = `recap-status-b-${stamp}@popoth.test`
  const emailC = `recap-status-c-${stamp}@popoth.test`
  const passwordA = `recap-A-${randomUUID()}`
  const passwordB = `recap-B-${randomUUID()}`
  const passwordC = `recap-C-${randomUUID()}`

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Recap status tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    const mod = await import('@/lib/recap/check-status')
    checkRecapStatus = mod.checkRecapStatus
    RecapStatusError = mod.RecapStatusError

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const [a, b, c] = await Promise.all([
      admin.auth.admin.createUser({ email: emailA, password: passwordA, email_confirm: true }),
      admin.auth.admin.createUser({ email: emailB, password: passwordB, email_confirm: true }),
      admin.auth.admin.createUser({ email: emailC, password: passwordC, email_confirm: true }),
    ])
    if (a.error || !a.data.user) throw a.error
    if (b.error || !b.data.user) throw b.error
    if (c.error || !c.data.user) throw c.error
    userAId = a.data.user.id
    userBId = b.data.user.id
    userCId = c.data.user.id

    const { data: group, error: groupError } = await admin
      .from('groups')
      .insert({
        name: `recap-status-group-${stamp}`,
        monthly_budget_estimate: 0,
        creator_id: userAId,
      })
      .select('id')
      .single()
    if (groupError || !group) throw groupError ?? new Error('group insert returned no row')
    groupAId = group.id

    const { error: profilesError } = await admin.from('profiles').upsert(
      [
        { id: userAId, first_name: 'Alice', last_name: 'Aaaa', group_id: groupAId },
        { id: userBId, first_name: 'Bob', last_name: 'Bbbb', group_id: groupAId },
        { id: userCId, first_name: 'Carla', last_name: 'Cccc', group_id: null },
      ],
      { onConflict: 'id' },
    )
    if (profilesError) throw profilesError
  })

  afterAll(async () => {
    if (admin) {
      // Recaps cascade-delete on profile/group removal, but be explicit.
      if (userAId) await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
      if (groupAId) await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
      if (groupAId) await admin.from('groups').delete().eq('id', groupAId)
      // Null the FK before deleting auth users to avoid dangling group_id.
      if (userAId) await admin.from('profiles').update({ group_id: null }).eq('id', userAId)
      if (userBId) await admin.from('profiles').update({ group_id: null }).eq('id', userBId)
      if (userAId) await admin.auth.admin.deleteUser(userAId)
      if (userBId) await admin.auth.admin.deleteUser(userBId)
      if (userCId) await admin.auth.admin.deleteUser(userCId)
    }
  })

  // Helper: clean any recap row before each fixture so tests are independent.
  async function resetRecaps() {
    if (userAId) await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
    if (groupAId) await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
  }

  it('profile context: no row → kind=no_recap', async () => {
    await resetRecaps()
    const result = await checkRecapStatus(userAId, 'profile')
    expect(result.context).toBe('profile')
    expect(result.contextId).toBe(userAId)
    expect(result.currentMonth).toBe(currentMonth)
    expect(result.currentYear).toBe(currentYear)
    expect(result.status.kind).toBe('no_recap')
  })

  it('profile context: row in_progress with current_step=summary → kind=in_progress', async () => {
    await resetRecaps()
    const { data: row, error } = await admin
      .from('monthly_recaps')
      .insert({
        profile_id: userAId,
        recap_month: currentMonth,
        recap_year: currentYear,
        current_step: 'summary',
        started_by_profile_id: userAId,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(row).not.toBeNull()

    const result = await checkRecapStatus(userAId, 'profile')
    expect(result.status.kind).toBe('in_progress')
    if (result.status.kind !== 'in_progress') throw new Error('narrow failed')
    expect(result.status.step).toBe('summary')
    expect(result.status.startedByProfileId).toBe(userAId)
    expect(result.status.recapId).toBe(row!.id)
  })

  it('profile context: row with completed_at set → kind=completed', async () => {
    await resetRecaps()
    const completedAt = new Date().toISOString()
    const { data: row } = await admin
      .from('monthly_recaps')
      .insert({
        profile_id: userAId,
        recap_month: currentMonth,
        recap_year: currentYear,
        current_step: 'completed',
        started_by_profile_id: userAId,
        started_at: completedAt,
        completed_at: completedAt,
      })
      .select('id')
      .single()

    const result = await checkRecapStatus(userAId, 'profile')
    expect(result.status.kind).toBe('completed')
    if (result.status.kind !== 'completed') throw new Error('narrow failed')
    expect(result.status.recapId).toBe(row!.id)
    expect(result.status.completedAt).toBe(completedAt)
  })

  it('profile context: orphan row (started_by NULL) → kind=no_recap', async () => {
    await resetRecaps()
    await admin
      .from('monthly_recaps')
      .insert({
        profile_id: userAId,
        recap_month: currentMonth,
        recap_year: currentYear,
        current_step: 'welcome',
        started_by_profile_id: null,
      })
      .throwOnError()

    const result = await checkRecapStatus(userAId, 'profile')
    expect(result.status.kind).toBe('no_recap')
  })

  it('group context: started_by = current user → kind=in_progress', async () => {
    await resetRecaps()
    const { data: row } = await admin
      .from('monthly_recaps')
      .insert({
        group_id: groupAId,
        recap_month: currentMonth,
        recap_year: currentYear,
        current_step: 'manage_bilan',
        started_by_profile_id: userAId,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    const result = await checkRecapStatus(userAId, 'group')
    expect(result.context).toBe('group')
    expect(result.contextId).toBe(groupAId)
    expect(result.status.kind).toBe('in_progress')
    if (result.status.kind !== 'in_progress') throw new Error('narrow failed')
    expect(result.status.step).toBe('manage_bilan')
    expect(result.status.recapId).toBe(row!.id)
  })

  it('group context: started_by = other member → kind=locked_by_other with startedByName', async () => {
    await resetRecaps()
    await admin
      .from('monthly_recaps')
      .insert({
        group_id: groupAId,
        recap_month: currentMonth,
        recap_year: currentYear,
        current_step: 'summary',
        started_by_profile_id: userBId,
        started_at: new Date().toISOString(),
      })
      .throwOnError()

    const result = await checkRecapStatus(userAId, 'group')
    expect(result.status.kind).toBe('locked_by_other')
    if (result.status.kind !== 'locked_by_other') throw new Error('narrow failed')
    expect(result.status.startedByProfileId).toBe(userBId)
    expect(result.status.startedByName).toBe('Bob Bbbb')
  })

  it('throws RecapStatusError code=PROFILE_NOT_FOUND on unknown userId', async () => {
    const unknown = randomUUID()
    await expect(checkRecapStatus(unknown, 'profile')).rejects.toBeInstanceOf(RecapStatusError)
    await expect(checkRecapStatus(unknown, 'profile')).rejects.toMatchObject({
      code: 'PROFILE_NOT_FOUND',
    })
  })

  it('throws RecapStatusError code=NO_GROUP when context=group but user has no group', async () => {
    await expect(checkRecapStatus(userCId, 'group')).rejects.toBeInstanceOf(RecapStatusError)
    await expect(checkRecapStatus(userCId, 'group')).rejects.toMatchObject({ code: 'NO_GROUP' })
  })
})
