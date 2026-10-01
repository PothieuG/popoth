/**
 * Régression 2026-10-01 — `useFinancialData(context, monthWindow)`. Le wizard
 * récap passe le mois RECAPÉ pour que le reste à vivre de l'étape 2 inclue les
 * dépassements de budget de ce mois-là, comme le dashboard de fin de mois.
 *
 * Ce qui compte : l'URL (fenêtre transmise), une entrée de cache distincte de
 * celle des dashboards, le rafraîchissement après une saisie, et le solde mis
 * à jour sans refetch après un appui long (`applyBankBalanceToCache`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { FinancialMonthWindow } from '@/lib/finance'
import { applyBankBalanceToCache, invalidateFinancialRefreshes } from '@/lib/query-client'

import { useFinancialData } from '../useFinancialData'

function Harness({
  context,
  monthWindow,
  testId,
}: {
  context?: 'profile' | 'group'
  monthWindow?: FinancialMonthWindow
  testId: string
}) {
  const { financialData } = useFinancialData(context, monthWindow)
  return (
    <span data-testid={testId}>
      {financialData ? `${financialData.remainingToLive}|${financialData.availableBalance}` : '-'}
    </span>
  )
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
        data: { remainingToLive: url.includes('month=9') ? 1600 : 1633.57, availableBalance: 1200 },
        context: 'profile',
        timestamp: 0,
      }),
    })),
  )
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('useFinancialData — fenêtre mensuelle', () => {
  it('sans fenêtre : URL et clé de cache des dashboards inchangées', async () => {
    const qc = makeClient()
    render(
      <QueryClientProvider client={qc}>
        <Harness context="profile" testId="rav" />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('rav')).toHaveTextContent('1633.57|1200'))
    expect(fetch).toHaveBeenCalledWith('/api/finance/summary?context=profile', {
      method: 'GET',
      credentials: 'include',
    })
    expect(qc.getQueryData(['financial-summary', 'profile'])).toBeDefined()
  })

  it('avec fenêtre : transmet month/year et garde une entrée de cache à part', async () => {
    const qc = makeClient()
    render(
      <QueryClientProvider client={qc}>
        <Harness context="profile" testId="dashboard" />
        <Harness context="profile" monthWindow={{ month: 9, year: 2026 }} testId="recap" />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('recap')).toHaveTextContent('1600|1200'))
    expect(screen.getByTestId('dashboard')).toHaveTextContent('1633.57|1200')
    expect(fetch).toHaveBeenCalledWith('/api/finance/summary?context=profile&month=9&year=2026', {
      method: 'GET',
      credentials: 'include',
    })
    expect(qc.getQueryData(['financial-summary', 'profile', 2026, 9])).toBeDefined()
  })

  it('se rafraîchit après une saisie (invalidateFinancialRefreshes)', async () => {
    const qc = makeClient()
    render(
      <QueryClientProvider client={qc}>
        <Harness context="profile" monthWindow={{ month: 9, year: 2026 }} testId="recap" />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('recap')).toHaveTextContent('1600|1200'))
    expect(fetch).toHaveBeenCalledTimes(1)

    await invalidateFinancialRefreshes(qc)

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('appui long : le solde est patché aussi dans le résumé fenêtré, sans refetch', async () => {
    const qc = makeClient()
    render(
      <QueryClientProvider client={qc}>
        <Harness context="profile" monthWindow={{ month: 9, year: 2026 }} testId="recap" />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('recap')).toHaveTextContent('1600|1200'))

    applyBankBalanceToCache(qc, 'profile', 950)

    await waitFor(() => expect(screen.getByTestId('recap')).toHaveTextContent('1600|950'))
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
