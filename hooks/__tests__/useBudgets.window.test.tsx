/**
 * Régression 2026-10-01 — `useBudgets(context, monthWindow)`. Le wizard récap
 * passe le mois RECAPÉ pour que le menu « Budget associé » affiche le dépensé
 * de ce mois-là, et non celui du mois courant (vide en début de mois).
 *
 * Ce qui compte : l'URL (fenêtre transmise au serveur), une entrée de cache
 * distincte de celle des dashboards (le dépensé diffère), et le rafraîchissement
 * après une saisie (clé sous le préfixe `['budgets']`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { invalidateFinancialRefreshes } from '@/lib/query-client'

import { useBudgets, type BudgetsMonthWindow } from '../useBudgets'

function Harness({
  context,
  monthWindow,
  testId,
}: {
  context?: 'profile' | 'group'
  monthWindow?: BudgetsMonthWindow
  testId: string
}) {
  const { budgets } = useBudgets(context, monthWindow)
  return <span data-testid={testId}>{budgets[0]?.spent_this_month ?? 'none'}</span>
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        estimated_budgets: [
          { id: 'b1', name: 'Roi Lion', spent_this_month: url.includes('month=9') ? 35 : 0 },
        ],
      }),
    })),
  )
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('useBudgets — fenêtre mensuelle', () => {
  it('sans fenêtre : URL et clé de cache des dashboards inchangées', async () => {
    const qc = makeClient()
    render(
      <QueryClientProvider client={qc}>
        <Harness context="profile" testId="spent" />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('spent')).toHaveTextContent('0'))
    expect(fetch).toHaveBeenCalledWith('/api/finance/budgets/estimated?group=false', {
      method: 'GET',
      credentials: 'include',
    })
    expect(qc.getQueryData(['budgets', 'profile'])).toBeDefined()
  })

  it('avec fenêtre : transmet month/year et garde une entrée de cache à part', async () => {
    const qc = makeClient()
    render(
      <QueryClientProvider client={qc}>
        <Harness context="profile" testId="dashboard" />
        <Harness context="profile" monthWindow={{ month: 9, year: 2026 }} testId="recap" />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('recap')).toHaveTextContent('35'))
    expect(screen.getByTestId('dashboard')).toHaveTextContent('0')
    expect(fetch).toHaveBeenCalledWith(
      '/api/finance/budgets/estimated?group=false&month=9&year=2026',
      { method: 'GET', credentials: 'include' },
    )
    expect(qc.getQueryData(['budgets', 'profile', 2026, 9])).toBeDefined()
  })

  it('se rafraîchit après une saisie (invalidateFinancialRefreshes)', async () => {
    const qc = makeClient()
    render(
      <QueryClientProvider client={qc}>
        <Harness context="group" monthWindow={{ month: 9, year: 2026 }} testId="recap" />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('recap')).toHaveTextContent('35'))
    expect(fetch).toHaveBeenCalledTimes(1)

    await invalidateFinancialRefreshes(qc)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/finance/budgets/estimated?group=true&month=9&year=2026',
      { method: 'GET', credentials: 'include' },
    )
  })
})
