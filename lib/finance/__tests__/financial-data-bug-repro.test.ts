/**
 * Sprint Fix-Deficit-Current-Month-Only (2026-05-27) — regression guards for
 * the deficit calc in `_loadFinancialData`.
 *
 * Formule canonique (préservée) : `deficit = MAX(0, spent_current_month +
 * carryover - estimated)`. Symétrique avec l'affichage dashboard
 * `budgets-estimated.ts` GET (`spent_this_month = carryover + actualSpent`).
 *
 * Le fix porte uniquement sur le filtre date du `spentOnBudget` : sans le
 * filtre, des dépenses des mois passés encore non-carry-over (recap M-1 non
 * bouclé) gonflaient le déficit hors-mois courant et créaient un déficit
 * fantôme. Avec le filtre, seules les dépenses du mois calendaire courant
 * alimentent `spentOnBudget` ; les dépenses passées seront prises en compte
 * via `carryover_spent_amount` quand l'utilisateur finalisera leur recap.
 *
 * Part 35 (2026-05-27) : le filtre `is_carried_over=false` a été remplacé par
 * `.is('carried_from_recap_id', null)` pour exclure aussi les carry-overs
 * validées (état B). Les fixtures de ce fichier n'ont pas de
 * `carried_from_recap_id` défini, donc undefined ≡ NULL → toutes les rows
 * passent le filtre comme avant. Les assertions sont préservées.
 *
 * Sémantique métier confirmée user 2026-05-27 : si un budget est visuellement
 * saturé (spent + carryover ≥ estimated), toute nouvelle dépense doit faire
 * baisser le RAV ; si le budget reste sous le cap (somme < estimated), la
 * marge libre absorbe et le RAV ne bouge pas.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// All rows carry `profile_id` so the `.eq('profile_id', userId)` filter
// matches in the chainable mock. The actual columns mocked match what
// `_loadFinancialData` SELECTs from each table.
interface OwnerCols {
  profile_id?: string | null
  group_id?: string | null
  id?: string
}
interface BankBalanceRow extends OwnerCols {
  balance: number | null
  current_remaining_to_live?: number | null
}
interface ProfileRow extends OwnerCols {
  salary: number | null
}
interface EstimatedIncomeRow extends OwnerCols {
  estimated_amount: number
}
interface EstimatedBudgetRow extends OwnerCols {
  name: string
  estimated_amount: number
  monthly_surplus: number | null
  carryover_spent_amount: number | null
  carryover_applied_date: string | null
  cumulated_savings: number | null
}
interface RealIncomeRow extends OwnerCols {
  amount: number
  estimated_income_id: string | null
  is_carried_over: boolean
}
interface RealExpenseRow extends OwnerCols {
  amount: number
  estimated_budget_id: string | null
  is_exceptional: boolean
  is_carried_over: boolean
  expense_date: string
  amount_from_piggy_bank: number | null
  amount_from_budget_savings: number | null
  amount_from_budget: number | null
}
interface PiggyBankRow extends OwnerCols {
  amount: number
}

interface MockState {
  bank_balances: BankBalanceRow[]
  profiles: ProfileRow[]
  estimated_incomes: EstimatedIncomeRow[]
  estimated_budgets: EstimatedBudgetRow[]
  savings_projects: unknown[]
  real_income_entries: RealIncomeRow[]
  real_expenses: RealExpenseRow[]
  piggy_bank: PiggyBankRow[]
  group_contributions: unknown[]
}

const PROFILE_ID = 'aaaa1111-1111-1111-1111-111111111111'

function emptyState(): MockState {
  return {
    bank_balances: [{ profile_id: PROFILE_ID, balance: 0, current_remaining_to_live: 0 }],
    // `profiles` keyed by `id`, not `profile_id` (it IS the profile row).
    profiles: [{ id: PROFILE_ID, salary: 0 }],
    estimated_incomes: [],
    estimated_budgets: [],
    savings_projects: [],
    real_income_entries: [],
    real_expenses: [],
    piggy_bank: [{ profile_id: PROFILE_ID, amount: 0 }],
    group_contributions: [],
  }
}

const STATE: { value: MockState } = { value: emptyState() }

interface FilterCriterion {
  type: 'eq' | 'not' | 'is' | 'gte' | 'lte' | 'match'
  key?: string
  value?: unknown
}

// Chainable mock builder that captures `.eq()` / `.not()` filters and
// applies them when the chain is awaited (via `.then`) or terminated
// with `.single()` / `.maybeSingle()`.
function makeBuilder(table: keyof MockState) {
  const filters: FilterCriterion[] = []
  const builder: Record<string, unknown> = {}

  const resolve = () => {
    const all = STATE.value[table] as unknown[]
    const filtered = all.filter((row) => {
      const r = row as Record<string, unknown>
      for (const f of filters) {
        if (f.type === 'eq') {
          if (r[f.key!] !== f.value) return false
        } else if (f.type === 'not') {
          // .not('col', 'is', null) → col IS NOT NULL
          if (r[f.key!] === null || r[f.key!] === undefined) return false
        } else if (f.type === 'is') {
          // .is('col', null) → col IS NULL
          if (f.value === null) {
            if (r[f.key!] !== null && r[f.key!] !== undefined) return false
          } else if (r[f.key!] !== f.value) {
            return false
          }
        } else if (f.type === 'gte') {
          if ((r[f.key!] as number | string) < (f.value as number | string)) return false
        } else if (f.type === 'lte') {
          if ((r[f.key!] as number | string) > (f.value as number | string)) return false
        } else if (f.type === 'match') {
          const obj = f.value as Record<string, unknown>
          for (const [k, v] of Object.entries(obj)) {
            if (r[k] !== v) return false
          }
        }
      }
      return true
    })
    return filtered
  }

  builder.select = () => builder
  builder.eq = (key: string, value: unknown) => {
    filters.push({ type: 'eq', key, value })
    return builder
  }
  builder.not = (key: string, _op: string, value: unknown) => {
    filters.push({ type: 'not', key, value })
    return builder
  }
  builder.is = (key: string, value: unknown) => {
    filters.push({ type: 'is', key, value })
    return builder
  }
  builder.gte = (key: string, value: unknown) => {
    filters.push({ type: 'gte', key, value })
    return builder
  }
  builder.lte = (key: string, value: unknown) => {
    filters.push({ type: 'lte', key, value })
    return builder
  }
  builder.gt = (key: string, value: unknown) => {
    filters.push({ type: 'gte', key, value })
    return builder
  }
  builder.lt = (key: string, value: unknown) => {
    filters.push({ type: 'lte', key, value })
    return builder
  }
  builder.match = (obj: Record<string, unknown>) => {
    filters.push({ type: 'match', value: obj })
    return builder
  }
  builder.update = () => builder
  builder.single = () => {
    const rows = resolve()
    return Promise.resolve({ data: rows[0] ?? null, error: null })
  }
  builder.maybeSingle = () => {
    const rows = resolve()
    return Promise.resolve({ data: rows[0] ?? null, error: null })
  }
  builder.then = (cb: (v: { data: unknown[]; error: unknown }) => void) =>
    cb({ data: resolve(), error: null })

  return builder
}

vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: {
    from: (table: string) => makeBuilder(table as keyof MockState),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  },
}))

beforeEach(() => {
  STATE.value = emptyState()
})

afterEach(() => {
  vi.clearAllMocks()
})

const COURSES_ID = 'cccc1111-1111-1111-1111-111111111111'
const OTHER_ID = 'dddd2222-2222-2222-2222-222222222222'

describe('financial-data — RAV stability scenarios (bug repro 2026-05-27)', () => {
  it('adding a budgeted expense within the cap does NOT change RAV (fresh setup)', async () => {
    STATE.value.estimated_budgets = [
      {
        id: COURSES_ID,
        profile_id: PROFILE_ID,
        name: 'Courses',
        estimated_amount: 400,
        monthly_surplus: null,
        carryover_spent_amount: 0,
        carryover_applied_date: null,
        cumulated_savings: 0,
      },
      {
        id: OTHER_ID,
        profile_id: PROFILE_ID,
        name: 'Other',
        estimated_amount: 8150,
        monthly_surplus: null,
        carryover_spent_amount: 0,
        carryover_applied_date: null,
        cumulated_savings: 0,
      },
    ]
    STATE.value.real_expenses = []

    const { getProfileFinancialData } = await import('../financial-data')
    const before = await getProfileFinancialData(PROFILE_ID)
    expect(before.remainingToLive).toBe(-8550)

    // Simulate add expense : push into the mocked DB state.
    STATE.value.real_expenses.push({
      profile_id: PROFILE_ID,
      amount: 100,
      estimated_budget_id: COURSES_ID,
      is_exceptional: false,
      is_carried_over: false,
      expense_date: '2026-05-31',
      amount_from_piggy_bank: 0,
      amount_from_budget_savings: 0,
      amount_from_budget: 100,
    })

    const after = await getProfileFinancialData(PROFILE_ID)
    expect(after.remainingToLive).toBe(-8550) // unchanged !
  })

  it('saturated budget (carryover ≥ estimated) : new spending grows the deficit by the full amount', async () => {
    // User scenario 2026-05-27 : group recap with 2 budgets holding huge
    // carryover from a past finalized big-deficit recap. Display shows the
    // budgets as saturated (6100/400 + 3050/200). Adding 100€ to a budget
    // that's already over-cap from carryover SHOULD lower the RAV by the
    // full amount (the user's intuition since the budget is visually red).
    STATE.value.estimated_budgets = [
      {
        id: COURSES_ID,
        profile_id: PROFILE_ID,
        name: 'Courses commune',
        estimated_amount: 400,
        monthly_surplus: null,
        carryover_spent_amount: 6100,
        carryover_applied_date: '2026-05-27',
        cumulated_savings: 0,
      },
      {
        id: OTHER_ID,
        profile_id: PROFILE_ID,
        name: 'Voiture',
        estimated_amount: 200,
        monthly_surplus: null,
        carryover_spent_amount: 3050,
        carryover_applied_date: '2026-05-27',
        cumulated_savings: 0,
      },
    ]
    STATE.value.real_expenses = []

    const { getProfileFinancialData } = await import('../financial-data')

    // Baseline (current month spent = 0) :
    //   Courses : MAX(0, 0 + 6100 - 400) = 5700
    //   Voiture : MAX(0, 0 + 3050 - 200) = 2850
    //   total deficit = 8550
    //   RAV = 0 + 0 - 600 - 0 - 8550 = -9150
    const before = await getProfileFinancialData(PROFILE_ID)
    expect(before.remainingToLive).toBe(-9150)

    // Add 100€ on Courses (current month).
    STATE.value.real_expenses.push({
      profile_id: PROFILE_ID,
      amount: 100,
      estimated_budget_id: COURSES_ID,
      is_exceptional: false,
      is_carried_over: false,
      expense_date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-15`,
      amount_from_piggy_bank: 0,
      amount_from_budget_savings: 0,
      amount_from_budget: 100,
    })

    // Courses : MAX(0, 100 + 6100 - 400) = 5800 → +100 from baseline
    // Voiture : unchanged 2850
    // total deficit = 8650 → RAV = -9250 (delta -100, full new spending hits)
    const after = await getProfileFinancialData(PROFILE_ID)
    expect(after.remainingToLive).toBe(-9250)
  })

  it('small carryover absorbed by current month margin : new under-cap spending does NOT change RAV', async () => {
    // Counter-test : when `spent + carryover < estimated`, the budget remains
    // at equilibrium and new spending under the residual cap doesn't grow
    // the deficit. Pins the "self-healing" semantic.
    STATE.value.estimated_budgets = [
      {
        id: COURSES_ID,
        profile_id: PROFILE_ID,
        name: 'Courses',
        estimated_amount: 400,
        monthly_surplus: null,
        carryover_spent_amount: 100,
        carryover_applied_date: '2026-05-27',
        cumulated_savings: 0,
      },
    ]
    STATE.value.real_expenses = []

    const { getProfileFinancialData } = await import('../financial-data')

    // Baseline : MAX(0, 0 + 100 - 400) = 0. RAV = -400 - 0 = -400.
    const before = await getProfileFinancialData(PROFILE_ID)
    expect(before.remainingToLive).toBe(-400)

    // Add 100€ : MAX(0, 100 + 100 - 400) = 0 (still under cap, margin 200€).
    // RAV unchanged.
    STATE.value.real_expenses.push({
      profile_id: PROFILE_ID,
      amount: 100,
      estimated_budget_id: COURSES_ID,
      is_exceptional: false,
      is_carried_over: false,
      expense_date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-15`,
      amount_from_piggy_bank: 0,
      amount_from_budget_savings: 0,
      amount_from_budget: 100,
    })

    const after = await getProfileFinancialData(PROFILE_ID)
    expect(after.remainingToLive).toBe(-400)
  })

  it('prior-month expense (is_carried_over=false) does NOT inflate the current-month deficit', async () => {
    STATE.value.estimated_budgets = [
      {
        id: COURSES_ID,
        profile_id: PROFILE_ID,
        name: 'Courses',
        estimated_amount: 400,
        monthly_surplus: null,
        carryover_spent_amount: 0,
        carryover_applied_date: null,
        cumulated_savings: 0,
      },
      {
        id: OTHER_ID,
        profile_id: PROFILE_ID,
        name: 'Other',
        estimated_amount: 8150,
        monthly_surplus: null,
        carryover_spent_amount: 0,
        carryover_applied_date: null,
        cumulated_savings: 0,
      },
    ]
    // Prior-month expense (April 15) still is_carried_over=false because the
    // April recap was never finalized. The display API filters by current
    // calendar month (May), so it doesn't show this — but the RAV calc
    // counts it.
    STATE.value.real_expenses = [
      {
        profile_id: PROFILE_ID,
        amount: 400,
        estimated_budget_id: COURSES_ID,
        is_exceptional: false,
        is_carried_over: false,
        expense_date: '2026-04-15',
        amount_from_piggy_bank: 0,
        amount_from_budget_savings: 0,
        amount_from_budget: 400,
      },
    ]

    const { getProfileFinancialData } = await import('../financial-data')
    const before = await getProfileFinancialData(PROFILE_ID)
    // spent_on_Courses = 400, deficit = MAX(0, 400 - 400) = 0 → RAV = -8550
    expect(before.remainingToLive).toBe(-8550)

    // Add new expense in current month (May 31) on Courses.
    STATE.value.real_expenses.push({
      profile_id: PROFILE_ID,
      amount: 100,
      estimated_budget_id: COURSES_ID,
      is_exceptional: false,
      is_carried_over: false,
      expense_date: '2026-05-31',
      amount_from_piggy_bank: 0,
      amount_from_budget_savings: 0,
      amount_from_budget: 100,
    })

    const after = await getProfileFinancialData(PROFILE_ID)
    // After fix (Sprint Fix-Deficit-Current-Month-Only) : the deficit calc
    // only counts current-calendar-month expenses on Courses. The April
    // expense (past month, recap M-1 not yet finalized) is ignored — it'll
    // be picked up when the user runs that month's recap (which converts it
    // to `is_carried_over=true` and stores its deficit in `carryover_spent_amount`).
    // So spent_on_Courses (current month) = 100 < 400 → deficit = 0 → RAV unchanged.
    expect(after.remainingToLive).toBe(-8550)
  })
})
