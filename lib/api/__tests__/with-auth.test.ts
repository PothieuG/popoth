import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Database } from '@/lib/database.types'

// Same dynamic-import pattern as lib/finance/__tests__/rpc-concurrency.test.ts —
// lib/api/with-auth.ts pulls in lib/supabase-server.ts which calls createClient at
// module load and would crash when env vars are missing.
type WithAuthMod = typeof import('@/lib/api/with-auth')
type SessionMod = typeof import('@/lib/session')

const ENABLED = process.env.SUPABASE_API_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('withAuth + withAuthAndProfile (Sprint Refactor-Architecture-v5)', () => {
  let admin: SupabaseClient<Database>
  let withAuth: WithAuthMod['withAuth']
  let withAuthAndProfile: WithAuthMod['withAuthAndProfile']
  let createSessionToken: SessionMod['createSessionToken']
  let encrypt: SessionMod['encrypt']

  // Primary test user — has a profile, used for happy-path cases
  let userId: string
  let userEmail: string

  // Secondary test user — auth.users row exists but NO profiles row, used for
  // the 404 'Profil non trouvé' case
  let userIdNoProfile: string
  let userEmailNoProfile: string

  // 5 extra users for the parallel-isolation test
  const parallelUsers: Array<{ id: string; email: string }> = []

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'withAuth tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const wam = await import('@/lib/api/with-auth')
    withAuth = wam.withAuth
    withAuthAndProfile = wam.withAuthAndProfile

    const sm = await import('@/lib/session')
    createSessionToken = sm.createSessionToken
    encrypt = sm.encrypt

    const stamp = Date.now()

    // Primary user + profile
    userEmail = `with-auth-v5-${stamp}@popoth.test`
    const primaryRes = await admin.auth.admin.createUser({
      email: userEmail,
      password: `v5-${randomUUID()}`,
      email_confirm: true,
    })
    if (primaryRes.error || !primaryRes.data.user) {
      throw primaryRes.error ?? new Error('createUser failed (primary)')
    }
    userId = primaryRes.data.user.id
    const profErr = await admin.from('profiles').insert({
      id: userId,
      first_name: 'V5',
      last_name: 'Test',
    })
    if (profErr.error) throw profErr.error

    // Secondary user — intentionally no profile row
    userEmailNoProfile = `with-auth-v5-noprof-${stamp}@popoth.test`
    const noProfRes = await admin.auth.admin.createUser({
      email: userEmailNoProfile,
      password: `v5-${randomUUID()}`,
      email_confirm: true,
    })
    if (noProfRes.error || !noProfRes.data.user) {
      throw noProfRes.error ?? new Error('createUser failed (no-profile)')
    }
    userIdNoProfile = noProfRes.data.user.id

    // 5 parallel users
    for (let i = 0; i < 5; i++) {
      const email = `with-auth-v5-par-${i}-${stamp}@popoth.test`
      const r = await admin.auth.admin.createUser({
        email,
        password: `v5-${randomUUID()}`,
        email_confirm: true,
      })
      if (r.error || !r.data.user) throw r.error ?? new Error(`createUser failed (parallel ${i})`)
      const pe = await admin.from('profiles').insert({
        id: r.data.user.id,
        first_name: `V5p${i}`,
        last_name: 'Par',
      })
      if (pe.error) throw pe.error
      parallelUsers.push({ id: r.data.user.id, email })
    }
  })

  afterAll(async () => {
    if (!ENABLED || !admin) return
    for (const u of parallelUsers) {
      await admin.from('profiles').delete().eq('id', u.id)
      await admin.auth.admin.deleteUser(u.id)
    }
    if (userId) {
      await admin.from('profiles').delete().eq('id', userId)
      await admin.auth.admin.deleteUser(userId)
    }
    if (userIdNoProfile) {
      // No profile row to delete
      await admin.auth.admin.deleteUser(userIdNoProfile)
    }
  })

  // The wrapper signature uses NextRequest, but only reads the standard Request
  // surface (cookie header). Same cast trick as lib/__tests__/api-regressions.test.ts:294-306.
  const buildRequest = (token?: string): NextRequest => {
    const headers: Record<string, string> = {}
    if (token !== undefined) headers.cookie = `session=${token}`
    return new Request('http://localhost/test', { headers }) as unknown as NextRequest
  }

  describe('withAuth', () => {
    it('valid session → handler called with { userId }', async () => {
      let captured: string | null = null
      const wrapped = withAuth(async (_req, { userId: uid }) => {
        captured = uid
        return NextResponse.json({ ok: true })
      })
      const token = await createSessionToken(userId, userEmail)
      const res = await wrapped(buildRequest(token))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(captured).toBe(userId)
    })

    it('no cookie → 401 Session invalide; handler is NOT called', async () => {
      let called = false
      const wrapped = withAuth(async () => {
        called = true
        return NextResponse.json({ ok: true })
      })
      const res = await wrapped(buildRequest(undefined))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Session invalide' })
      expect(called).toBe(false)
    })

    it('invalid JWT (gibberish cookie) → 401 Session invalide', async () => {
      const wrapped = withAuth(async () => NextResponse.json({ ok: true }))
      const res = await wrapped(buildRequest('not-a-real-jwt-just-gibberish'))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Session invalide' })
    })

    it('expired session payload → 401 Session invalide', async () => {
      // Sign a payload with expiresAt in the past. The JWT itself stays valid
      // (jose's exp claim comes from setExpirationTime('7d'), independent of
      // payload.expiresAt), but validateSessionToken checks payload.expiresAt
      // directly (lib/session-server.ts:108).
      const past = Math.floor(Date.now() / 1000) - 3600
      const token = await encrypt({
        userId,
        email: userEmail,
        createdAt: past - 60,
        expiresAt: past,
      })
      const wrapped = withAuth(async () => NextResponse.json({ ok: true }))
      const res = await wrapped(buildRequest(token))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Session invalide' })
    })

    it('static-route overload — wrapper takes only the request arg (no routeContext)', async () => {
      // Compile-time check: the static overload returns
      //   (request: NextRequest) => Promise<NextResponse>
      // so wrapped(req) — no 2nd arg — must type-check.
      const wrapped = withAuth(async (_req, { userId: uid }) => {
        return NextResponse.json({ uid })
      })
      const token = await createSessionToken(userId, userEmail)
      const res = await wrapped(buildRequest(token))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ uid: userId })
    })

    it('dynamic-route overload — routeContext.params flows through without ! assertion', async () => {
      // Compile-time check: with TParams supplied, routeContext is
      // non-optional both in the handler signature AND the wrapper return
      // signature. `await routeContext.params` (no `!`) must type-check.
      const wrapped = withAuth<{ id: string }>(async (_req, _ctx, routeContext) => {
        const { id } = await routeContext.params
        return NextResponse.json({ id })
      })
      const token = await createSessionToken(userId, userEmail)
      const routeContext = { params: Promise.resolve({ id: 'group-abc-123' }) }
      const res = await wrapped(buildRequest(token), routeContext)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ id: 'group-abc-123' })
    })
  })

  describe('withAuthAndProfile', () => {
    it('valid session + profile → handler receives { userId, profile } with all 4 fields projected', async () => {
      let capturedUid: string | null = null
      let capturedProfile: unknown = null
      const wrapped = withAuthAndProfile(async (_req, { userId: uid, profile }) => {
        capturedUid = uid
        capturedProfile = profile
        return NextResponse.json({ ok: true })
      })
      const token = await createSessionToken(userId, userEmail)
      const res = await wrapped(buildRequest(token))
      expect(res.status).toBe(200)
      expect(capturedUid).toBe(userId)
      // Regression-guard against a future select() drift — all 4 fields
      // (id, group_id, first_name, last_name) must be projected.
      expect(capturedProfile).toMatchObject({
        id: userId,
        group_id: null,
        first_name: 'V5',
        last_name: 'Test',
      })
    })

    it('no cookie → 401 Session invalide (does not even attempt profile fetch)', async () => {
      const wrapped = withAuthAndProfile(async () => NextResponse.json({ ok: true }))
      const res = await wrapped(buildRequest(undefined))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Session invalide' })
    })

    it('valid session but profile row missing → 404 Profil non trouvé', async () => {
      const wrapped = withAuthAndProfile(async () => NextResponse.json({ ok: true }))
      const token = await createSessionToken(userIdNoProfile, userEmailNoProfile)
      const res = await wrapped(buildRequest(token))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Profil non trouvé' })
    })

    it('dynamic-route overload — routeContext flows through, profile still fetched', async () => {
      let capturedUid: string | null = null
      let capturedId: string | null = null
      const wrapped = withAuthAndProfile<{ id: string }>(
        async (_req, { userId: uid }, routeContext) => {
          capturedUid = uid
          const { id } = await routeContext.params
          capturedId = id
          return NextResponse.json({ uid, id })
        },
      )
      const token = await createSessionToken(userId, userEmail)
      const routeContext = { params: Promise.resolve({ id: 'member-xyz-789' }) }
      const res = await wrapped(buildRequest(token), routeContext)
      expect(res.status).toBe(200)
      expect(capturedUid).toBe(userId)
      expect(capturedId).toBe('member-xyz-789')
    })
  })

  describe('isolation', () => {
    it('wrapper does NOT catch handler errors (each route keeps its own try/catch)', async () => {
      const wrapped = withAuth(async () => {
        throw new Error('boom')
      })
      const token = await createSessionToken(userId, userEmail)
      // Critical invariant per lib/api/with-auth.ts:11-15 — centralizing the
      // try/catch in the wrapper would override summary.ts's deliberate
      // 200-with-default-data fallback. The wrapper must NOT mask handler
      // errors; the rejection bubbles up to the route's own try/catch.
      await expect(wrapped(buildRequest(token))).rejects.toThrow('boom')
    })

    it('parallel invocations do not cross userId contexts', async () => {
      const wrapped = withAuth(async (_req, { userId: uid }) => {
        return NextResponse.json({ uid })
      })
      const tokens = await Promise.all(parallelUsers.map((u) => createSessionToken(u.id, u.email)))
      const responses = await Promise.all(tokens.map((t) => wrapped(buildRequest(t))))
      const responseUids = await Promise.all(
        responses.map(async (r) => (await r.json()).uid as string),
      )
      // Each response must report the matching userId in order — closure
      // isolation between concurrent invocations.
      expect(responseUids).toEqual(parallelUsers.map((u) => u.id))
    })
  })
})
