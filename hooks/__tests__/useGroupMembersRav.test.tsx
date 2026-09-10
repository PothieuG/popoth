/**
 * Sprint Perf-Group-Members-Rav-Lazy (2026-09-10) — `useGroupMembersRav`.
 *
 * Ces tests portent sur UNE seule chose, mais c'est celle dont dépend tout le
 * gain de perf : le `enabled`.
 *
 * Le `PlanningDrawer` est rendu (fermé) par `<FinancialIndicators>` dès le
 * premier rendu du dashboard. Si le hook fetchait au montage, on aurait
 * seulement déplacé le N+1 de `GET /api/finance/summary` vers
 * `GET /api/finance/group-members-rav` — le dashboard groupe resterait aussi
 * lent qu'avant, pour exactement le même travail serveur.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useGroupMembersRav } from '../useGroupMembersRav'

const MEMBERS = [
  { profileId: 'p1', firstName: 'Alice', salary: 1500, currentRav: 1300 },
  { profileId: 'p2', firstName: 'Zoé', salary: 2000, currentRav: 1500 },
]

function Harness({ enabled }: { enabled: boolean }) {
  const { groupMembersRav, isLoading } = useGroupMembersRav(enabled)
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="count">{groupMembersRav?.length ?? 'none'}</span>
    </div>
  )
}

function renderHarness(enabled: boolean) {
  // `retry: false` — sans ça, un test d'erreur attendrait le backoff.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Harness enabled={enabled} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: MEMBERS }) })),
  )
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('useGroupMembersRav', () => {
  it('ne requête RIEN tant que le drawer est fermé', async () => {
    renderHarness(false)

    // Laisse passer les effets : un fetch au montage se serait déjà produit.
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('none'))
    expect(fetch).not.toHaveBeenCalled()
  })

  it("requête une fois le drawer ouvert, et sert le tableau de l'API", async () => {
    renderHarness(true)

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/finance/group-members-rav', {
      method: 'GET',
      credentials: 'include',
    })
  })

  it('remonte une erreur HTTP sans planter le composant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' })),
    )
    renderHarness(true)

    // Pas de données, pas de crash : les modals retombent sur leur branche
    // « pas de recap par membre » (`groupMembersRav?.length === 0` → []).
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('count')).toHaveTextContent('none')
  })
})
