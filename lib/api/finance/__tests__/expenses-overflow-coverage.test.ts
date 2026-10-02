/**
 * Sprint Expense-Overflow-Coverage (2026-10-02) — aperçu et modification
 * d'une dépense budgétée qui dépasse :
 *   - GET preview-breakdown (ajout) : aucune réserve prise par défaut, et
 *     renvoie le dépassement + les réserves disponibles pour l'étape
 *     « Couvrir le dépassement ».
 *   - PUT expenses/real (modification) : les sources choisies à l'ajout sont
 *     conservées — à la hausse rien de plus n'est pris, à la baisse elles
 *     sont rendues au prorata.
 *
 * Supabase mocké par table : chaque table a ses files de résultats
 * (`single`, `maybeSingle`, `await` direct) consommées dans l'ordre.
 */

import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BUDGET_ID = '11111111-1111-4111-8111-111111111111'
const COURSES_ID = '33333333-3333-4333-8333-333333333333'
const EXPENSE_ID = '55555555-5555-4555-8555-555555555555'

type Result = { data: unknown; error: unknown }
type Queues = Record<string, { single: Result[]; maybeSingle: Result[]; await: Result[] }>

const state = vi.hoisted(() => ({ queues: {} as Queues }))

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndGroup: (handler: AnyHandler) => async (request: NextRequest, rc?: unknown) =>
      handler(request, { userId: 'user-1', groupId: null }, rc),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/supabase-server', () => {
  const empty: Result = { data: null, error: null }
  const take = (table: string, kind: 'single' | 'maybeSingle' | 'await'): Result =>
    state.queues[table]?.[kind].shift() ?? (kind === 'await' ? { data: [], error: null } : empty)

  const from = vi.fn((table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chain is intentionally thenable + chainable
    const chain: any = {}
    for (const method of ['select', 'eq', 'neq', 'gt', 'gte', 'lte', 'is', 'match', 'update']) {
      chain[method] = () => chain
    }
    chain.single = async () => take(table, 'single')
    chain.maybeSingle = async () => take(table, 'maybeSingle')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary onResolve/onReject signatures
    chain.then = (onResolve: any, onReject: any) =>
      Promise.resolve(take(table, 'await')).then(onResolve, onReject)
    return chain
  })
  return { supabaseServer: { from } }
})

vi.mock('@/lib/finance', () => ({
  saveRemainingToLiveSnapshot: vi.fn(async () => true),
  deleteCarriedExpenseToPiggy: vi.fn(),
}))

vi.mock('@/lib/finance/expenses', () => ({
  updateExpenseWithSourcesReapply: vi.fn(async () => undefined),
  deleteExpenseWithSourcesRefund: vi.fn(),
}))

function queue(table: string, kind: 'single' | 'maybeSingle' | 'await', data: unknown) {
  state.queues[table] ??= { single: [], maybeSingle: [], await: [] }
  state.queues[table][kind].push({ data, error: null })
}

beforeEach(() => {
  state.queues = {}
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('GET preview-breakdown (ajout) — dépassement non couvert par défaut', () => {
  it('renvoie le dépassement et les réserves, sans toucher la tirelire', async () => {
    queue('piggy_bank', 'maybeSingle', { amount: 100 })
    queue('estimated_budgets', 'single', {
      id: BUDGET_ID,
      name: 'Loisirs',
      estimated_amount: 200,
      cumulated_savings: 30,
      carryover_spent_amount: 0,
    })
    queue('real_expenses', 'await', [{ id: 'e1', amount: 180, amount_from_budget: 180 }])
    queue('estimated_budgets', 'await', [
      { id: COURSES_ID, name: 'Courses', cumulated_savings: 80 },
      { id: '66666666-6666-4666-8666-666666666666', name: 'Vide', cumulated_savings: 0 },
    ])

    const { GET } = await import('@/lib/api/finance/expenses-preview-breakdown')
    const response = await GET({
      url: `http://localhost/api/finance/expenses/preview-breakdown?amount=150&budget_id=${BUDGET_ID}&context=profile`,
    } as unknown as NextRequest)
    const { breakdown } = await response.json()

    expect(response.status).toBe(200)
    // budget restant 20 + économies 30 → dépassement 100, tout en déficit.
    expect(breakdown).toMatchObject({
      overflow: 100,
      from_piggy_bank: 0,
      from_budget_savings: 30,
      from_budget: 120,
      piggy_bank_before: 100,
      piggy_bank_after: 100,
      cross_budget_debits: [],
      other_budgets_savings: [{ budget_id: COURSES_ID, budget_name: 'Courses', available: 80 }],
    })
  })
})

describe('PUT expenses/real (modification) — sources d’origine conservées', () => {
  function seedEdit(oldAmount: number) {
    queue('real_expenses', 'maybeSingle', {
      is_carried_over: false,
      contribution_id: null,
      is_exceptional: false,
      amount_from_piggy_bank: 20,
    })
    // Dépense d'origine : 120 € sur un budget de 100 € vide, dépassement de
    // 20 € couvert par 10 € de tirelire + 10 € d'économies « Courses ».
    queue('real_expenses', 'single', {
      amount: oldAmount,
      estimated_budget_id: BUDGET_ID,
      amount_from_piggy_bank: 10,
      amount_from_budget_savings: 10,
      amount_from_budget: 100,
      profile_id: 'user-1',
      group_id: null,
      is_exceptional: false,
      description: 'Concert',
      expense_date: '2026-10-02',
    })
    queue('expense_savings_sources', 'await', [
      { source_type: 'piggy', source_budget_id: null, amount: 10 },
      { source_type: 'budget_savings', source_budget_id: COURSES_ID, amount: 10 },
    ])
    queue('estimated_budgets', 'single', {
      estimated_amount: 100,
      cumulated_savings: 0,
      carryover_spent_amount: 0,
    })
    queue('real_expenses', 'await', [{ id: EXPENSE_ID, amount_from_budget: 100 }])
    queue('real_expenses', 'single', { id: EXPENSE_ID, profile_id: 'user-1', group_id: null })
  }

  async function put(amount: number) {
    const { PUT } = await import('@/lib/api/finance/expenses-real')
    return PUT({ json: async () => ({ id: EXPENSE_ID, amount }) } as unknown as NextRequest)
  }

  it('à la hausse : rien de plus n’est pris, le supplément va en déficit', async () => {
    seedEdit(120)
    const response = await put(150)
    expect(response.status).toBe(200)

    const { updateExpenseWithSourcesReapply } = await import('@/lib/finance/expenses')
    expect(updateExpenseWithSourcesReapply).toHaveBeenCalledWith(
      expect.objectContaining({
        newAmount: 150,
        newAmountFromPiggyBank: 10,
        newAmountFromLocalSavings: 0,
        newAmountFromBudget: 130,
        newCrossBudgetDebits: [{ budget_id: COURSES_ID, amount: 10 }],
      }),
    )
  })

  it('à la baisse : les réserves sont rendues au prorata', async () => {
    seedEdit(120)
    const response = await put(110)
    expect(response.status).toBe(200)

    const { updateExpenseWithSourcesReapply } = await import('@/lib/finance/expenses')
    expect(updateExpenseWithSourcesReapply).toHaveBeenCalledWith(
      expect.objectContaining({
        newAmount: 110,
        newAmountFromPiggyBank: 5,
        newAmountFromBudget: 100,
        newCrossBudgetDebits: [{ budget_id: COURSES_ID, amount: 5 }],
      }),
    )
  })

  it('sous le plafond du budget : toutes les réserves sont rendues', async () => {
    seedEdit(120)
    await put(80)

    const { updateExpenseWithSourcesReapply } = await import('@/lib/finance/expenses')
    expect(updateExpenseWithSourcesReapply).toHaveBeenCalledWith(
      expect.objectContaining({
        newAmountFromPiggyBank: 0,
        newAmountFromBudget: 80,
        newCrossBudgetDebits: [],
      }),
    )
  })
})
