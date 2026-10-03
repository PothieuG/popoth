/**
 * Sprint Notes-Tabs (2026-10-03) — `useNotes`, la query partagée par les 3
 * onglets du drawer Notes et le compteur du dashboard.
 *
 * Ce qui est pinné :
 *   - le compteur (`pendingCount`) exclut les seuls articles de courses cochés ;
 *   - l'ajout envoie l'onglet (`kind`) avec le contenu ;
 *   - la case des courses est optimiste : le cache change avant la réponse,
 *     prend la ligne du serveur au succès, revient en arrière en cas d'échec.
 */

import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { isPendingNote, useNotes, type Note } from '../useNotes'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const SERVER_AT = '2026-10-03T12:00:00.000000+00:00'

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    profile_id: '99999999-9999-4999-8999-999999999999',
    group_id: null,
    created_by_profile_id: '99999999-9999-4999-8999-999999999999',
    kind: 'note',
    content: `Contenu ${id}`,
    checked_at: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    created_by: null,
    ...overrides,
  }
}

function setup(rows: Note[]) {
  // `staleTime: Infinity` + cache pré-rempli : le montage ne déclenche aucun GET.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  qc.setQueryData(['notes', 'profile'], rows)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useNotes('profile'), { wrapper })
  return { qc, hook }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('isPendingNote / pendingCount', () => {
  it('compte tout sauf les courses cochées', () => {
    const { hook } = setup([
      note('a', { kind: 'shopping' }),
      note('b', { kind: 'shopping', checked_at: SERVER_AT }),
      note('c', { kind: 'note' }),
      note('d', { kind: 'project' }),
    ])

    expect(hook.result.current.pendingCount).toBe(3)
    expect(isPendingNote({ kind: 'shopping', checked_at: SERVER_AT })).toBe(false)
    expect(isPendingNote({ kind: 'shopping', checked_at: null })).toBe(true)
  })
})

describe('addNote', () => {
  it('envoie l’onglet avec le contenu et place la ligne en tête', async () => {
    const created = note('new', { kind: 'shopping', content: 'Lait' })
    const fetchMock = vi.fn(async () => jsonResponse({ note: created }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const { qc, hook } = setup([note('a')])

    let ok = false
    await act(async () => {
      ok = await hook.result.current.addNote('Lait', 'shopping')
    })

    expect(ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/notes?context=profile')
    expect(JSON.parse(String(init.body))).toEqual({ content: 'Lait', kind: 'shopping' })
    expect(qc.getQueryData<Note[]>(['notes', 'profile'])?.map((n) => n.id)).toEqual(['new', 'a'])
  })

  it('onglet Notes par défaut', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ note: note('new') }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const { hook } = setup([])

    await act(async () => {
      await hook.result.current.addNote('Rappel')
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ content: 'Rappel', kind: 'note' })
  })
})

describe('toggleChecked', () => {
  it('coche tout de suite, puis garde l’horodatage du serveur', async () => {
    let resolveFetch: (r: Response) => void = () => {}
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { qc, hook } = setup([note(ITEM_ID, { kind: 'shopping' })])

    let pending: Promise<boolean> = Promise.resolve(false)
    act(() => {
      pending = hook.result.current.toggleChecked(ITEM_ID, true)
    })

    // Avant toute réponse : la case est déjà cochée dans le cache.
    await waitFor(() =>
      expect(qc.getQueryData<Note[]>(['notes', 'profile'])?.[0]?.checked_at).not.toBeNull(),
    )
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`/api/notes/${ITEM_ID}`)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ checked: true })

    await act(async () => {
      resolveFetch(
        jsonResponse({ note: note(ITEM_ID, { kind: 'shopping', checked_at: SERVER_AT }) }),
      )
      expect(await pending).toBe(true)
    })
    expect(qc.getQueryData<Note[]>(['notes', 'profile'])?.[0]?.checked_at).toBe(SERVER_AT)
  })

  it('en cas d’échec, ne défait que l’article concerné', async () => {
    const OTHER_ID = '22222222-2222-4222-8222-222222222222'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith(ITEM_ID)
          ? jsonResponse({ error: 'Erreur serveur' }, 500)
          : jsonResponse({ note: note(OTHER_ID, { kind: 'shopping', checked_at: SERVER_AT }) }),
      ),
    )
    const { qc, hook } = setup([
      note(ITEM_ID, { kind: 'shopping' }),
      note(OTHER_ID, { kind: 'shopping' }),
    ])

    await act(async () => {
      await Promise.all([
        hook.result.current.toggleChecked(ITEM_ID, true),
        hook.result.current.toggleChecked(OTHER_ID, true),
      ])
    })

    const rows = qc.getQueryData<Note[]>(['notes', 'profile'])
    expect(rows?.find((n) => n.id === ITEM_ID)?.checked_at).toBeNull()
    expect(rows?.find((n) => n.id === OTHER_ID)?.checked_at).toBe(SERVER_AT)
  })

  it('revient en arrière si l’API échoue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Note non trouvée' }, 404)),
    )
    const { qc, hook } = setup([note(ITEM_ID, { kind: 'shopping', checked_at: SERVER_AT })])

    let ok = true
    await act(async () => {
      ok = await hook.result.current.toggleChecked(ITEM_ID, false)
    })

    expect(ok).toBe(false)
    expect(qc.getQueryData<Note[]>(['notes', 'profile'])?.[0]?.checked_at).toBe(SERVER_AT)
  })
})
