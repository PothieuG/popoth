/**
 * Sprint Recap-V2-Dev-Tools (2026-05-22) — declarative scenarios for the
 * V2 recap testing surface. Each scenario describes a target financial
 * state that the dev applies via /api/debug/recap-v2/seed before testing
 * the recap flow at /monthly-recap.
 *
 * Edge-safe : zero service-role import. The apply logic lives in
 * lib/dev/apply-scenario.ts (server-only).
 */

export type ScenarioKey =
  | 'fresh'
  | 'happy-surplus'
  | 'deficit-light'
  | 'deficit-cascade'
  | 'with-group'
  | 'edge-empty-piggy'

export interface ScenarioBudget {
  name: string
  estimated_amount: number
  cumulated_savings?: number
}

export interface ScenarioExpense {
  budget_name: string
  amount: number
  description?: string
}

export interface ScenarioIncome {
  name: string
  estimated_amount: number
}

export interface ScenarioRealIncome {
  amount: number
  description?: string
  is_exceptional?: boolean
}

export interface ScenarioGroupSetup {
  create: boolean
  budgets?: ScenarioBudget[]
  expenses?: ScenarioExpense[]
  incomes?: ScenarioIncome[]
  realIncomes?: ScenarioRealIncome[]
}

export interface ScenarioSetup {
  budgets: ScenarioBudget[]
  expenses: ScenarioExpense[]
  incomes?: ScenarioIncome[]
  realIncomes?: ScenarioRealIncome[]
  piggy_bank_amount?: number
  bank_balance?: number
  bank_current_remaining_to_live?: number
  group?: ScenarioGroupSetup
}

export interface Scenario {
  key: ScenarioKey
  label: string
  description: string
  setup: ScenarioSetup
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'fresh',
    label: 'Fresh — user vide',
    description:
      'Aucun budget, aucune dépense, piggy=0, bank=0. Pour tester la redirection /monthly-recap depuis le placeholder.',
    setup: {
      budgets: [],
      expenses: [],
      piggy_bank_amount: 0,
      bank_balance: 0,
    },
  },
  {
    key: 'happy-surplus',
    label: 'Happy surplus — léger surplus',
    description:
      '3 budgets cool (Courses 400€, Transport 200€, Loisirs 150€). Dépenses 250+150+100. Piggy 50€. Surplus total ~250€.',
    setup: {
      budgets: [
        { name: 'Courses', estimated_amount: 400 },
        { name: 'Transport', estimated_amount: 200 },
        { name: 'Loisirs', estimated_amount: 150 },
      ],
      expenses: [
        { budget_name: 'Courses', amount: 250, description: 'Supermarché' },
        { budget_name: 'Transport', amount: 150, description: 'Carburant' },
        { budget_name: 'Loisirs', amount: 100, description: 'Cinéma + restaurant' },
      ],
      incomes: [{ name: 'Salaire', estimated_amount: 2500 }],
      realIncomes: [{ amount: 2500, description: 'Salaire mensuel' }],
      piggy_bank_amount: 50,
      bank_balance: 1800,
    },
  },
  {
    key: 'deficit-light',
    label: 'Déficit léger — 1 budget dépasse',
    description:
      '3 budgets, 1 en déficit (Scolarité 600€ → 750€ dépensés = -150€). Piggy 200€ permet compensation.',
    setup: {
      budgets: [
        { name: 'Courses', estimated_amount: 400 },
        { name: 'Scolarité', estimated_amount: 600 },
        { name: 'Transport', estimated_amount: 200 },
      ],
      expenses: [
        { budget_name: 'Courses', amount: 350, description: 'Courses' },
        { budget_name: 'Scolarité', amount: 750, description: 'Frais scolarité' },
        { budget_name: 'Transport', amount: 180, description: 'Carburant' },
      ],
      incomes: [{ name: 'Salaire', estimated_amount: 2500 }],
      realIncomes: [{ amount: 2500, description: 'Salaire mensuel' }],
      piggy_bank_amount: 200,
      bank_balance: 1000,
    },
  },
  {
    key: 'deficit-cascade',
    label: 'Déficit cascade — multiples déficits',
    description:
      '4 budgets, 3 en déficit (Courses 250→400, Scolarité 600→900, Loisirs 150→250). Cascade savings→piggy→budgets autres requise.',
    setup: {
      budgets: [
        { name: 'Courses', estimated_amount: 250, cumulated_savings: 100 },
        { name: 'Scolarité', estimated_amount: 600, cumulated_savings: 0 },
        { name: 'Loisirs', estimated_amount: 150, cumulated_savings: 50 },
        { name: 'Transport', estimated_amount: 300, cumulated_savings: 80 },
      ],
      expenses: [
        { budget_name: 'Courses', amount: 400, description: 'Dépassement courses' },
        { budget_name: 'Scolarité', amount: 900, description: 'Frais imprévus' },
        { budget_name: 'Loisirs', amount: 250, description: 'Vacances' },
        { budget_name: 'Transport', amount: 150, description: 'Carburant économe' },
      ],
      incomes: [{ name: 'Salaire', estimated_amount: 2200 }],
      realIncomes: [{ amount: 2200, description: 'Salaire' }],
      piggy_bank_amount: 150,
      bank_balance: 500,
    },
  },
  {
    key: 'with-group',
    label: 'Contexte groupe',
    description:
      'User dans un groupe (solo creator). 2 budgets perso + 2 budgets group. Permet tester le code path group.',
    setup: {
      budgets: [
        { name: 'Courses perso', estimated_amount: 300 },
        { name: 'Transport perso', estimated_amount: 150 },
      ],
      expenses: [
        { budget_name: 'Courses perso', amount: 200, description: 'Courses' },
        { budget_name: 'Transport perso', amount: 120, description: 'Carburant' },
      ],
      incomes: [{ name: 'Salaire', estimated_amount: 2500 }],
      realIncomes: [{ amount: 2500, description: 'Salaire perso' }],
      piggy_bank_amount: 100,
      bank_balance: 1500,
      group: {
        create: true,
        budgets: [
          { name: 'Loyer commun', estimated_amount: 800 },
          { name: 'Courses commun', estimated_amount: 400 },
        ],
        expenses: [
          { budget_name: 'Loyer commun', amount: 800, description: 'Loyer' },
          { budget_name: 'Courses commun', amount: 350, description: 'Courses partagées' },
        ],
      },
    },
  },
  {
    key: 'edge-empty-piggy',
    label: 'Edge — piggy vide + surplus',
    description:
      'Tous budgets en surplus (Courses 400→200, Transport 200→100). Piggy=0, bank=0. Tester accumulation initiale piggy.',
    setup: {
      budgets: [
        { name: 'Courses', estimated_amount: 400 },
        { name: 'Transport', estimated_amount: 200 },
        { name: 'Loisirs', estimated_amount: 150 },
      ],
      expenses: [
        { budget_name: 'Courses', amount: 200, description: 'Courses' },
        { budget_name: 'Transport', amount: 100, description: 'Carburant' },
        { budget_name: 'Loisirs', amount: 50, description: 'Sortie' },
      ],
      incomes: [{ name: 'Salaire', estimated_amount: 2000 }],
      realIncomes: [{ amount: 2000, description: 'Salaire' }],
      piggy_bank_amount: 0,
      bank_balance: 0,
    },
  },
]

export function getScenario(key: ScenarioKey): Scenario | undefined {
  return SCENARIOS.find((s) => s.key === key)
}

export function listScenarios(): Array<Pick<Scenario, 'key' | 'label' | 'description'>> {
  return SCENARIOS.map(({ key, label, description }) => ({ key, label, description }))
}
