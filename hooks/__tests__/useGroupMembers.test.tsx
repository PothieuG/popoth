/**
 * Sprint Perf-Toggle-Targeted-Refresh (2026-09-10) — `useGroupMembers` migré
 * de `useState` + fetch impératif vers TanStack Query.
 *
 * Ce qui compte ici : le CACHE. L'ancien hook n'en avait pas — chaque bascule
 * perso → groupe relançait `GET /api/groups/[id]/members` et repassait
 * l'en-tête du dashboard groupe en skeleton, pour une liste qui ne change
 * qu'aux rares moments où quelqu'un rejoint ou quitte le groupe.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useGroupMembers } from '../useGroupMembers'

const GROUP_ID = '92dbf6f2-0000-4000-8000-000000000001'
const MEMBERS = [
  { id: 'a', first_name: 'Alice', last_name: 'A', avatar_url: null, joined_at: '2026-01-01' },
  { id: 'b', first_name: 'Bob', last_name: 'B', avatar_url: null, joined_at: '2026-02-01' },
]

function Harness({ groupId, enabled }: { groupId: string | null; enabled?: boolean }) {
  const { members, isLoading, error } = useGroupMembers(groupId, { enabled })
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="count">{members.length}</span>
      <span data-testid="error">{error ?? 'none'}</span>
    </div>
  )
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
}

function renderHarness(qc: QueryClient, props: { groupId: string | null; enabled?: boolean }) {
  return render(
    <QueryClientProvider client={qc}>
      <Harness {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ members: MEMBERS }) })),
  )
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('useGroupMembers', () => {
  it('charge les membres du groupe et les sert au composant', async () => {
    renderHarness(makeClient(), { groupId: GROUP_ID })

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(`/api/groups/${GROUP_ID}/members`, {
      method: 'GET',
      credentials: 'include',
    })
  })

  it('ne requête rien sans groupId ni quand `enabled` est faux (contexte perso)', async () => {
    const qc = makeClient()
    renderHarness(qc, { groupId: null })
    renderHarness(qc, { groupId: GROUP_ID, enabled: false })

    // Laisse passer les effets : un fetch au montage se serait déjà produit.
    await waitFor(() => expect(screen.getAllByTestId('count')[0]).toHaveTextContent('0'))
    expect(fetch).not.toHaveBeenCalled()
    // `isLoading` reste faux : pas de skeleton en-tête tant qu'on n'est pas en groupe.
    expect(screen.getAllByTestId('loading').every((el) => el.textContent === 'false')).toBe(true)
  })

  it('sert le cache au montage suivant (bascule perso → groupe) : 1 seul fetch', async () => {
    const qc = makeClient()
    const first = renderHarness(qc, { groupId: GROUP_ID })
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'))
    first.unmount()

    // Second montage — l'en-tête qui repasse en contexte groupe, ou la modal
    // « Voir les membres » : même key, données déjà là, aucun appel.
    renderHarness(qc, { groupId: GROUP_ID })
    expect(screen.getByTestId('count')).toHaveTextContent('2')
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('remonte le message d’erreur de l’API sans planter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: "Vous n'êtes pas membre de ce groupe" }),
      })),
    )
    renderHarness(makeClient(), { groupId: GROUP_ID })

    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent("Vous n'êtes pas membre de ce groupe"),
    )
    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })
})
