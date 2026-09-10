/**
 * Sprint Perf-Toggle-Targeted-Refresh (2026-09-10) — `useRealIncomes`, miroir
 * de `useRealExpenses.toggle.test.tsx`. Même invariant : un long-press = 1 seul
 * appel réseau, le solde renvoyé par la RPC est écrit en cache, aucune des 11
 * keys financières n'est relancée.
 *
 * Cas propre aux revenus : le revenu miroir « Contribution de X » du dashboard
 * groupe. Le valider bascule aussi la dépense miroir du dashboard perso du
 * membre — l'autre liste, l'autre solde.
 */

import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useRealIncomes, type RealIncome } from '../useRealIncomes'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const INCOME_ID = '44444444-4444-4444-8444-444444444444'
const MIRROR_EXPENSE_ID = '55555555-5555-4555-8555-555555555555'
const SERVER_AT = '2026-09-10T12:00:00.000Z'

function income(id: string, amount: number, overrides: Partial<RealIncome> = {}): RealIncome {
  return {
    id,
    amount,
    description: `Revenu ${id.slice(0, 2)}`,
    entry_date: '2026-09-05',
    is_exceptional: false,
    created_at: '2026-09-05T10:00:00.000Z',
    applied_to_balance_at: null,
    last_applied_amount: null,
    ...overrides,
  } as RealIncome
}

// Exposé via un effet (pas pendant le rendu — règle react-hooks/globals).
const hookRef: { current: ReturnType<typeof useRealIncomes> | null } = { current: null }

function Harness() {
  const api = useRealIncomes('group')
  useEffect(() => {
    hookRef.current = api
  })
  const row = api.incomes.find((i) => i.id === INCOME_ID)
  return (
    <div>
      <span data-testid="applied">{row?.applied_to_balance_at ?? 'null'}</span>
      <span data-testid="last">{String(row?.last_applied_amount ?? 'null')}</span>
    </div>
  )
}

function setup(rows: RealIncome[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  qc.setQueryData(['real-incomes', 'group'], rows)
  qc.setQueryData(['bank-balance', 'group'], { balance: 2000 })
  qc.setQueryData(['financial-summary', 'group'], {
    data: { availableBalance: 2000, remainingToLive: 800 },
    context: 'group',
    timestamp: 1,
  })
  render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  )
  return qc
}

const CALLS: { url: string; method: string }[] = []

function stubFetch(handler: (url: string, method: string) => { status: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      CALLS.push({ url: input, method })
      const { status, body } = handler(input, method)
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: String(status),
        json: async () => body,
        text: async () => JSON.stringify(body),
      }
    }),
  )
}

beforeEach(() => {
  CALLS.length = 0
  hookRef.current = null
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('useRealIncomes.toggleApplied — rafraîchissement ciblé', () => {
  it('chemin nominal : 1 seul appel, solde groupe écrit en cache, rien d’invalidé', async () => {
    stubFetch(() => ({
      status: 200,
      body: { data: { balance: 2300, appliedToBalanceAt: SERVER_AT } },
    }))
    const qc = setup([income(INCOME_ID, 300)])

    const outcome = await act(async () => hookRef.current!.toggleApplied(INCOME_ID, true))

    expect(outcome).toBe('applied')
    expect(CALLS).toEqual([{ url: '/api/finance/income/real/toggle-applied', method: 'POST' }])
    await waitFor(() => expect(screen.getByTestId('applied')).toHaveTextContent(SERVER_AT))
    expect(screen.getByTestId('last')).toHaveTextContent('300')
    expect(qc.getQueryData(['bank-balance', 'group'])).toEqual({ balance: 2300 })
    expect(qc.getQueryData(['financial-summary', 'group'])).toEqual({
      data: { availableBalance: 2300, remainingToLive: 800 },
      context: 'group',
      timestamp: 1,
    })
    expect(qc.getQueryState(['real-incomes', 'group'])?.isInvalidated).toBe(false)
    expect(qc.getQueryState(['financial-summary', 'group'])?.isInvalidated).toBe(false)
  })

  it('revenu miroir « Contribution de X » : la dépense perso du membre bascule aussi', async () => {
    stubFetch(() => ({
      status: 200,
      body: {
        data: {
          balance: 2300,
          appliedToBalanceAt: SERVER_AT,
          pair: {
            expenseId: MIRROR_EXPENSE_ID,
            incomeId: INCOME_ID,
            expenseChanged: true,
            incomeChanged: true,
            expenseBalance: 700,
            incomeBalance: 2300,
            applied: true,
          },
        },
      },
    }))
    const qc = setup([income(INCOME_ID, 300, { contribution_id: 'contrib-1' })])
    qc.setQueryData(
      ['real-expenses', 'profile'],
      [
        {
          id: MIRROR_EXPENSE_ID,
          amount: 300,
          contribution_id: 'contrib-1',
          applied_to_balance_at: null,
        },
      ],
    )
    qc.setQueryData(['bank-balance', 'profile'], { balance: 1000 })

    await act(async () => hookRef.current!.toggleApplied(INCOME_ID, true))

    expect(CALLS).toHaveLength(1)
    expect(qc.getQueryData(['bank-balance', 'group'])).toEqual({ balance: 2300 })
    expect(qc.getQueryData(['bank-balance', 'profile'])).toEqual({ balance: 700 })
    expect(
      qc.getQueryData<Record<string, unknown>[]>(['real-expenses', 'profile'])![0],
    ).toMatchObject({
      id: MIRROR_EXPENSE_ID,
      applied_to_balance_at: SERVER_AT,
      last_applied_amount: 300,
    })
  })

  it('409 : no-op puis convergence ciblée (liste + 2 vues du solde groupe)', async () => {
    stubFetch((_url, method) =>
      method === 'POST'
        ? { status: 409, body: { error: 'already-in-target-state' } }
        : { status: 200, body: { real_incomes: [income(INCOME_ID, 300)] } },
    )
    const qc = setup([income(INCOME_ID, 300)])

    const outcome = await act(async () => hookRef.current!.toggleApplied(INCOME_ID, true))

    expect(outcome).toBe('no-op')
    expect(CALLS.map((c) => c.method)).toEqual(['POST', 'GET'])
    expect(qc.getQueryState(['bank-balance', 'group'])?.isInvalidated).toBe(true)
    expect(qc.getQueryState(['financial-summary', 'group'])?.isInvalidated).toBe(true)
  })
})
