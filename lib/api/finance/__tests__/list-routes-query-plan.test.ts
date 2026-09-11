/**
 * Sprint Perf-Waterfall (2026-09-10) — garde-fous sur le PLAN DE REQUÊTES des
 * 3 routes de liste qu'un dashboard appelle à chaque chargement.
 *
 * Contexte : la page groupe restait lente après le sprint précédent parce que
 * le coût ne venait pas d'une route mais de la FORME de l'ensemble — 13 appels,
 * chacun enchaînant plusieurs allers-retours en série vers une base située sur
 * un autre continent. Ces tests pinnent la partie « allers-retours » : ils
 * comptent les requêtes, pas les millisecondes.
 *
 * Ce qu'ils protègent :
 *
 *   1. `GET /finance/expenses/real` et `/finance/income/real` ne relancent plus
 *      un `count: 'exact'` (COUNT complet côté Postgres) ni la relecture de
 *      `profiles` qui l'accompagnait — deux allers-retours EN SÉRIE pour un
 *      `total` que le client n'a jamais lu.
 *
 *   2. `GET /finance/budgets/estimated` agrège le dépensé du mois en UNE
 *      requête `.in(...)` au lieu d'une par budget. Le test le vérifie à 1 puis
 *      à 5 budgets : le compte doit être identique.
 */

import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const STATE: { value: Record<string, Row[]> } = { value: {} }
const PROBE = { fromCalls: [] as string[], exactCounts: 0, selects: [] as string[] }

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndGroup: (handler: AnyHandler) => async (request: NextRequest, rc?: unknown) =>
      handler(request, { userId: 'user-1', groupId: 'group-1' }, rc),
    withAuth: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, { userId: 'user-1' }),
    withAuthAndProfile: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, {
        userId: 'user-1',
        profile: { id: 'user-1', group_id: 'group-1', first_name: 'T', last_name: 'U' },
      }),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

vi.mock('@/lib/supabase-server', () => {
  function makeBuilder(table: string) {
    const filters: { key: string; values: unknown[] }[] = []
    const builder: Record<string, unknown> = {}

    const rows = () =>
      (STATE.value[table] ?? []).filter((row) =>
        filters.every((f) => f.values.includes(row[f.key])),
      )

    builder.select = (cols?: string, opts?: { count?: string }) => {
      if (opts?.count === 'exact') PROBE.exactCounts += 1
      if (cols) PROBE.selects.push(cols)
      return builder
    }
    builder.eq = (key: string, value: unknown) => {
      filters.push({ key, values: [value] })
      return builder
    }
    builder.in = (key: string, values: unknown[]) => {
      filters.push({ key, values })
      return builder
    }
    builder.is = () => builder
    builder.gte = () => builder
    builder.lte = () => builder
    builder.order = () => builder
    builder.range = () => builder
    builder.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
    builder.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
    // `then` reste une fonction simple, jamais un `vi.fn()` (CLAUDE.md §9).
    builder.then = (cb: (v: { data: Row[]; error: unknown; count: number }) => void) => {
      const r = rows()
      Promise.resolve({ data: r, error: null, count: r.length }).then(cb)
    }
    return builder
  }

  return {
    supabaseServer: {
      from: (table: string) => {
        PROBE.fromCalls.push(table)
        return makeBuilder(table)
      },
    },
  }
})

function req(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest
}

function budget(id: string) {
  return {
    id,
    group_id: 'group-1',
    name: `Budget ${id}`,
    estimated_amount: 100,
    carryover_spent_amount: 0,
  }
}

function expense(budgetId: string, amountFromBudget: number) {
  return {
    estimated_budget_id: budgetId,
    group_id: 'group-1',
    amount: amountFromBudget,
    amount_from_budget: amountFromBudget,
    amount_from_piggy_bank: 0,
    amount_from_budget_savings: 0,
    expense_date: '2026-09-10',
    carried_from_recap_id: null,
  }
}

beforeEach(() => {
  STATE.value = { profiles: [{ id: 'user-1', group_id: 'group-1' }] }
  PROBE.fromCalls = []
  PROBE.exactCounts = 0
  PROBE.selects = []
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('routes de liste — plan de requêtes', () => {
  it('expenses/real ne compte plus les lignes et ne relit plus le profil deux fois', async () => {
    STATE.value.real_expenses = [expense('b1', 40)]
    const { GET } = await import('../expenses-real')

    const res = await GET(req('http://x/api/finance/expenses/real?group=true'))
    const body = (await (res as Response).json()) as Record<string, unknown>

    expect(PROBE.exactCounts).toBe(0)
    // UNE seule requête, même en contexte groupe. Avant ce sprint : 4, en série
    // — lecture `profiles`, requête principale, relecture identique de
    // `profiles`, puis le COUNT. Le `group_id` vient désormais du jeton de
    // session (`withAuthAndGroup`), donc plus aucune lecture `profiles` ici.
    expect(PROBE.fromCalls).toEqual(['real_expenses'])
    expect(body.real_expenses).toHaveLength(1)
    // `total` a disparu de la réponse — personne ne le lisait.
    expect(body).not.toHaveProperty('total')
  })

  it('income/real applique le même plan', async () => {
    STATE.value.real_income_entries = [{ group_id: 'group-1', amount: 10 }]
    const { GET } = await import('../income-real')

    const res = await GET(req('http://x/api/finance/income/real?group=true'))
    const body = (await (res as Response).json()) as Record<string, unknown>

    expect(PROBE.exactCounts).toBe(0)
    expect(PROBE.fromCalls).toEqual(['real_income_entries'])
    expect(body).not.toHaveProperty('total')
  })

  it('budgets/estimated : le coût ne dépend plus du nombre de budgets', async () => {
    STATE.value.estimated_budgets = [budget('b1')]
    STATE.value.real_expenses = [expense('b1', 40)]
    const { GET } = await import('../budgets-estimated')

    await GET(req('http://x/api/finance/budgets/estimated?group=true'))
    const withOneBudget = PROBE.fromCalls.filter((t) => t === 'real_expenses').length

    PROBE.fromCalls = []
    STATE.value.estimated_budgets = ['b1', 'b2', 'b3', 'b4', 'b5'].map(budget)
    STATE.value.real_expenses = [expense('b1', 40), expense('b3', 25)]
    await GET(req('http://x/api/finance/budgets/estimated?group=true'))
    const withFiveBudgets = PROBE.fromCalls.filter((t) => t === 'real_expenses').length

    // Avant : 1 requête par budget (1 puis 5). Désormais 1, toujours.
    expect(withOneBudget).toBe(1)
    expect(withFiveBudgets).toBe(1)
  })

  it('budgets/estimated : le dépensé est ventilé sur le bon budget', async () => {
    STATE.value.estimated_budgets = [budget('b1'), budget('b2')]
    // 2 dépenses sur b1, aucune sur b2 — le regroupement en mémoire doit
    // reproduire ce que faisaient les N requêtes filtrées.
    STATE.value.real_expenses = [expense('b1', 40), expense('b1', 15), expense('b2', 0)]
    STATE.value.real_expenses[2] = { ...expense('b2', 7) }
    const { GET } = await import('../budgets-estimated')

    const res = await GET(req('http://x/api/finance/budgets/estimated?group=true'))
    const body = (await (res as Response).json()) as {
      estimated_budgets: { id: string; spent_this_month: number }[]
    }

    const byId = new Map(body.estimated_budgets.map((b) => [b.id, b.spent_this_month]))
    expect(byId.get('b1')).toBe(55)
    expect(byId.get('b2')).toBe(7)
  })

  it('budgets/estimated : le report du mois précédent reste additionné', async () => {
    STATE.value.estimated_budgets = [{ ...budget('b1'), carryover_spent_amount: 30 }]
    STATE.value.real_expenses = [expense('b1', 40)]
    const { GET } = await import('../budgets-estimated')

    const res = await GET(req('http://x/api/finance/budgets/estimated?group=true'))
    const body = (await (res as Response).json()) as {
      estimated_budgets: { spent_this_month: number }[]
    }

    expect(body.estimated_budgets[0]?.spent_this_month).toBe(70)
  })
})

// Sprint Fix-Avatar-Payload (2026-09-11). HAR prod : `GET /finance/expenses/real
// ?group=true` répondait 500 après 14,7 s parce que la jointure `created_by`
// embarquait `profiles.avatar_url` — une photo brute de 3,7 Mo en base64 —
// dans CHAQUE ligne. L'avatar du créateur est désormais résolu côté client
// depuis la liste des membres (1 requête, en cache).
describe('routes de liste — la jointure created_by ne porte plus la photo', () => {
  it('expenses/real : created_by = id, prénom, nom — jamais avatar_url', async () => {
    STATE.value.real_expenses = [expense('b1', 40)]
    const { GET } = await import('../expenses-real')

    await GET(req('http://x/api/finance/expenses/real?group=true'))

    const joined = PROBE.selects.find((c) => c.includes('created_by:profiles'))
    expect(joined).toBeDefined()
    expect(joined).toContain('(id, first_name, last_name)')
    expect(joined).not.toContain('avatar_url')
  })

  it('income/real : même contrat', async () => {
    STATE.value.real_income_entries = [{ group_id: 'group-1', amount: 10 }]
    const { GET } = await import('../income-real')

    await GET(req('http://x/api/finance/income/real?group=true'))

    const joined = PROBE.selects.find((c) => c.includes('created_by:profiles'))
    expect(joined).toBeDefined()
    expect(joined).not.toContain('avatar_url')
  })
})
