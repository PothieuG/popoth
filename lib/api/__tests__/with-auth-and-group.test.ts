/**
 * Sprint Perf-Waterfall (2026-09-10) — `withAuthAndGroup`.
 *
 * Ce wrapper existe pour UNE raison : ne faire aucune lecture en base. Un
 * chargement de dashboard déclenche 13 appels d'API, et `withAuthAndProfile`
 * relisait `profiles` avant chacun — 13 allers-retours bloquants pour un champ
 * qui ne bouge qu'en rejoignant ou quittant un groupe.
 *
 * Les deux cas qui comptent :
 *   - jeton portant `groupId` → zéro requête ;
 *   - jeton legacy (`groupId` absent, émis avant ce sprint) → repli sur une
 *     lecture, sinon tout utilisateur déjà connecté serait vu « sans groupe »
 *     au déploiement et basculerait du dashboard groupe au dashboard perso.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROBE = { profileReads: 0 }
const SESSION: { value: Record<string, unknown> | null } = { value: null }

vi.mock('@/lib/session-server', () => ({
  validateSessionToken: async () => SESSION.value,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

vi.mock('@/lib/supabase-server', () => {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.single = () => Promise.resolve({ data: { group_id: 'group-from-db' }, error: null })
  builder.maybeSingle = () => Promise.resolve({ data: { group_id: 'group-from-db' }, error: null })
  return {
    supabaseServer: {
      from: (table: string) => {
        if (table === 'profiles') PROBE.profileReads += 1
        return builder
      },
    },
  }
})

const req = () => new Request('http://x/api/finance/summary') as unknown as NextRequest

beforeEach(() => {
  PROBE.profileReads = 0
  SESSION.value = null
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('withAuthAndGroup', () => {
  it('sert le groupe du jeton sans toucher la base', async () => {
    SESSION.value = { userId: 'u1', email: 'a@b.c', groupId: 'group-1', expiresAt: 9e9 }
    const { withAuthAndGroup } = await import('../with-auth')

    const handler = withAuthAndGroup(async (_r, ctx) => NextResponse.json({ ctx }))
    const body = (await (await handler(req())).json()) as { ctx: Record<string, unknown> }

    expect(body.ctx).toEqual({ userId: 'u1', groupId: 'group-1' })
    // C'est TOUT l'intérêt du wrapper.
    expect(PROBE.profileReads).toBe(0)
  })

  it('distingue « aucun groupe » de « groupe inconnu »', async () => {
    SESSION.value = { userId: 'u1', email: 'a@b.c', groupId: null, expiresAt: 9e9 }
    const { withAuthAndGroup } = await import('../with-auth')

    const handler = withAuthAndGroup(async (_r, ctx) => NextResponse.json({ ctx }))
    const body = (await (await handler(req())).json()) as { ctx: { groupId: string | null } }

    // `null` est une réponse, pas une absence d'information : pas de lecture.
    expect(body.ctx.groupId).toBeNull()
    expect(PROBE.profileReads).toBe(0)
  })

  it('retombe sur la base pour un jeton émis avant ce sprint', async () => {
    // `groupId` absent du payload — c'est la forme des jetons déjà en circulation
    // au moment du déploiement.
    SESSION.value = { userId: 'u1', email: 'a@b.c', expiresAt: 9e9 }
    const { withAuthAndGroup } = await import('../with-auth')

    const handler = withAuthAndGroup(async (_r, ctx) => NextResponse.json({ ctx }))
    const body = (await (await handler(req())).json()) as { ctx: { groupId: string | null } }

    expect(body.ctx.groupId).toBe('group-from-db')
    expect(PROBE.profileReads).toBe(1)
  })

  it('refuse une session absente sans lire la base', async () => {
    SESSION.value = null
    const { withAuthAndGroup } = await import('../with-auth')

    const handler = withAuthAndGroup(async () => NextResponse.json({ ok: true }))
    const res = await handler(req())

    expect(res.status).toBe(401)
    expect(PROBE.profileReads).toBe(0)
  })
})
