/**
 * Sprint Perf-Toggle-Targeted-Refresh (2026-09-10) — `useRealExpenses`, les 2
 * toggles « appliqué au solde » (long-press) et « valider un report ».
 *
 * Ce que ces tests pinnent : après un long-press, le hook n'appelle PLUS
 * `invalidateFinancialRefreshes`. Avant, un toggle relançait les 11 keys
 * financières (~12 appels d'API en parallèle) et refetchait la liste
 * elle-même — que `TransactionTabsComponent` remplaçait alors par un skeleton
 * jusqu'au retour de tout le lot. Or un toggle ne change que
 * `bank_balances.balance` : la RPC renvoie le nouveau solde, on l'écrit dans
 * les 2 caches qui l'affichent, et c'est tout.
 *
 * Invariant central : sur le chemin nominal, `fetch` est appelé EXACTEMENT une
 * fois (le POST). Toute réintroduction d'une invalidation large ferait partir
 * un GET de plus dès que la liste est observée — et casserait ce test.
 */

import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useRealExpenses, type RealExpense } from '../useRealExpenses'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const EXPENSE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const MIRROR_INCOME_ID = '33333333-3333-4333-8333-333333333333'
const SERVER_AT = '2026-09-10T12:00:00.000Z'

function expense(id: string, amount: number, overrides: Partial<RealExpense> = {}): RealExpense {
  return {
    id,
    amount,
    description: `Dépense ${id.slice(0, 2)}`,
    expense_date: '2026-09-05',
    is_exceptional: false,
    created_at: '2026-09-05T10:00:00.000Z',
    applied_to_balance_at: null,
    last_applied_amount: null,
    ...overrides,
  }
}

type Ctx = 'profile' | 'group'

// Exposé via un effet (pas pendant le rendu — règle react-hooks/globals).
const hookRef: { current: ReturnType<typeof useRealExpenses> | null } = { current: null }

function Harness({ context }: { context: Ctx }) {
  const api = useRealExpenses(context)
  useEffect(() => {
    hookRef.current = api
  })
  const row = api.expenses.find((e) => e.id === EXPENSE_ID)
  return (
    <div>
      <span data-testid="applied">{row?.applied_to_balance_at ?? 'null'}</span>
      <span data-testid="last">{String(row?.last_applied_amount ?? 'null')}</span>
      <span data-testid="carried">{String(row?.is_carried_over ?? 'undefined')}</span>
    </div>
  )
}

function setup(
  context: Ctx,
  rows: RealExpense[] = [expense(EXPENSE_ID, 150), expense(OTHER_ID, 20)],
) {
  // `staleTime: Infinity` + caches pré-remplis : le montage du hook ne
  // déclenche aucun GET. Le seul `fetch` attendu est donc le POST du toggle.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  qc.setQueryData(['real-expenses', context], rows)
  qc.setQueryData(['bank-balance', context], { balance: 1000 })
  qc.setQueryData(['financial-summary', context], {
    data: { availableBalance: 1000, remainingToLive: 500 },
    context,
    timestamp: 1,
  })
  render(
    <QueryClientProvider client={qc}>
      <Harness context={context} />
    </QueryClientProvider>,
  )
  return qc
}

type FetchCall = { url: string; method: string }
const CALLS: FetchCall[] = []

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

const toggleOk = (balance: number, extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: { data: { balance, appliedToBalanceAt: SERVER_AT, ...extra } },
})

beforeEach(() => {
  CALLS.length = 0
  hookRef.current = null
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

async function toggle(apply: boolean) {
  return act(async () => hookRef.current!.toggleApplied(EXPENSE_ID, apply))
}

describe('useRealExpenses.toggleApplied — rafraîchissement ciblé', () => {
  it('chemin nominal (groupe) : 1 seul appel réseau, solde écrit en cache, rien d’invalidé', async () => {
    stubFetch(() => toggleOk(850))
    const qc = setup('group')

    const outcome = await toggle(true)

    expect(outcome).toBe('applied')
    // LE pin : le POST, et rien d'autre — pas de tempête d'invalidations.
    expect(CALLS).toEqual([{ url: '/api/finance/expenses/real/toggle-applied', method: 'POST' }])

    // La ligne porte le timestamp serveur + `last_applied_amount = amount`.
    // `waitFor` : TanStack notifie les observers en différé (setTimeout 0),
    // le re-rendu peut tomber juste après l'`act`. Le cache, lui, est déjà à jour.
    await waitFor(() => expect(screen.getByTestId('applied')).toHaveTextContent(SERVER_AT))
    expect(screen.getByTestId('last')).toHaveTextContent('150')

    // Le solde renvoyé par la RPC est dans les 2 caches qui l'affichent…
    expect(qc.getQueryData(['bank-balance', 'group'])).toEqual({ balance: 850 })
    expect(qc.getQueryData(['financial-summary', 'group'])).toEqual({
      data: { availableBalance: 850, remainingToLive: 500 }, // RAV intact
      context: 'group',
      timestamp: 1,
    })

    // …et aucune query n'a été marquée périmée.
    for (const key of [
      ['real-expenses', 'group'],
      ['bank-balance', 'group'],
      ['financial-summary', 'group'],
    ]) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(false)
    }
  })

  it('retirer du solde : `last_applied_amount` repasse à NULL comme dans la RPC', async () => {
    stubFetch(() => ({
      status: 200,
      body: { data: { balance: 1150, appliedToBalanceAt: null } },
    }))
    const qc = setup('profile', [
      expense(EXPENSE_ID, 150, { applied_to_balance_at: SERVER_AT, last_applied_amount: 150 }),
    ])

    const outcome = await toggle(false)

    expect(outcome).toBe('unapplied')
    expect(CALLS).toHaveLength(1)
    await waitFor(() => expect(screen.getByTestId('applied')).toHaveTextContent('null'))
    expect(screen.getByTestId('last')).toHaveTextContent('null')
    expect(qc.getQueryData(['bank-balance', 'profile'])).toEqual({ balance: 1150 })
  })

  it('miroir contribution : les 2 contextes reçoivent leur solde, le revenu groupe bascule aussi', async () => {
    stubFetch(() =>
      toggleOk(900, {
        pair: {
          expenseId: EXPENSE_ID,
          incomeId: MIRROR_INCOME_ID,
          expenseChanged: true,
          incomeChanged: true,
          expenseBalance: 900,
          incomeBalance: 2150,
          applied: true,
        },
      }),
    )
    const qc = setup('profile', [
      expense(EXPENSE_ID, 150, { contribution_id: 'contrib-1', last_applied_amount: 120 }),
    ])
    // Le revenu miroir vit côté groupe, dans une autre liste.
    qc.setQueryData(
      ['real-incomes', 'group'],
      [
        {
          id: MIRROR_INCOME_ID,
          amount: 150,
          contribution_id: 'contrib-1',
          applied_to_balance_at: null,
        },
        { id: OTHER_ID, amount: 10, applied_to_balance_at: null },
      ],
    )
    qc.setQueryData(['bank-balance', 'group'], { balance: 2000 })
    qc.setQueryData(['financial-summary', 'group'], {
      data: { availableBalance: 2000, remainingToLive: 800 },
      context: 'group',
      timestamp: 1,
    })

    await toggle(true)

    expect(CALLS).toHaveLength(1)
    expect(qc.getQueryData(['bank-balance', 'profile'])).toEqual({ balance: 900 })
    expect(qc.getQueryData(['bank-balance', 'group'])).toEqual({ balance: 2150 })
    expect(
      (qc.getQueryData(['financial-summary', 'group']) as { data: { availableBalance: number } })
        .data.availableBalance,
    ).toBe(2150)

    const incomes = qc.getQueryData<Record<string, unknown>[]>(['real-incomes', 'group'])!
    expect(incomes[0]).toMatchObject({
      id: MIRROR_INCOME_ID,
      applied_to_balance_at: SERVER_AT,
      last_applied_amount: 150,
    })
    expect(incomes[1]).toMatchObject({ id: OTHER_ID, applied_to_balance_at: null })
    // Drift résorbé côté perso : 120 → 150.
    await waitFor(() => expect(screen.getByTestId('last')).toHaveTextContent('150'))
  })

  it('miroir contribution : un côté déjà à jour (solde null) garde son solde en cache', async () => {
    stubFetch(() =>
      toggleOk(900, {
        pair: {
          expenseId: EXPENSE_ID,
          incomeId: MIRROR_INCOME_ID,
          expenseChanged: true,
          incomeChanged: false,
          expenseBalance: 900,
          incomeBalance: null,
          applied: true,
        },
      }),
    )
    const qc = setup('profile', [expense(EXPENSE_ID, 150, { contribution_id: 'contrib-1' })])
    qc.setQueryData(['bank-balance', 'group'], { balance: 2000 })

    await toggle(true)

    expect(qc.getQueryData(['bank-balance', 'profile'])).toEqual({ balance: 900 })
    // Pas de mouvement côté groupe → on n'écrit pas un 0 par-dessus le vrai solde.
    expect(qc.getQueryData(['bank-balance', 'group'])).toEqual({ balance: 2000 })
  })

  it('409 (déjà dans l’état cible) : no-op, puis convergence ciblée — liste + 2 vues du solde', async () => {
    stubFetch((_url, method) =>
      method === 'POST'
        ? { status: 409, body: { error: 'already-in-target-state' } }
        : {
            status: 200,
            body: {
              real_expenses: [expense(EXPENSE_ID, 150, { applied_to_balance_at: SERVER_AT })],
            },
          },
    )
    const qc = setup('group')

    const outcome = await toggle(true)

    expect(outcome).toBe('no-op')
    // La liste est observée → son invalidation déclenche UN refetch, et un
    // seul : les keys non observées (solde, résumé) sont juste marquées.
    expect(CALLS.map((c) => c.method)).toEqual(['POST', 'GET'])
    expect(CALLS[1]?.url).toContain('/api/finance/expenses/real?')
    expect(qc.getQueryState(['bank-balance', 'group'])?.isInvalidated).toBe(true)
    expect(qc.getQueryState(['financial-summary', 'group'])?.isInvalidated).toBe(true)
    // Aucune key perso touchée.
    expect(qc.getQueryState(['bank-balance', 'profile'])).toBeUndefined()
  })

  it('erreur serveur : rollback de la ligne + convergence ciblée', async () => {
    stubFetch((_url, method) =>
      method === 'POST'
        ? { status: 500, body: { error: 'boom' } }
        : { status: 200, body: { real_expenses: [expense(EXPENSE_ID, 150)] } },
    )
    const qc = setup('profile')

    const outcome = await toggle(true)

    expect(outcome).toBe('error')
    await waitFor(() => expect(screen.getByTestId('applied')).toHaveTextContent('null'))
    expect(qc.getQueryData(['bank-balance', 'profile'])).toEqual({ balance: 1000 })
    expect(qc.getQueryState(['bank-balance', 'profile'])?.isInvalidated).toBe(true)
    expect(qc.getQueryState(['financial-summary', 'profile'])?.isInvalidated).toBe(true)
  })
})

describe('useRealExpenses.toggleCarryApplied — rafraîchissement ciblé', () => {
  it('valider un report : 1 appel, flags de la ligne + solde, rien d’invalidé', async () => {
    stubFetch(() => ({
      status: 200,
      body: { data: { balance: 850, appliedToBalanceAt: SERVER_AT, isCarriedOver: false } },
    }))
    const qc = setup('group', [
      expense(EXPENSE_ID, 150, { is_carried_over: true, carried_from_recap_id: 'recap-1' }),
    ])

    const outcome = await act(async () => hookRef.current!.toggleCarryApplied(EXPENSE_ID, true))

    expect(outcome).toBe('applied')
    expect(CALLS).toEqual([
      { url: '/api/finance/expenses/real/toggle-carry-applied', method: 'POST' },
    ])
    await waitFor(() => expect(screen.getByTestId('carried')).toHaveTextContent('false'))
    expect(screen.getByTestId('applied')).toHaveTextContent(SERVER_AT)
    expect(qc.getQueryData(['bank-balance', 'group'])).toEqual({ balance: 850 })
    expect(qc.getQueryState(['real-expenses', 'group'])?.isInvalidated).toBe(false)
    expect(qc.getQueryState(['financial-summary', 'group'])?.isInvalidated).toBe(false)
  })
})
