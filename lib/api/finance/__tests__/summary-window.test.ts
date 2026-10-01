/**
 * Régression 2026-10-01 — `GET /finance/summary` transmet la fenêtre du mois
 * recapé (`month`/`year`) au calcul du RAV. Le wizard récap « Compléter le
 * mois » s'en sert pour afficher le même reste à vivre que le dashboard de fin
 * de mois (cf. `lib/finance/__tests__/financial-data-recap-window.test.ts`).
 */

import type { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const getProfileFinancialData = vi.fn()
const getGroupFinancialData = vi.fn()

vi.mock('@/lib/finance', () => ({
  getProfileFinancialData: (...args: unknown[]) => getProfileFinancialData(...args),
  getGroupFinancialData: (...args: unknown[]) => getGroupFinancialData(...args),
}))

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndGroup: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, { userId: 'user-1', groupId: 'group-1' }),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

function req(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('GET /finance/summary — fenêtre du mois recapé', () => {
  it('profil : month/year transmis au calcul', async () => {
    getProfileFinancialData.mockResolvedValue({ remainingToLive: 1600 })
    const { GET } = await import('../summary')

    await GET(req('http://x/api/finance/summary?context=profile&month=9&year=2026'))

    expect(getProfileFinancialData).toHaveBeenCalledWith('user-1', { month: 9, year: 2026 })
  })

  it('groupe : month/year transmis au calcul', async () => {
    getGroupFinancialData.mockResolvedValue({ remainingToLive: 0 })
    const { GET } = await import('../summary')

    await GET(req('http://x/api/finance/summary?context=group&month=12&year=2025'))

    expect(getGroupFinancialData).toHaveBeenCalledWith('group-1', { month: 12, year: 2025 })
  })

  it('dashboards (sans paramètre, ou un seul des deux) : mois courant', async () => {
    getProfileFinancialData.mockResolvedValue({ remainingToLive: 0 })
    const { GET } = await import('../summary')

    await GET(req('http://x/api/finance/summary?context=profile'))
    await GET(req('http://x/api/finance/summary?context=profile&month=9'))

    expect(getProfileFinancialData).toHaveBeenNthCalledWith(1, 'user-1', undefined)
    expect(getProfileFinancialData).toHaveBeenNthCalledWith(2, 'user-1', undefined)
  })
})
