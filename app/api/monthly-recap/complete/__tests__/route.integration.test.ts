import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

import type { Database } from '@/lib/database.types'

// Sprint Recap-V2-Ossature (2026-05-22) — pin the V2 complete endpoint
// contract: UPSERT idempotent + 401 on missing session.
//
// Mirror pattern from app/api/monthly-recap-legacy/complete/__tests__/route.integration.test.ts
// (dynamic-import-in-beforeAll, FK-safe cleanup cascade).

type RouteMod = typeof import('@/app/api/monthly-recap/complete/route')
type SessionMod = typeof import('@/lib/session')

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('POST /api/monthly-recap/complete V2 — ossature', () => {
  let admin: SupabaseClient<Database>
  let POST: RouteMod['POST']
  let createSessionToken: SessionMod['createSessionToken']

  const stamp = Date.now()
  const testEmail = `complete-v2-${stamp}@popoth.test`
  let testUserId: string
  let testToken: string

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'complete V2 tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const routeMod = await import('@/app/api/monthly-recap/complete/route')
    POST = routeMod.POST

    const sessionMod = await import('@/lib/session')
    createSessionToken = sessionMod.createSessionToken

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: `complete-v2-${randomUUID()}`,
      email_confirm: true,
    })
    if (userErr || !userData.user) throw userErr ?? new Error('createUser failed')
    testUserId = userData.user.id

    const { error: profErr } = await admin.from('profiles').insert({
      id: testUserId,
      first_name: 'CompleteV2',
      last_name: 'Fixture',
    })
    if (profErr) throw profErr

    testToken = await createSessionToken(testUserId, testEmail)
  }, 60_000)

  afterAll(async () => {
    if (!admin || !testUserId) return
    await admin.from('monthly_recaps_v2').delete().eq('profile_id', testUserId)
    await admin.from('profiles').delete().eq('id', testUserId)
    await admin.auth.admin.deleteUser(testUserId)
  }, 60_000)

  async function resetRecapRows(): Promise<void> {
    await admin.from('monthly_recaps_v2').delete().eq('profile_id', testUserId)
  }

  function buildRequest(body: unknown, token?: string): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token !== undefined) headers.cookie = `session=${token}`
    return new Request('http://localhost/api/monthly-recap/complete', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  }

  function currentMonthYear(): { month: number; year: number } {
    const now = new Date()
    return { month: now.getMonth() + 1, year: now.getFullYear() }
  }

  it('creates a V2 row with completed_at != null on valid POST', async () => {
    await resetRecapRows()

    const response = await POST(buildRequest({ context: 'profile' }, testToken))
    expect(response.status).toBe(200)
    const json = (await response.json()) as { data: { id: string; completed_at: string | null } }
    expect(json.data.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(json.data.completed_at).not.toBeNull()

    // Verify DB state
    const { month, year } = currentMonthYear()
    const { data: rows } = await admin
      .from('monthly_recaps_v2')
      .select('id, completed_at')
      .eq('profile_id', testUserId)
      .eq('recap_month', month)
      .eq('recap_year', year)
    expect(rows).toHaveLength(1)
    expect(rows?.[0]?.completed_at).not.toBeNull()
  })

  it('is idempotent — repeated POST does not create duplicates', async () => {
    await resetRecapRows()

    await POST(buildRequest({ context: 'profile' }, testToken))
    await POST(buildRequest({ context: 'profile' }, testToken))
    const response = await POST(buildRequest({ context: 'profile' }, testToken))
    expect(response.status).toBe(200)

    const { month, year } = currentMonthYear()
    const { data: rows } = await admin
      .from('monthly_recaps_v2')
      .select('id')
      .eq('profile_id', testUserId)
      .eq('recap_month', month)
      .eq('recap_year', year)
    expect(rows).toHaveLength(1)
  })

  it('returns 401 when session cookie is missing', async () => {
    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(401)
    const json = (await response.json()) as { error: string }
    expect(json.error).toBe('Session invalide')
  })

  it('returns 400 when context=group but user has no group_id', async () => {
    await resetRecapRows()
    await admin.from('profiles').update({ group_id: null }).eq('id', testUserId)

    const response = await POST(buildRequest({ context: 'group' }, testToken))
    expect(response.status).toBe(400)
    const json = (await response.json()) as { error: string }
    expect(json.error).toMatch(/groupe/i)
  })
})
