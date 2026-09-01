/**
 * Integration tests for POST /api/monthly-recap/start (Sprint 05 V3).
 *
 * Gated by `SUPABASE_RECAP_TESTS=1` — hits the real Supabase project (dev
 * via SUPABASE_PROJECT_REF override, prod default per scripts convention).
 * Mock `@/lib/api/with-auth` to inject the test userId / profile without
 * needing a real session JWT. The RPC + table writes happen for real.
 *
 * Fixtures :
 *   - userA / userB : 2 members of groupA. userA is creator.
 *   - userC         : profile without group, drives the NO_GROUP case.
 *
 * Each test calls `resetRecaps()` first to ensure independence.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import type { Database } from '@/lib/database.types'
import { getRecapPeriod } from '@/lib/recap/period'

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

interface MockedAuth {
  userId: string
  groupId: string | null
}
const mockedAuth: MockedAuth = { userId: '', groupId: null }

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndProfile: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, {
        userId: mockedAuth.userId,
        profile: {
          id: mockedAuth.userId,
          group_id: mockedAuth.groupId,
          first_name: 'Test',
          last_name: 'User',
        },
      }),
    withAuth: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, { userId: mockedAuth.userId }),
  }
})

describe.skipIf(!ENABLED)('POST /api/monthly-recap/start (gated)', () => {
  let admin: SupabaseClient<Database>
  let POST: (req: NextRequest) => Promise<Response>

  let userAId: string
  let userBId: string
  let userCId: string
  let groupAId: string

  const stamp = Date.now()
  const emailA = `recap-start-a-${stamp}@popoth.test`
  const emailB = `recap-start-b-${stamp}@popoth.test`
  const emailC = `recap-start-c-${stamp}@popoth.test`

  const { month: recapMonth, year: recapYear } = getRecapPeriod()

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'Recap start tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    const mod = await import('@/app/api/monthly-recap/start/route')
    POST = mod.POST as (req: NextRequest) => Promise<Response>

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const [a, b, c] = await Promise.all([
      admin.auth.admin.createUser({
        email: emailA,
        password: randomUUID(),
        email_confirm: true,
      }),
      admin.auth.admin.createUser({
        email: emailB,
        password: randomUUID(),
        email_confirm: true,
      }),
      admin.auth.admin.createUser({
        email: emailC,
        password: randomUUID(),
        email_confirm: true,
      }),
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
        name: `recap-start-group-${stamp}`,
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
      if (userAId) await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
      if (groupAId) await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
      // Sprint Abandoned-Recap-Recovery — le balayage CRÉE une ligne piggy_bank
      // quand il rembourse, y compris pour un utilisateur qui n'en avait pas.
      if (userAId) await admin.from('piggy_bank').delete().eq('profile_id', userAId)
      if (groupAId) await admin.from('piggy_bank').delete().eq('group_id', groupAId)
      if (groupAId) await admin.from('groups').delete().eq('id', groupAId)
      if (userAId) await admin.from('profiles').update({ group_id: null }).eq('id', userAId)
      if (userBId) await admin.from('profiles').update({ group_id: null }).eq('id', userBId)
      if (userAId) await admin.auth.admin.deleteUser(userAId)
      if (userBId) await admin.auth.admin.deleteUser(userBId)
      if (userCId) await admin.auth.admin.deleteUser(userCId)
    }
  })

  async function resetRecaps() {
    if (userAId) await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
    if (groupAId) await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
    if (userAId) await admin.from('piggy_bank').delete().eq('profile_id', userAId)
    if (groupAId) await admin.from('piggy_bank').delete().eq('group_id', groupAId)
  }

  /** Période décalée de `back` mois en arrière, rollover d'année inclus. */
  function shiftPeriod(back: number): { month: number; year: number } {
    const zeroBased = recapYear * 12 + (recapMonth - 1) - back
    return { month: (zeroBased % 12) + 1, year: Math.floor(zeroBased / 12) }
  }

  /** Montant de la tirelire, `null` quand aucune ligne n'existe encore. */
  async function readPiggy(owner: {
    profileId?: string
    groupId?: string
  }): Promise<number | null> {
    const query = admin.from('piggy_bank').select('amount')
    const { data } = owner.profileId
      ? await query.eq('profile_id', owner.profileId).maybeSingle()
      : await query.eq('group_id', owner.groupId as string).maybeSingle()
    return data ? Number(data.amount) : null
  }

  /** Insère un bilan resté en plan sur une période antérieure. */
  async function seedAbandoned(args: {
    profileId?: string
    groupId?: string
    monthsBack: number
    fromPiggy: number
    fromSavings: number
  }): Promise<string> {
    const { month, year } = shiftPeriod(args.monthsBack)
    const { data } = await admin
      .from('monthly_recaps')
      .insert({
        profile_id: args.profileId ?? null,
        group_id: args.groupId ?? null,
        recap_month: month,
        recap_year: year,
        current_step: 'manage_bilan',
        started_by_profile_id: userAId,
        started_at: new Date().toISOString(),
        refloated_from_piggy: args.fromPiggy,
        refloated_from_savings: args.fromSavings,
      })
      .select('id')
      .single()
      .throwOnError()
    return data!.id
  }

  function buildRequest(body: unknown): NextRequest {
    return new Request('http://localhost/api/monthly-recap/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  }

  beforeEach(async () => {
    await resetRecaps()
  })

  it('context=profile, no row → 200 + result=created + summary populated', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: {
        recap: { profile_id: string; started_by_profile_id: string; current_step: string }
        summary: unknown
      }
    }
    expect(body.data.recap.profile_id).toBe(userAId)
    expect(body.data.recap.started_by_profile_id).toBe(userAId)
    expect(body.data.recap.current_step).toBe('welcome')
    expect(body.data.summary).not.toBeNull()

    const { data: row } = await admin
      .from('monthly_recaps')
      .select('id, started_at')
      .eq('profile_id', userAId)
      .eq('recap_month', recapMonth)
      .eq('recap_year', recapYear)
      .single()
    expect(row).not.toBeNull()
    expect(row!.started_at).not.toBeNull()
  })

  it('context=profile, row in_progress same user → 200 + result=resumed (started_at preserved)', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const initialStartedAt = new Date('2026-05-20T10:00:00.000Z').toISOString()
    await admin
      .from('monthly_recaps')
      .insert({
        profile_id: userAId,
        recap_month: recapMonth,
        recap_year: recapYear,
        current_step: 'summary',
        started_by_profile_id: userAId,
        started_at: initialStartedAt,
      })
      .throwOnError()

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { recap: { started_at: string } } }
    // PG returns ISO with `+00:00` offset, JS toISOString produces `Z`.
    // Compare as Date values to ignore string representation differences.
    expect(new Date(body.data.recap.started_at).getTime()).toBe(
      new Date(initialStartedAt).getTime(),
    )
  })

  it('context=profile, orphan row started_by NULL → 200 + result=resumed (re-claimed)', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    await admin
      .from('monthly_recaps')
      .insert({
        profile_id: userAId,
        recap_month: recapMonth,
        recap_year: recapYear,
        current_step: 'welcome',
        started_by_profile_id: null,
        started_at: null,
      })
      .throwOnError()

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { recap: { started_by_profile_id: string; started_at: string | null } }
    }
    expect(body.data.recap.started_by_profile_id).toBe(userAId)
    expect(body.data.recap.started_at).not.toBeNull()
  })

  it('context=group, no row, user has group_id → 200 + result=created with group_id set', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const response = await POST(buildRequest({ context: 'group' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { recap: { group_id: string | null; profile_id: string | null } }
    }
    expect(body.data.recap.group_id).toBe(groupAId)
    expect(body.data.recap.profile_id).toBeNull()
  })

  it('context=group, in_progress by other member → 409 + body locked_by_other', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    await admin
      .from('monthly_recaps')
      .insert({
        group_id: groupAId,
        recap_month: recapMonth,
        recap_year: recapYear,
        current_step: 'summary',
        started_by_profile_id: userBId,
        started_at: new Date().toISOString(),
      })
      .throwOnError()

    const response = await POST(buildRequest({ context: 'group' }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; startedBy: string }
    expect(body.error).toBe('locked_by_other')
    expect(body.startedBy).toBe(userBId)
  })

  it('context=profile, row completed → 410 + body already_completed', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const completedAt = new Date().toISOString()
    const { data: row } = await admin
      .from('monthly_recaps')
      .insert({
        profile_id: userAId,
        recap_month: recapMonth,
        recap_year: recapYear,
        current_step: 'completed',
        started_by_profile_id: userAId,
        started_at: completedAt,
        completed_at: completedAt,
      })
      .select('id')
      .single()
      .throwOnError()

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(410)
    const body = (await response.json()) as { error: string; recapId: string }
    expect(body.error).toBe('already_completed')
    expect(body.recapId).toBe(row!.id)
  })

  it('context=group, user without group_id → 400 + body "Pas de groupe"', async () => {
    mockedAuth.userId = userCId
    mockedAuth.groupId = null

    const response = await POST(buildRequest({ context: 'group' }))
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('Pas de groupe')
  })

  // ==========================================================================
  // Sprint Abandoned-Recap-Recovery (2026-09-01)
  // ==========================================================================
  // Un bilan resté en plan sur un mois passé est invisible pour toute
  // l'application (les lectures filtrent sur l'égalité stricte de période),
  // et l'argent qu'il avait prélevé sur la tirelire / les économies était
  // perdu. `start_monthly_recap` le balaye désormais : remboursement INTÉGRAL
  // sur la tirelire, ligne marquée `abandoned_at`, montant annoncé via
  // `recovery_data` sur la nouvelle ligne.
  //
  // ⚠️ Libellé volontairement distinct de « orphan » : ce mot désigne déjà,
  // plus haut dans ce fichier, une ligne de la BONNE période dont
  // `started_by_profile_id` est NULL. Rien à voir.

  it('abandoned previous month with refloats → refunded to the piggy, row archived', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const abandonedId = await seedAbandoned({
      profileId: userAId,
      monthsBack: 1,
      fromPiggy: 100,
      fromSavings: 50,
    })
    expect(await readPiggy({ profileId: userAId })).toBeNull()

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { recovered: { total: number; periods: Array<{ month: number; amount: number }> } }
    }
    expect(Number(body.data.recovered.total)).toBe(150)
    expect(body.data.recovered.periods).toHaveLength(1)

    // L'argent est revenu, en totalité, dans la tirelire — y compris la part
    // qui venait des économies (décision produit : un seul pot de retour).
    expect(await readPiggy({ profileId: userAId })).toBe(150)

    const { data: archived } = await admin
      .from('monthly_recaps')
      .select('abandoned_at, completed_at')
      .eq('id', abandonedId)
      .single()
    expect(archived!.abandoned_at).not.toBeNull()
    expect(archived!.completed_at).toBeNull()

    const { data: fresh } = await admin
      .from('monthly_recaps')
      .select('recovery_data')
      .eq('profile_id', userAId)
      .eq('recap_month', recapMonth)
      .eq('recap_year', recapYear)
      .single()
    expect(fresh!.recovery_data).toMatchObject({ total: 150 })
  })

  it('abandoned previous month that cost nothing → archived silently, piggy untouched', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const abandonedId = await seedAbandoned({
      profileId: userAId,
      monthsBack: 1,
      fromPiggy: 0,
      fromSavings: 0,
    })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { recovered: { total: number } } }
    expect(Number(body.data.recovered.total)).toBe(0)

    // Aucune ligne piggy_bank créée : rien n'a bougé, donc rien à annoncer.
    expect(await readPiggy({ profileId: userAId })).toBeNull()

    const { data: archived } = await admin
      .from('monthly_recaps')
      .select('abandoned_at')
      .eq('id', abandonedId)
      .single()
    expect(archived!.abandoned_at).not.toBeNull()

    const { data: fresh } = await admin
      .from('monthly_recaps')
      .select('recovery_data')
      .eq('profile_id', userAId)
      .eq('recap_month', recapMonth)
      .eq('recap_year', recapYear)
      .single()
    expect(fresh!.recovery_data).toEqual({})
  })

  it('two abandoned months → both archived, total summed, only paying periods announced', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const older = await seedAbandoned({
      profileId: userAId,
      monthsBack: 2,
      fromPiggy: 80,
      fromSavings: 0,
    })
    const recent = await seedAbandoned({
      profileId: userAId,
      monthsBack: 1,
      fromPiggy: 0,
      fromSavings: 0,
    })

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { recovered: { total: number; periods: Array<{ month: number; year: number }> } }
    }
    expect(Number(body.data.recovered.total)).toBe(80)
    // Le mois à 0 € est archivé mais n'apparaît PAS dans l'annonce.
    expect(body.data.recovered.periods).toHaveLength(1)
    expect(body.data.recovered.periods[0]).toMatchObject(shiftPeriod(2))

    expect(await readPiggy({ profileId: userAId })).toBe(80)

    const { data: rows } = await admin
      .from('monthly_recaps')
      .select('id, abandoned_at')
      .in('id', [older, recent])
    expect(rows).toHaveLength(2)
    expect(rows!.every((r) => r.abandoned_at !== null)).toBe(true)
  })

  it('no abandoned row → created path strictly unchanged, nothing announced', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    const response = await POST(buildRequest({ context: 'profile' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { recovered: { total: number; periods: unknown[] }; recap: { current_step: string } }
    }
    expect(Number(body.data.recovered.total)).toBe(0)
    expect(body.data.recovered.periods).toEqual([])
    expect(body.data.recap.current_step).toBe('welcome')
    expect(await readPiggy({ profileId: userAId })).toBeNull()
  })

  it('re-starting after a sweep does not refund twice', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    await seedAbandoned({ profileId: userAId, monthsBack: 1, fromPiggy: 100, fromSavings: 50 })

    await POST(buildRequest({ context: 'profile' }))
    expect(await readPiggy({ profileId: userAId })).toBe(150)

    // Second appel : la ligne courante existe déjà ('resumed'), et la ligne
    // abandonnée porte maintenant `abandoned_at` → hors du prédicat de balayage.
    const second = await POST(buildRequest({ context: 'profile' }))
    expect(second.status).toBe(200)
    const body = (await second.json()) as { data: { recovered: { total: number } } }
    expect(Number(body.data.recovered.total)).toBe(0)
    expect(await readPiggy({ profileId: userAId })).toBe(150)
  })

  it('context=group: an abandoned group recap refunds the group piggy', async () => {
    mockedAuth.userId = userAId
    mockedAuth.groupId = groupAId

    await seedAbandoned({ groupId: groupAId, monthsBack: 1, fromPiggy: 40, fromSavings: 60 })

    const response = await POST(buildRequest({ context: 'group' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { recovered: { total: number } } }
    expect(Number(body.data.recovered.total)).toBe(100)

    expect(await readPiggy({ groupId: groupAId })).toBe(100)
    // La tirelire perso ne doit surtout pas bouger.
    expect(await readPiggy({ profileId: userAId })).toBeNull()
  })
})
