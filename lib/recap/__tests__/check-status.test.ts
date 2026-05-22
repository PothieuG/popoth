import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

import type { Database } from '@/lib/database.types'

// Sprint Recap-V2-Ossature (2026-05-22) — pin the V2 gating contract.
//
// checkRecapStatus reads `monthly_recaps_v2`. These tests verify the shape
// of the returned RecapStatus + the two RecapStatusError codes. Mirror
// pattern from app/api/monthly-recap-legacy/complete/__tests__/route.integration.test.ts
// (dynamic-import-in-beforeAll, FK-safe cleanup).
//
// Gated by SUPABASE_RECAP_TESTS=1 (matches the V1 caract tests cluster).

type CheckStatusMod = typeof import('@/lib/recap/check-status')

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('checkRecapStatus V2', () => {
  let admin: SupabaseClient<Database>
  let checkRecapStatus: CheckStatusMod['checkRecapStatus']
  let RecapStatusError: CheckStatusMod['RecapStatusError']

  const stamp = Date.now()
  const testEmail = `check-status-v2-${stamp}@popoth.test`
  let testUserId: string
  let testGroupId: string

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'check-status V2 tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const mod = await import('@/lib/recap/check-status')
    checkRecapStatus = mod.checkRecapStatus
    RecapStatusError = mod.RecapStatusError

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: `check-status-v2-${randomUUID()}`,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'CheckStatusV2',
      last_name: 'Fixture',
    })
    if (profErr) throw profErr

    // Seed a group for the NO_GROUP / group-context tests
    const { data: groupData, error: groupErr } = await admin
      .from('groups')
      .insert({
        name: `check-status-v2-group-${stamp}`,
        creator_id: testUserId,
        monthly_budget_estimate: 0,
      })
      .select('id')
      .single()
    if (groupErr || !groupData) throw groupErr ?? new Error('group insert failed')
    testGroupId = groupData.id
  }, 60_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    await admin.from('monthly_recaps_v2').delete().eq('profile_id', testUserId)
    if (testGroupId) {
      await admin.from('monthly_recaps_v2').delete().eq('group_id', testGroupId)
      await admin.from('groups').delete().eq('id', testGroupId)
    }
    await admin.from('profiles').delete().eq('id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 60_000)

  async function resetRecapRows(): Promise<void> {
    await admin.from('monthly_recaps_v2').delete().eq('profile_id', testUserId)
    if (testGroupId) await admin.from('monthly_recaps_v2').delete().eq('group_id', testGroupId)
  }

  async function unlinkGroup(): Promise<void> {
    await admin.from('profiles').update({ group_id: null }).eq('id', testUserId)
  }

  async function linkGroup(): Promise<void> {
    await admin.from('profiles').update({ group_id: testGroupId }).eq('id', testUserId)
  }

  function currentMonthYear(): { month: number; year: number } {
    const now = new Date()
    return { month: now.getMonth() + 1, year: now.getFullYear() }
  }

  it('returns required=true when no V2 row exists for the current month', async () => {
    await resetRecapRows()
    await unlinkGroup()

    const status = await checkRecapStatus(testUserId, 'profile')

    expect(status.required).toBe(true)
    expect(status.hasExistingRecap).toBe(false)
    expect(status.isCompleted).toBe(false)
    expect(status.context).toBe('profile')
    expect(status.contextId).toBe(testUserId)
  })

  it('returns isCompleted=true when V2 row has completed_at != null', async () => {
    await resetRecapRows()
    await unlinkGroup()
    const { month, year } = currentMonthYear()
    const { error } = await admin.from('monthly_recaps_v2').insert({
      profile_id: testUserId,
      recap_month: month,
      recap_year: year,
      completed_at: new Date().toISOString(),
    })
    if (error) throw error

    const status = await checkRecapStatus(testUserId, 'profile')

    expect(status.required).toBe(false)
    expect(status.hasExistingRecap).toBe(true)
    expect(status.isCompleted).toBe(true)
  })

  it('returns hasExistingRecap=true but isCompleted=false when V2 row has completed_at NULL', async () => {
    await resetRecapRows()
    await unlinkGroup()
    const { month, year } = currentMonthYear()
    const { error } = await admin.from('monthly_recaps_v2').insert({
      profile_id: testUserId,
      recap_month: month,
      recap_year: year,
      completed_at: null,
    })
    if (error) throw error

    const status = await checkRecapStatus(testUserId, 'profile')

    expect(status.required).toBe(false)
    expect(status.hasExistingRecap).toBe(true)
    expect(status.isCompleted).toBe(false)
  })

  it('throws NO_GROUP when context=group but profile has no group_id', async () => {
    await resetRecapRows()
    await unlinkGroup()

    await expect(checkRecapStatus(testUserId, 'group')).rejects.toThrow(RecapStatusError)
    try {
      await checkRecapStatus(testUserId, 'group')
    } catch (error) {
      if (error instanceof RecapStatusError) {
        expect(error.code).toBe('NO_GROUP')
      } else {
        throw error
      }
    }
  })

  it('throws PROFILE_NOT_FOUND when userId is unknown', async () => {
    const unknownId = randomUUID()

    await expect(checkRecapStatus(unknownId, 'profile')).rejects.toThrow(RecapStatusError)
    try {
      await checkRecapStatus(unknownId, 'profile')
    } catch (error) {
      if (error instanceof RecapStatusError) {
        expect(error.code).toBe('PROFILE_NOT_FOUND')
      } else {
        throw error
      }
    }
  })

  it('returns required=true for context=group when no V2 group row exists', async () => {
    await resetRecapRows()
    await linkGroup()

    const status = await checkRecapStatus(testUserId, 'group')

    expect(status.required).toBe(true)
    expect(status.hasExistingRecap).toBe(false)
    expect(status.isCompleted).toBe(false)
    expect(status.context).toBe('group')
    expect(status.contextId).toBe(testGroupId)
  })
})
