/**
 * Régression 2026-10-01 — étape 2 du récap (« Compléter le mois »). Le menu
 * « Budget associé » affichait le dépensé du mois CALENDAIRE courant : en
 * faisant le récap de septembre en octobre, un budget entamé en septembre
 * apparaissait à 0,00 €/66,43 €. `GET /finance/budgets/estimated` accepte
 * désormais `month`/`year` pour calculer `spent_this_month` sur le mois recapé.
 *
 * Le mock applique réellement les bornes `gte`/`lte` sur `expense_date` : on
 * vérifie le montant renvoyé, pas seulement les arguments passés.
 */

import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const STATE: { value: Record<string, Row[]> } = { value: {} }

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndGroup: (handler: AnyHandler) => async (request: NextRequest, rc?: unknown) =>
      handler(request, { userId: 'user-1', groupId: 'group-1' }, rc),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

vi.mock('@/lib/supabase-server', () => {
  function makeBuilder(table: string) {
    const filters: ((row: Row) => boolean)[] = []
    const builder: Record<string, unknown> = {}

    builder.select = () => builder
    builder.eq = (key: string, value: unknown) => {
      filters.push((row) => row[key] === value)
      return builder
    }
    builder.in = (key: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[key]))
      return builder
    }
    builder.is = (key: string, value: unknown) => {
      filters.push((row) => (row[key] ?? null) === value)
      return builder
    }
    builder.gte = (key: string, value: string) => {
      filters.push((row) => String(row[key]) >= value)
      return builder
    }
    builder.lte = (key: string, value: string) => {
      filters.push((row) => String(row[key]) <= value)
      return builder
    }
    builder.order = () => builder
    // `then` reste une fonction simple, jamais un `vi.fn()` (CLAUDE.md §9).
    builder.then = (cb: (v: { data: Row[]; error: unknown }) => void) => {
      const rows = (STATE.value[table] ?? []).filter((row) => filters.every((f) => f(row)))
      Promise.resolve({ data: rows, error: null }).then(cb)
    }
    return builder
  }

  return { supabaseServer: { from: (table: string) => makeBuilder(table) } }
})

function req(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest
}

function expense(amountFromBudget: number, expenseDate: string): Row {
  return {
    estimated_budget_id: 'b1',
    profile_id: 'user-1',
    amount: amountFromBudget,
    amount_from_budget: amountFromBudget,
    amount_from_piggy_bank: 0,
    amount_from_budget_savings: 0,
    expense_date: expenseDate,
    carried_from_recap_id: null,
  }
}

async function spentThisMonth(url: string): Promise<number | undefined> {
  const { GET } = await import('../budgets-estimated')
  const res = await GET(req(url))
  const body = (await (res as Response).json()) as {
    estimated_budgets: { spent_this_month: number }[]
  }
  return body.estimated_budgets[0]?.spent_this_month
}

beforeEach(() => {
  // « Aujourd'hui » = 15 octobre : le récap de septembre est en cours.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0))
  STATE.value = {
    estimated_budgets: [
      {
        id: 'b1',
        profile_id: 'user-1',
        name: 'Roi Lion',
        estimated_amount: 66.43,
        carryover_spent_amount: 5,
      },
    ],
    real_expenses: [
      expense(20, '2026-09-01'),
      expense(10, '2026-09-30'),
      expense(7, '2026-10-02'),
      // Hors des deux fenêtres : ne doit jamais compter.
      expense(100, '2026-08-31'),
    ],
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('GET /finance/budgets/estimated — fenêtre du dépensé', () => {
  it('month/year fournis : dépensé du mois recapé (bornes incluses) + report', async () => {
    // 20 + 10 (1er et 30 septembre) + 5 de report.
    expect(
      await spentThisMonth('http://x/api/finance/budgets/estimated?group=false&month=9&year=2026'),
    ).toBe(35)
  })

  it('sans month/year : mois courant, comportement des dashboards inchangé', async () => {
    // 7 (2 octobre) + 5 de report.
    expect(await spentThisMonth('http://x/api/finance/budgets/estimated?group=false')).toBe(12)
  })

  it('un seul des deux paramètres retombe sur le mois courant', async () => {
    expect(await spentThisMonth('http://x/api/finance/budgets/estimated?group=false&month=9')).toBe(
      12,
    )
  })

  it('dernier jour du mois correct en février bissextile', async () => {
    STATE.value.real_expenses = [expense(4, '2028-02-29'), expense(50, '2028-03-01')]
    // 4 (29 février) + 5 de report ; le 1er mars est exclu.
    expect(
      await spentThisMonth('http://x/api/finance/budgets/estimated?group=false&month=2&year=2028'),
    ).toBe(9)
  })
})
