/**
 * Part 50 — `useSavingsTransfer`. Un transfert d'économies ne change que le
 * solde disponible : le hook écrit le solde renvoyé par la route dans les 2
 * caches qui l'affichent, sans relancer les 11 keys financières.
 */

import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useSavingsTransfer } from '../useSavingsTransfer'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

function setup(context: 'profile' | 'group') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['bank-balance', context], { balance: 1000 })
  qc.setQueryData(['financial-summary', context], {
    data: { availableBalance: 1000, remainingToLive: 500, totalSavings: 300 },
  })
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useSavingsTransfer(context), { wrapper })
  return { qc, invalidate, result }
}

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('useSavingsTransfer', () => {
  it('envoie le contexte, le sens et le montant, puis patche le solde affiché', async () => {
    const fetchMock = mockFetch(200, { data: { balance: 850 } })
    const { qc, invalidate, result } = setup('group')

    let outcome: Awaited<ReturnType<typeof result.current.transfer>> | undefined
    await act(async () => {
      outcome = await result.current.transfer({ direction: 'send', amount: 150 })
    })

    expect(outcome).toEqual({ ok: true, balance: 850 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/finance/savings-transfer')
    expect(JSON.parse(String(init.body))).toEqual({
      context: 'group',
      direction: 'send',
      amount: 150,
    })
    expect(qc.getQueryData(['bank-balance', 'group'])).toEqual({ balance: 850 })
    // Seul le solde change : reste à vivre et économies intacts.
    expect(qc.getQueryData(['financial-summary', 'group'])).toEqual({
      data: { availableBalance: 850, remainingToLive: 500, totalSavings: 300 },
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it("renvoie le code d'erreur de la route sans toucher au cache", async () => {
    mockFetch(409, { error: 'savings-transfer-exceeds-savings' })
    const { qc, result } = setup('profile')

    let outcome: Awaited<ReturnType<typeof result.current.transfer>> | undefined
    await act(async () => {
      outcome = await result.current.transfer({ direction: 'receive', amount: 999 })
    })

    expect(outcome).toEqual({ ok: false, error: 'savings-transfer-exceeds-savings' })
    expect(qc.getQueryData(['bank-balance', 'profile'])).toEqual({ balance: 1000 })
  })
})
