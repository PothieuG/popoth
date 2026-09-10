/**
 * Sprint Perf-Group-Members-Rav-Lazy (2026-09-10) — `loadGroupMembersRav`.
 *
 * Ce que ces tests protègent :
 *
 *   1. **La formule n'a pas bougé.** Le RAV servi par cette route doit être
 *      celui de `getProfileFinancialData(membre)`, au centime. La formule
 *      simplifiée `salaire − budgets_perso − contribution` avait été retirée
 *      au sprint Group-RAV-Recap (2026-05-27) pour cause de dérive de
 *      plusieurs € ; déplacer le calcul ne doit pas la faire revenir.
 *
 *   2. **Le tri reste stable par prénom**, cohérent avec `meta.readOnlyIncomes`
 *      (l'UI aligne les deux listes).
 *
 *   3. **Le coût par membre vit bien ici**, et plus dans `_loadFinancialData`
 *      (pinné en miroir par `financial-data-query-plan.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const STATE: { value: Record<string, Row[]> } = { value: {} }
const PROBE = { fromCalls: new Map<string, number>() }

function makeBuilder(table: string) {
  const filters: { type: string; key: string; value?: unknown }[] = []
  const builder: Record<string, unknown> = {}

  const rows = () =>
    (STATE.value[table] ?? []).filter((row) => {
      for (const f of filters) {
        const cell = row[f.key]
        if (f.type === 'eq' && cell !== f.value) return false
        if (f.type === 'is' && f.value === null && cell !== null && cell !== undefined) return false
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
  builder.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
  builder.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
  // `then` doit rester une fonction simple, jamais un `vi.fn()` (CLAUDE.md §9).
  builder.then = (cb: (v: { data: Row[]; error: unknown }) => void) => {
    Promise.resolve({ data: rows(), error: null }).then(cb)
  }
  return builder
}

vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: {
    from: (table: string) => {
      PROBE.fromCalls.set(table, (PROBE.fromCalls.get(table) ?? 0) + 1)
      return makeBuilder(table)
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

const GROUP_ID = 'bbbb2222-2222-2222-2222-222222222222'
const ZOE = 'cccc3333-3333-3333-3333-333333333333'
const ALICE = 'dddd4444-4444-4444-4444-444444444444'

function emptyState() {
  return {
    bank_balances: [] as Row[],
    profiles: [] as Row[],
    estimated_incomes: [] as Row[],
    estimated_budgets: [] as Row[],
    savings_projects: [] as Row[],
    real_income_entries: [] as Row[],
    real_expenses: [] as Row[],
    piggy_bank: [] as Row[],
    group_contributions: [] as Row[],
  }
}

/**
 * 2 membres, volontairement seedés dans l'ordre Zoé puis Alice pour que le
 * tri par prénom soit observable (et pas un accident de l'ordre DB).
 *
 * Zoé  : salaire 2000, budget perso 500 → RAV 1500
 * Alice: salaire 1500, budget perso 200 → RAV 1300
 */
function seedGroup() {
  STATE.value = emptyState()
  STATE.value.bank_balances = [
    { group_id: GROUP_ID, balance: 0, current_remaining_to_live: 0 },
    { profile_id: ZOE, balance: 0, current_remaining_to_live: 0 },
    { profile_id: ALICE, balance: 0, current_remaining_to_live: 0 },
  ]
  STATE.value.profiles = [
    { id: ZOE, salary: 2000 },
    { id: ALICE, salary: 1500 },
  ]
  STATE.value.estimated_budgets = [
    {
      id: 'b1111111-1111-1111-1111-111111111111',
      profile_id: ZOE,
      name: 'Courses',
      estimated_amount: 500,
      monthly_surplus: null,
      carryover_spent_amount: 0,
      carryover_applied_date: null,
      cumulated_savings: 0,
    },
    {
      id: 'b2222222-2222-2222-2222-222222222222',
      profile_id: ALICE,
      name: 'Transport',
      estimated_amount: 200,
      monthly_surplus: null,
      carryover_spent_amount: 0,
      carryover_applied_date: null,
      cumulated_savings: 0,
    },
  ]
  STATE.value.group_contributions = [
    {
      group_id: GROUP_ID,
      profile_id: ZOE,
      contribution_amount: 300,
      salary: 2000,
      profiles: { first_name: 'Zoé', salary: 2000 },
    },
    {
      group_id: GROUP_ID,
      profile_id: ALICE,
      contribution_amount: 200,
      salary: 1500,
      profiles: { first_name: 'Alice', salary: 1500 },
    },
  ]
}

beforeEach(() => {
  STATE.value = emptyState()
  PROBE.fromCalls = new Map()
})

describe('loadGroupMembersRav', () => {
  it('sert le RAV authoritatif de chaque membre, trié par prénom', async () => {
    seedGroup()
    const { loadGroupMembersRav } = await import('../group-members-rav')

    expect(await loadGroupMembersRav(GROUP_ID)).toEqual([
      { profileId: ALICE, firstName: 'Alice', salary: 1500, currentRav: 1300 },
      { profileId: ZOE, firstName: 'Zoé', salary: 2000, currentRav: 1500 },
    ])
  })

  it('renvoie exactement le RAV du dashboard perso du membre', async () => {
    seedGroup()
    const { loadGroupMembersRav } = await import('../group-members-rav')
    const { getProfileFinancialData } = await import('../financial-data')

    const members = await loadGroupMembersRav(GROUP_ID)
    const zoeSolo = await getProfileFinancialData(ZOE)

    expect(members.find((m) => m.profileId === ZOE)?.currentRav).toBe(zoeSolo.remainingToLive)
  })

  it('groupe sans contribution → aucun pipeline membre déclenché', async () => {
    STATE.value = emptyState()
    const { loadGroupMembersRav } = await import('../group-members-rav')

    expect(await loadGroupMembersRav(GROUP_ID)).toEqual([])
    // Une seule lecture (`group_contributions`), et surtout aucun
    // `getProfileFinancialData` derrière.
    expect(PROBE.fromCalls.get('estimated_budgets')).toBeUndefined()
    expect([...PROBE.fromCalls.values()].reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('le coût par membre vit bien ici — un pipeline complet par membre', async () => {
    seedGroup()
    const { loadGroupMembersRav } = await import('../group-members-rav')
    await loadGroupMembersRav(GROUP_ID)

    // C'est le prix que le dashboard groupe ne paie PLUS au chargement : 2
    // membres ⇒ 2 lectures de chaque table perso. Ce test est le pendant de
    // `financial-data-query-plan.test.ts`, qui vérifie que ce coût a bien
    // quitté `_loadFinancialData`.
    expect(PROBE.fromCalls.get('group_contributions')).toBe(1)
    expect(PROBE.fromCalls.get('estimated_budgets')).toBe(2)
    expect(PROBE.fromCalls.get('estimated_incomes')).toBe(2)
  })

  it('tombe sur des valeurs neutres quand le join profils est vide', async () => {
    seedGroup()
    STATE.value.group_contributions = [
      {
        group_id: GROUP_ID,
        profile_id: ZOE,
        contribution_amount: 300,
        salary: 2000,
        profiles: null,
      },
    ]
    const { loadGroupMembersRav } = await import('../group-members-rav')

    // firstName vide (l'UI affiche alors un libellé générique) et salary qui
    // retombe sur le snapshot `group_contributions.salary`.
    expect(await loadGroupMembersRav(GROUP_ID)).toEqual([
      { profileId: ZOE, firstName: '', salary: 2000, currentRav: 1500 },
    ])
  })
})
