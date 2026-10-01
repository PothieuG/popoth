/**
 * Régression 2026-10-01 — étape 2 du récap (« Compléter le mois »). Le reste à
 * vivre affiché ne correspondait pas à celui du dashboard juste avant le récap.
 *
 * Cause : le terme `budgetDeficits` du RAV est agrégé sur le mois CALENDAIRE
 * courant par défaut. Le récap de septembre se fait en octobre : les
 * dépassements de budget de septembre sortaient du calcul et le RAV remontait
 * d'autant. Ce fichier rejoue ce scénario sur le vrai `_loadFinancialData`
 * (DB mockée) : dashboard du 30 septembre, puis étape 2 le 1er octobre sans et
 * avec la fenêtre du mois recapé.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PROFILE_ID = 'aaaa1111-1111-4111-8111-111111111111'
const ROI_LION = 'b1111111-1111-4111-8111-111111111111'
const COURSES = 'b2222222-2222-4222-8222-222222222222'

type Row = Record<string, unknown>
const STATE: { value: Record<string, Row[]> } = { value: {} }

vi.mock('@/lib/supabase-server', () => {
  function makeBuilder(table: string) {
    const filters: ((row: Row) => boolean)[] = []
    const builder: Record<string, unknown> = {}
    const rows = () => (STATE.value[table] ?? []).filter((row) => filters.every((f) => f(row)))

    builder.select = () => builder
    builder.update = () => builder
    builder.eq = (key: string, value: unknown) => {
      filters.push((row) => row[key] === value)
      return builder
    }
    builder.is = (key: string, value: unknown) => {
      filters.push((row) => (row[key] ?? null) === value)
      return builder
    }
    builder.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
    builder.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
    // `then` reste une fonction simple, jamais un `vi.fn()` (CLAUDE.md §9).
    builder.then = (cb: (v: { data: Row[]; error: unknown }) => void) => {
      Promise.resolve({ data: rows(), error: null }).then(cb)
    }
    return builder
  }
  return { supabaseServer: { from: (table: string) => makeBuilder(table) } }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

function budget(id: string, name: string, estimated: number): Row {
  return {
    id,
    profile_id: PROFILE_ID,
    name,
    estimated_amount: estimated,
    monthly_surplus: null,
    carryover_spent_amount: 0,
    carryover_applied_date: null,
    cumulated_savings: 0,
  }
}

function septemberExpense(budgetId: string, amount: number): Row {
  return {
    profile_id: PROFILE_ID,
    amount,
    estimated_budget_id: budgetId,
    is_exceptional: false,
    amount_from_piggy_bank: 0,
    amount_from_budget_savings: 0,
    amount_from_budget: amount,
    expense_date: '2026-09-20',
    carried_from_recap_id: null,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // Salaire 2 000 · budgets 66,43 + 300 · septembre : 100 sur « Roi Lion »
  // (dépassement de 33,57) et 200 sur « Courses » (sous le plafond).
  STATE.value = {
    bank_balances: [{ profile_id: PROFILE_ID, balance: 1200 }],
    profiles: [{ id: PROFILE_ID, salary: 2000 }],
    estimated_incomes: [],
    estimated_budgets: [
      budget(ROI_LION, 'Temp -> Nov) Roi Lion', 66.43),
      budget(COURSES, 'Courses', 300),
    ],
    savings_projects: [],
    real_income_entries: [],
    real_expenses: [septemberExpense(ROI_LION, 100), septemberExpense(COURSES, 200)],
    piggy_bank: [],
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('RAV pendant le récap — fenêtre du mois recapé', () => {
  it("l'étape 2 affiche le même RAV que le dashboard de fin de mois", async () => {
    const { getProfileFinancialData } = await import('../financial-data')

    // Dashboard, 30 septembre au soir : 2 000 − 366,43 − 33,57 de dépassement.
    vi.setSystemTime(new Date(2026, 8, 30, 21, 0, 0))
    const dashboard = (await getProfileFinancialData(PROFILE_ID)).remainingToLive
    expect(dashboard).toBeCloseTo(1600, 2)

    // Étape 2 le 1er octobre, ancien appel (mois courant) : le dépassement de
    // septembre disparaît, le RAV remonte de 33,57.
    vi.setSystemTime(new Date(2026, 9, 1, 9, 0, 0))
    const sansFenetre = (await getProfileFinancialData(PROFILE_ID)).remainingToLive
    expect(sansFenetre).toBeCloseTo(1633.57, 2)

    // Étape 2 avec la fenêtre du mois recapé : identique au dashboard.
    const avecFenetre = (await getProfileFinancialData(PROFILE_ID, { month: 9, year: 2026 }))
      .remainingToLive
    expect(avecFenetre).toBeCloseTo(dashboard, 2)
  })
})
