/**
 * Sprint Perf-Parallel-Financial-Data (2026-09-01) — garde-fous sur le PLAN DE
 * REQUÊTES de `_loadFinancialData`, pas sur son résultat métier (celui-ci est
 * déjà pinné par `financial-data-bug-repro.test.ts` et par la suite gated
 * `SUPABASE_FINANCE_TESTS=1`).
 *
 * Ce que ces tests protègent, et pourquoi :
 *
 *   1. **Aucune table lue deux fois.** Avant le sprint, `_loadFinancialData`
 *      lisait `estimated_incomes` et `real_income_entries`, puis
 *      `calculateIncomeCompensation` les relisait à l'identique — 2 requêtes
 *      de pur doublon. Le calcul est désormais pur
 *      (`computeIncomeCompensation`) et consomme les lignes déjà chargées.
 *
 *   2. **Les lectures indépendantes partent en parallèle.** Elles étaient
 *      enchaînées en série, empilant autant de latences réseau (~90 ms pièce
 *      quand la fonction Vercel et Supabase ne partagent pas la région). Un
 *      `await` réintroduit par mégarde dans la phase 1 ne coûte rien en local
 *      mais re-sérialise la prod : sans ce test, la régression est invisible.
 *
 *   3. **La math est inchangée.** Les valeurs attendues ici sont EXACTEMENT
 *      celles de `GOLDEN_PROFILE` / `GOLDEN_GROUP` de la suite gated
 *      `financial-data.test.ts` (qui, elle, tape une vraie DB). Ce fichier en
 *      est le miroir non-gated : il tourne dans `pnpm test:run`.
 *
 * Le mock mesure la concurrence en différant chaque résolution d'un tick et en
 * comptant les requêtes simultanément en vol. En série, le maximum en vol est
 * 1 ; en parallèle, il vaut le nombre de lectures de la phase 1.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Fixture ────────────────────────────────────────────────────────────────

const PROFILE_ID = 'aaaa1111-1111-1111-1111-111111111111'
const GROUP_ID = 'bbbb2222-2222-2222-2222-222222222222'
const MEMBER_ID = 'cccc3333-3333-3333-3333-333333333333'
const EST_INCOME_800 = 'e8888888-8888-8888-8888-888888888888'
const EST_INCOME_200 = 'e2222222-2222-2222-2222-222222222222'
const EST_INCOME_1000 = 'e1111111-1111-1111-1111-111111111111'
const BUDGET_200 = 'b2222222-2222-2222-2222-222222222222'
const BUDGET_300 = 'b3333333-3333-3333-3333-333333333333'
const BUDGET_600 = 'b6666666-6666-6666-6666-666666666666'

/** Date dans le mois calendaire courant (le deficit loop filtre dessus). */
function currentMonthDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`
}

type Row = Record<string, unknown>

interface MockState {
  bank_balances: Row[]
  profiles: Row[]
  estimated_incomes: Row[]
  estimated_budgets: Row[]
  savings_projects: Row[]
  real_income_entries: Row[]
  real_expenses: Row[]
  piggy_bank: Row[]
  group_contributions: Row[]
}

function emptyState(): MockState {
  return {
    bank_balances: [],
    profiles: [],
    estimated_incomes: [],
    estimated_budgets: [],
    savings_projects: [],
    real_income_entries: [],
    real_expenses: [],
    piggy_bank: [],
    group_contributions: [],
  }
}

const STATE: { value: MockState } = { value: emptyState() }

// ─── Instrumentation ────────────────────────────────────────────────────────

const PROBE = {
  /** Nombre d'appels `.from(table)`, par table. */
  fromCalls: new Map<string, number>(),
  /** Requêtes actuellement en vol. */
  inFlight: 0,
  /** Pic de requêtes simultanées — c'est la mesure du parallélisme. */
  maxInFlight: 0,
}

function resetProbe() {
  PROBE.fromCalls = new Map()
  PROBE.inFlight = 0
  PROBE.maxInFlight = 0
}

/**
 * Simule une requête réseau : comptabilise l'entrée en vol, puis résout au
 * tick suivant. Deux requêtes lancées dans le même tick se chevauchent donc,
 * ce que `maxInFlight` capture.
 */
function track<T>(produce: () => T): Promise<T> {
  PROBE.inFlight += 1
  PROBE.maxInFlight = Math.max(PROBE.maxInFlight, PROBE.inFlight)
  return new Promise<T>((resolveP) => {
    setTimeout(() => {
      PROBE.inFlight -= 1
      resolveP(produce())
    }, 0)
  })
}

interface FilterCriterion {
  type: 'eq' | 'is' | 'not'
  key: string
  value?: unknown
}

function makeBuilder(table: keyof MockState) {
  const filters: FilterCriterion[] = []
  const builder: Record<string, unknown> = {}

  const rows = () =>
    (STATE.value[table] ?? []).filter((row) => {
      for (const f of filters) {
        const cell = row[f.key]
        if (f.type === 'eq') {
          if (cell !== f.value) return false
        } else if (f.type === 'is') {
          // `.is('col', null)` → col IS NULL (undefined ≡ NULL côté fixture)
          if (f.value === null && cell !== null && cell !== undefined) return false
        } else if (f.type === 'not') {
          // `.not('col', 'is', null)` → col IS NOT NULL
          if (cell === null || cell === undefined) return false
        }
      }
      return true
    })

  builder.select = () => builder
  builder.update = () => builder
  builder.eq = (key: string, value: unknown) => {
    filters.push({ type: 'eq', key, value })
    return builder
  }
  builder.is = (key: string, value: unknown) => {
    filters.push({ type: 'is', key, value })
    return builder
  }
  builder.not = (key: string, _op: string, value: unknown) => {
    filters.push({ type: 'not', key, value })
    return builder
  }
  builder.single = () => track(() => ({ data: rows()[0] ?? null, error: null }))
  builder.maybeSingle = () => track(() => ({ data: rows()[0] ?? null, error: null }))
  // Attention : `then` doit rester une fonction simple (jamais un `vi.fn()`) —
  // cf. CLAUDE.md §9 patterns techniques.
  builder.then = (cb: (v: { data: Row[]; error: unknown }) => void) => {
    track(() => ({ data: rows(), error: null })).then(cb)
  }

  return builder
}

vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: {
    from: (table: string) => {
      PROBE.fromCalls.set(table, (PROBE.fromCalls.get(table) ?? 0) + 1)
      return makeBuilder(table as keyof MockState)
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

// ─── Fixtures métier ────────────────────────────────────────────────────────

/**
 * Réplique exacte de la fixture `GOLDEN_PROFILE` de la suite gated.
 * salaire 1500 · estimés 800+200 · réel 750 sur le 800 · exceptionnel +100
 * budgets 200+300 · dépensé 150 sur le 200 · exceptionnel −80
 * banque 500 · tirelire 50
 */
function seedProfileFixture() {
  STATE.value.bank_balances = [
    { profile_id: PROFILE_ID, balance: 500, current_remaining_to_live: 0 },
  ]
  STATE.value.profiles = [{ id: PROFILE_ID, salary: 1500 }]
  STATE.value.estimated_incomes = [
    { id: EST_INCOME_800, profile_id: PROFILE_ID, estimated_amount: 800 },
    { id: EST_INCOME_200, profile_id: PROFILE_ID, estimated_amount: 200 },
  ]
  STATE.value.estimated_budgets = [
    {
      id: BUDGET_200,
      profile_id: PROFILE_ID,
      name: 'Courses',
      estimated_amount: 200,
      monthly_surplus: null,
      carryover_spent_amount: 0,
      carryover_applied_date: null,
      cumulated_savings: 0,
    },
    {
      id: BUDGET_300,
      profile_id: PROFILE_ID,
      name: 'Loisirs',
      estimated_amount: 300,
      monthly_surplus: null,
      carryover_spent_amount: 0,
      carryover_applied_date: null,
      cumulated_savings: 0,
    },
  ]
  STATE.value.real_income_entries = [
    {
      profile_id: PROFILE_ID,
      amount: 750,
      estimated_income_id: EST_INCOME_800,
      is_exceptional: false,
    },
    { profile_id: PROFILE_ID, amount: 100, estimated_income_id: null, is_exceptional: true },
  ]
  STATE.value.real_expenses = [
    {
      profile_id: PROFILE_ID,
      amount: 150,
      estimated_budget_id: BUDGET_200,
      is_exceptional: false,
      expense_date: currentMonthDate(),
      amount_from_piggy_bank: 0,
      amount_from_budget_savings: 0,
      amount_from_budget: 150,
    },
    {
      profile_id: PROFILE_ID,
      amount: 80,
      estimated_budget_id: null,
      is_exceptional: true,
      expense_date: currentMonthDate(),
      amount_from_piggy_bank: 0,
      amount_from_budget_savings: 0,
      amount_from_budget: null,
    },
  ]
  STATE.value.piggy_bank = [{ profile_id: PROFILE_ID, amount: 50 }]
}

/** Réplique de `GOLDEN_GROUP` : estimé 1000 réalisé 1000, budget 600, dépensé 400. */
function seedGroupFixture() {
  STATE.value.bank_balances = [{ group_id: GROUP_ID, balance: 1200, current_remaining_to_live: 0 }]
  STATE.value.estimated_incomes = [
    { id: EST_INCOME_1000, group_id: GROUP_ID, estimated_amount: 1000 },
  ]
  STATE.value.estimated_budgets = [
    {
      id: BUDGET_600,
      group_id: GROUP_ID,
      name: 'Courses commune',
      estimated_amount: 600,
      monthly_surplus: null,
      carryover_spent_amount: 0,
      carryover_applied_date: null,
      cumulated_savings: 0,
    },
  ]
  STATE.value.real_income_entries = [
    {
      group_id: GROUP_ID,
      amount: 1000,
      estimated_income_id: EST_INCOME_1000,
      is_exceptional: false,
    },
  ]
  STATE.value.real_expenses = [
    {
      group_id: GROUP_ID,
      amount: 400,
      estimated_budget_id: BUDGET_600,
      is_exceptional: false,
      expense_date: currentMonthDate(),
      amount_from_piggy_bank: 0,
      amount_from_budget_savings: 0,
      amount_from_budget: 400,
    },
  ]
  STATE.value.piggy_bank = [{ group_id: GROUP_ID, amount: 100 }]
  STATE.value.group_contributions = [
    {
      group_id: GROUP_ID,
      profile_id: MEMBER_ID,
      contribution_amount: 0,
      salary: 1500,
      profiles: { first_name: 'Alice', salary: 1500 },
    },
  ]
}

beforeEach(() => {
  STATE.value = emptyState()
  resetProbe()
})

afterEach(() => {
  vi.resetAllMocks()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('financial-data — plan de requêtes (perf)', () => {
  it('ne lit aucune table deux fois pour un profil', async () => {
    seedProfileFixture()
    const { getProfileFinancialData } = await import('../financial-data')
    await getProfileFinancialData(PROFILE_ID)

    // `estimated_incomes` et `real_income_entries` étaient chacune lue 2x avant
    // le sprint (une fois par `_loadFinancialData`, une fois par le wrapper
    // `calculateIncomeCompensation`). C'est LE doublon supprimé.
    expect(PROBE.fromCalls.get('estimated_incomes')).toBe(1)
    expect(PROBE.fromCalls.get('real_income_entries')).toBe(1)

    expect(PROBE.fromCalls.get('profiles')).toBe(1)
    expect(PROBE.fromCalls.get('estimated_budgets')).toBe(1)
    expect(PROBE.fromCalls.get('savings_projects')).toBe(1)
    expect(PROBE.fromCalls.get('real_expenses')).toBe(1)
    expect(PROBE.fromCalls.get('piggy_bank')).toBe(1)

    // `bank_balances` est la seule table touchée 2x et c'est légitime : une
    // lecture du solde (§1) puis l'écriture du RAV recalculé (§12,
    // `saveRavToDatabase`).
    expect(PROBE.fromCalls.get('bank_balances')).toBe(2)

    // Contexte profil → aucune lecture des contributions de groupe.
    expect(PROBE.fromCalls.get('group_contributions')).toBeUndefined()

    // Total : 9 allers-retours, contre 11 avant le sprint.
    const total = [...PROBE.fromCalls.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(9)
  })

  it('lance les lectures indépendantes en parallèle et non en série', async () => {
    seedProfileFixture()
    const { getProfileFinancialData } = await import('../financial-data')
    await getProfileFinancialData(PROFILE_ID)

    // Phase 1 = 8 lectures pour un profil (bank_balances, profiles,
    // estimated_incomes, estimated_budgets, savings_projects,
    // real_income_entries, real_expenses, piggy_bank). Toutes doivent être en
    // vol simultanément. En série, ce pic vaudrait 1.
    expect(PROBE.maxInFlight).toBe(8)
  })

  it('parallélise aussi en contexte groupe (contributions incluses)', async () => {
    seedGroupFixture()
    const { getGroupFinancialData } = await import('../financial-data')
    await getGroupFinancialData(GROUP_ID)

    // Groupe : pas de lecture `profiles` pour le salaire (pas de salaire de
    // groupe) mais une lecture `group_contributions` → 8 lectures également.
    expect(PROBE.maxInFlight).toBe(8)
    expect(PROBE.fromCalls.get('group_contributions')).toBe(1)

    // ⚠️ N+1 CONNU, hors périmètre du sprint Perf-Parallel-Financial-Data.
    // Chaque membre ayant une contribution déclenche un
    // `getProfileFinancialData(memberId)` complet (§13), donc un second
    // pipeline entier — d'où une 2e lecture de `estimated_incomes` ici, pour
    // le membre. La fixture n'a qu'un membre : 1 (groupe) + 1 (membre) = 2.
    //
    // Cette assertion PINNE le coût actuel : le jour où le N+1 sera traité
    // (lecture du snapshot `bank_balances.current_remaining_to_live` au lieu
    // d'un recalcul complet), ce test tombera et signalera le gain.
    expect(PROBE.fromCalls.get('estimated_incomes')).toBe(2)
  })
})

describe('financial-data — math préservée par la parallélisation', () => {
  it('profil : reproduit GOLDEN_PROFILE de la suite gated', async () => {
    seedProfileFixture()
    const { getProfileFinancialData } = await import('../financial-data')
    const data = await getProfileFinancialData(PROFILE_ID)

    // compensation = 750 (l'estimé 800 est réalisé à 750) + 200 (l'estimé 200
    // n'a aucun réel, il compte donc pour son estimé) = 950
    // contribution  = 950 + 1500 (salaire) = 2450
    // RAV = 2450 + 100 (exceptionnel) - 500 (budgets) - 80 (exceptionnel) - 0
    expect(data.remainingToLive).toBe(1970)
    expect(data.availableBalance).toBe(500)
    expect(data.totalSavings).toBe(50)
    expect(data.piggyBank).toBe(50)
    expect(data.totalEstimatedIncome).toBe(2500)
    expect(data.totalEstimatedBudgets).toBe(500)
    expect(data.totalRealIncome).toBe(850)
    expect(data.totalRealExpenses).toBe(230)
    expect(data.meta?.readOnlyIncomes).toEqual([{ kind: 'salary', label: 'Salaire', amount: 1500 }])
  })

  it('groupe : reproduit GOLDEN_GROUP de la suite gated', async () => {
    seedGroupFixture()
    const { getGroupFinancialData } = await import('../financial-data')
    const data = await getGroupFinancialData(GROUP_ID)

    // compensation = 1000 (réel == estimé) ; pas de salaire en groupe.
    // RAV = 1000 + 0 (exceptionnels) + 0 (contributions) - 600 - 0 - 0
    expect(data.remainingToLive).toBe(400)
    expect(data.availableBalance).toBe(1200)
    expect(data.totalSavings).toBe(100)
    expect(data.totalEstimatedIncome).toBe(1000)
    expect(data.totalEstimatedBudgets).toBe(600)
    expect(data.totalRealIncome).toBe(1000)
    expect(data.totalRealExpenses).toBe(400)
    expect(data.meta?.groupSalaryTotal).toBe(1500)
    // contribution_amount = 0 → aucune ligne read-only (le filtre est `> 0`).
    expect(data.meta?.readOnlyIncomes).toEqual([])
  })

  it('un revenu estimé sur-réalisé compte pour son réel, pas pour son estimé', async () => {
    // Garde-fou sur la règle métier portée par le calcul devenu pur : dès
    // qu'un réel est rattaché, c'est LUI qui compte, même s'il dépasse.
    seedProfileFixture()
    STATE.value.real_income_entries = [
      {
        profile_id: PROFILE_ID,
        amount: 900,
        estimated_income_id: EST_INCOME_800,
        is_exceptional: false,
      },
    ]
    const { getProfileFinancialData } = await import('../financial-data')
    const data = await getProfileFinancialData(PROFILE_ID)

    // compensation = 900 + 200 = 1100 → contribution 2600
    // RAV = 2600 + 0 (plus d'exceptionnel) - 500 - 80 = 2020
    expect(data.remainingToLive).toBe(2020)
  })

  it('les carry-overs restent exclus du calcul de compensation', async () => {
    // Part 35 : une transaction issue d'un recap antérieur appartient au mois
    // d'origine. Le calcul étant devenu pur, il consomme les lignes filtrées
    // en amont par `.is('carried_from_recap_id', null)` — ce test vérifie que
    // le filtre est bien resté sur la requête de la phase 1.
    seedProfileFixture()
    STATE.value.real_income_entries = [
      {
        profile_id: PROFILE_ID,
        amount: 750,
        estimated_income_id: EST_INCOME_800,
        is_exceptional: false,
      },
      {
        profile_id: PROFILE_ID,
        amount: 5000,
        estimated_income_id: EST_INCOME_800,
        is_exceptional: false,
        carried_from_recap_id: 'dddd4444-4444-4444-4444-444444444444',
      },
    ]
    const { getProfileFinancialData } = await import('../financial-data')
    const data = await getProfileFinancialData(PROFILE_ID)

    // Le carry-over de 5000 doit être ignoré : compensation = 750 + 200 = 950.
    // Idem GOLDEN_PROFILE mais sans le revenu exceptionnel de +100.
    expect(data.remainingToLive).toBe(1870)
    expect(data.totalRealIncome).toBe(750)
  })
})

describe('computeIncomeCompensation — coeur pur', () => {
  it("compte l'estimé quand aucun réel n'est rattaché", async () => {
    const { computeIncomeCompensation } = await import('../income-compensation')
    expect(computeIncomeCompensation([{ id: 'a', estimated_amount: 800 }], [])).toBe(800)
  })

  it("compte le réel dès qu'un réel est rattaché", async () => {
    const { computeIncomeCompensation } = await import('../income-compensation')
    expect(
      computeIncomeCompensation(
        [{ id: 'a', estimated_amount: 800 }],
        [{ amount: 750, estimated_income_id: 'a' }],
      ),
    ).toBe(750)
  })

  it('cumule les réels multiples rattachés au même estimé', async () => {
    const { computeIncomeCompensation } = await import('../income-compensation')
    expect(
      computeIncomeCompensation(
        [{ id: 'a', estimated_amount: 800 }],
        [
          { amount: 400, estimated_income_id: 'a' },
          { amount: 350, estimated_income_id: 'a' },
        ],
      ),
    ).toBe(750)
  })

  it('ignore les réels non rattachés (exceptionnels, salaire auto, miroir contribution)', async () => {
    // C'est l'invariant qui autorise `_loadFinancialData` à passer TEL QUEL le
    // jeu de lignes qu'il a déjà chargé, sans le pré-filtrer.
    const { computeIncomeCompensation } = await import('../income-compensation')
    expect(
      computeIncomeCompensation(
        [{ id: 'a', estimated_amount: 800 }],
        [
          { amount: 750, estimated_income_id: 'a' },
          { amount: 9999, estimated_income_id: null },
        ],
      ),
    ).toBe(750)
  })

  it('retourne 0 sans revenu estimé, quels que soient les réels', async () => {
    const { computeIncomeCompensation } = await import('../income-compensation')
    expect(computeIncomeCompensation([], [{ amount: 500, estimated_income_id: 'x' }])).toBe(0)
    expect(computeIncomeCompensation(null, null)).toBe(0)
  })
})
