/**
 * Sprint Notes-Pense-Betes (2026-09-23) — handlers `/api/notes` et
 * `/api/notes/[id]` (lib/api/notes.ts).
 *
 * Ce qui est pinné :
 *   - le scope : notes perso filtrées sur `profile_id`, notes de groupe sur
 *     `group_id` — jamais l'un pour l'autre ;
 *   - l'auteur (`created_by_profile_id`) est posé à l'INSERT, jamais modifié ;
 *   - le contrôle d'accès de PUT/DELETE passe par le filtre de la requête
 *     elle-même (0 ligne ⇒ 404), sans lecture préalable ;
 *   - le JOIN auteur n'embarque jamais `avatar_url` (règle Part 42 §11).
 */

import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.mock` est hoisté au-dessus des `const` du module : l'état partagé doit
// naître dans `vi.hoisted`.
const { AUTH, DB } = vi.hoisted(() => ({
  AUTH: { groupId: null as string | null },
  DB: {
    calls: [] as { method: string; args: unknown[] }[],
    result: { data: null as unknown, error: null as unknown },
  },
}))

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndGroup: (handler: AnyHandler) => async (request: NextRequest, rc?: unknown) =>
      handler(request, { userId: USER_ID, groupId: AUTH.groupId }, rc),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {}
  const passthrough =
    (method: string) =>
    (...args: unknown[]) => {
      DB.calls.push({ method, args })
      return chain
    }
  const terminal =
    (method: string) =>
    async (...args: unknown[]) => {
      DB.calls.push({ method, args })
      return DB.result
    }
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'or']) chain[m] = passthrough(m)
  for (const m of ['order', 'single', 'maybeSingle']) chain[m] = terminal(m)
  return {
    supabaseServer: {
      from: (table: string) => {
        DB.calls.push({ method: 'from', args: [table] })
        return chain
      },
    },
  }
})

const USER_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = '22222222-2222-4222-8222-222222222222'
const NOTE_ID = '33333333-3333-4333-8333-333333333333'

function request(url: string, body?: unknown): NextRequest {
  return {
    url: `http://localhost${url}`,
    json: async () => {
      if (body === undefined) throw new SyntaxError('no body')
      return body
    },
  } as unknown as NextRequest
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function callsOf(method: string) {
  return DB.calls.filter((c) => c.method === method)
}

beforeEach(() => {
  AUTH.groupId = null
  DB.calls.length = 0
  DB.result = { data: null, error: null }
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('GET /api/notes', () => {
  it('liste les notes perso, plus récentes d’abord', async () => {
    DB.result = { data: [{ id: NOTE_ID, content: 'Payer la cantine' }], error: null }
    const { GET } = await import('../notes')

    const res = await GET(request('/api/notes?context=profile'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ notes: [{ id: NOTE_ID, content: 'Payer la cantine' }] })
    expect(callsOf('from')[0]?.args).toEqual(['notes'])
    expect(callsOf('eq').map((c) => c.args)).toEqual([['profile_id', USER_ID]])
    expect(callsOf('order')[0]?.args).toEqual(['created_at', { ascending: false }])
  })

  it('le contexte par défaut est perso', async () => {
    DB.result = { data: [], error: null }
    const { GET } = await import('../notes')

    await GET(request('/api/notes'))

    expect(callsOf('eq').map((c) => c.args)).toEqual([['profile_id', USER_ID]])
  })

  it('en groupe, liste les notes partagées du groupe', async () => {
    AUTH.groupId = GROUP_ID
    DB.result = { data: [], error: null }
    const { GET } = await import('../notes')

    const res = await GET(request('/api/notes?context=group'))

    expect(res.status).toBe(200)
    expect(callsOf('eq').map((c) => c.args)).toEqual([['group_id', GROUP_ID]])
  })

  it('en groupe sans groupe, renvoie une liste vide sans toucher la base', async () => {
    const { GET } = await import('../notes')

    const res = await GET(request('/api/notes?context=group'))

    expect(await res.json()).toEqual({ notes: [] })
    expect(DB.calls).toEqual([])
  })

  it('joint l’auteur par la FK nommée, sans jamais embarquer avatar_url', async () => {
    DB.result = { data: [], error: null }
    const { GET } = await import('../notes')

    await GET(request('/api/notes?context=profile'))

    const selected = String(callsOf('select')[0]?.args[0])
    expect(selected).toContain('created_by:profiles!notes_created_by_profile_id_fkey(')
    expect(selected).not.toContain('avatar_url')
  })

  it('refuse un contexte inconnu (400)', async () => {
    const { GET } = await import('../notes')

    const res = await GET(request('/api/notes?context=autre'))

    expect(res.status).toBe(400)
    expect(DB.calls).toEqual([])
  })

  it('remonte une erreur base en 500', async () => {
    DB.result = { data: null, error: { message: 'boom' } }
    const { GET } = await import('../notes')

    const res = await GET(request('/api/notes?context=profile'))

    expect(res.status).toBe(500)
  })
})

describe('POST /api/notes', () => {
  it('crée une note perso avec son auteur, contenu trimé', async () => {
    DB.result = { data: { id: NOTE_ID }, error: null }
    const { POST } = await import('../notes')

    const res = await POST(request('/api/notes?context=profile', { content: '  Rappel  ' }))

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ note: { id: NOTE_ID } })
    expect(callsOf('insert')[0]?.args[0]).toEqual({
      profile_id: USER_ID,
      created_by_profile_id: USER_ID,
      content: 'Rappel',
    })
  })

  it('crée une note de groupe rattachée au groupe, pas au profil', async () => {
    AUTH.groupId = GROUP_ID
    DB.result = { data: { id: NOTE_ID }, error: null }
    const { POST } = await import('../notes')

    await POST(request('/api/notes?context=group', { content: 'Courses samedi' }))

    expect(callsOf('insert')[0]?.args[0]).toEqual({
      group_id: GROUP_ID,
      created_by_profile_id: USER_ID,
      content: 'Courses samedi',
    })
  })

  it('refuse une note de groupe à un utilisateur sans groupe (400)', async () => {
    const { POST } = await import('../notes')

    const res = await POST(request('/api/notes?context=group', { content: 'x' }))

    expect(res.status).toBe(400)
    expect(callsOf('insert')).toEqual([])
  })

  it.each([
    ['vide', ''],
    ['uniquement des espaces', '   \n  '],
    ['trop longue', 'a'.repeat(1001)],
  ])('refuse une note %s (400)', async (_label, content) => {
    const { POST } = await import('../notes')

    const res = await POST(request('/api/notes?context=profile', { content }))

    expect(res.status).toBe(400)
    expect(callsOf('insert')).toEqual([])
  })

  it('accepte une note de exactement 1000 caractères', async () => {
    DB.result = { data: { id: NOTE_ID }, error: null }
    const { POST } = await import('../notes')

    const res = await POST(request('/api/notes?context=profile', { content: 'a'.repeat(1000) }))

    expect(res.status).toBe(201)
  })
})

describe('PUT /api/notes/[id]', () => {
  it('modifie le contenu d’une note du groupe, sans toucher à l’auteur', async () => {
    AUTH.groupId = GROUP_ID
    DB.result = { data: { id: NOTE_ID, content: 'Nouveau' }, error: null }
    const { PUT } = await import('../notes')

    const res = await PUT(request(`/api/notes/${NOTE_ID}`, { content: 'Nouveau' }), params(NOTE_ID))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ note: { id: NOTE_ID, content: 'Nouveau' } })
    expect(callsOf('update')[0]?.args[0]).toEqual({ content: 'Nouveau' })
    expect(callsOf('eq')[0]?.args).toEqual(['id', NOTE_ID])
    expect(callsOf('or')[0]?.args[0]).toBe(`profile_id.eq.${USER_ID},group_id.eq.${GROUP_ID}`)
  })

  it('sans groupe, ne peut viser que ses notes perso', async () => {
    DB.result = { data: { id: NOTE_ID }, error: null }
    const { PUT } = await import('../notes')

    await PUT(request(`/api/notes/${NOTE_ID}`, { content: 'x' }), params(NOTE_ID))

    expect(callsOf('or')[0]?.args[0]).toBe(`profile_id.eq.${USER_ID}`)
  })

  it('404 quand aucune note accessible ne correspond', async () => {
    DB.result = { data: null, error: null }
    const { PUT } = await import('../notes')

    const res = await PUT(request(`/api/notes/${NOTE_ID}`, { content: 'x' }), params(NOTE_ID))

    expect(res.status).toBe(404)
  })

  it('404 sur un identifiant invalide, sans toucher la base', async () => {
    const { PUT } = await import('../notes')

    const res = await PUT(request('/api/notes/abc', { content: 'x' }), params('abc'))

    expect(res.status).toBe(404)
    expect(DB.calls).toEqual([])
  })

  it('400 sur un contenu vide', async () => {
    const { PUT } = await import('../notes')

    const res = await PUT(request(`/api/notes/${NOTE_ID}`, { content: ' ' }), params(NOTE_ID))

    expect(res.status).toBe(400)
    expect(callsOf('update')).toEqual([])
  })
})

describe('DELETE /api/notes/[id]', () => {
  it('supprime une note accessible', async () => {
    AUTH.groupId = GROUP_ID
    DB.result = { data: { id: NOTE_ID }, error: null }
    const { DELETE } = await import('../notes')

    const res = await DELETE(request(`/api/notes/${NOTE_ID}`), params(NOTE_ID))

    expect(res.status).toBe(200)
    expect(callsOf('delete')).toHaveLength(1)
    expect(callsOf('or')[0]?.args[0]).toBe(`profile_id.eq.${USER_ID},group_id.eq.${GROUP_ID}`)
  })

  it('404 quand aucune note accessible ne correspond', async () => {
    DB.result = { data: null, error: null }
    const { DELETE } = await import('../notes')

    const res = await DELETE(request(`/api/notes/${NOTE_ID}`), params(NOTE_ID))

    expect(res.status).toBe(404)
  })

  it('404 sur un identifiant invalide, sans toucher la base', async () => {
    const { DELETE } = await import('../notes')

    const res = await DELETE(request('/api/notes/abc'), params('abc'))

    expect(res.status).toBe(404)
    expect(DB.calls).toEqual([])
  })
})
