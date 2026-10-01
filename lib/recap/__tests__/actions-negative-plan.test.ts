/**
 * Sprint Recap-Manual-Refloat (2026-10-01) — `executePrepareDeficit` et
 * `executeSaveRefloatPlan` (`lib/recap/actions-negative.ts`).
 *
 * Tests unitaires non-gated : `supabase-server` et `loadRecapSummary` sont
 * mockés pour vérifier les décisions de l'orchestrateur (bornes, écriture,
 * appel RPC). Le comportement SQL des RPCs est couvert par la suite gated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MonthlyRecapRow } from '@/lib/recap/active-recap'
import type { RecapSummary } from '@/lib/recap/types'

interface Mocks {
  rpc: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  updateEq: ReturnType<typeof vi.fn>
}

vi.mock('@/lib/supabase-server', () => {
  const rpc = vi.fn()
  const updateEq = vi.fn()
  const update = vi.fn(() => ({ eq: updateEq }))
  const supabaseServer = {
    from(table: string) {
      if (table === 'monthly_recaps') return { update }
      throw new Error(`Unexpected supabaseServer.from(${table})`)
    },
    rpc,
  }
  return { supabaseServer, __mocks: { rpc, update, updateEq } }
})

vi.mock('@/lib/recap/load-summary', () => ({ loadRecapSummary: vi.fn() }))

async function getMocks(): Promise<Mocks> {
  const mod = (await import('@/lib/supabase-server')) as unknown as { __mocks: Mocks }
  return mod.__mocks
}

async function getLoadSummary(): Promise<ReturnType<typeof vi.fn>> {
  const mod = (await import('@/lib/recap/load-summary')) as unknown as {
    loadRecapSummary: ReturnType<typeof vi.fn>
  }
  return mod.loadRecapSummary
}

const RECAP_ID = 'cccc3333-3333-3333-3333-333333333333'
const BUDGET_A = 'aaaa0000-0000-0000-0000-000000000001'
const BUDGET_B = 'aaaa0000-0000-0000-0000-000000000002'
const PROJECT_P = 'bbbb0000-0000-0000-0000-000000000001'

function makeRecap(overrides: Partial<MonthlyRecapRow> = {}): MonthlyRecapRow {
  return {
    id: RECAP_ID,
    profile_id: 'p1',
    group_id: null,
    recap_month: 9,
    recap_year: 2026,
    current_step: 'manage_bilan',
    started_at: null,
    started_by_profile_id: 'p1',
    completed_at: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    refloated_from_piggy: 0,
    refloated_from_savings: 0,
    budget_snapshot_data: {},
    piggy_transfers_data: {},
    project_snapshot_data: {},
    recovery_data: {},
    abandoned_at: null,
    surplus_savings_data: {},
    planned_piggy_refloat: null,
    planned_savings_refloat: null,
    refloat_plan_applied_at: null,
    ...overrides,
  }
}

function makeSummary(overrides: Partial<RecapSummary> = {}): RecapSummary {
  return {
    currentBalance: 1099.45,
    ravEstime: 0,
    ravEffectif: -348.06,
    totalSurplus: 0,
    totalSavings: 30,
    piggyAmount: 100,
    budgets: [
      {
        budgetId: BUDGET_A,
        budgetName: 'A',
        estimatedAmount: 100,
        spentThisMonth: 70,
        cumulatedSavings: 30,
        carryoverSpentAmount: 0,
        surplus: 0,
        deficit: 0,
      },
      {
        budgetId: BUDGET_B,
        budgetName: 'B',
        estimatedAmount: 500,
        spentThisMonth: 500,
        cumulatedSavings: 0,
        carryoverSpentAmount: 0,
        surplus: 0,
        deficit: 0,
      },
    ],
    bilan: -348.06,
    bilanSign: 'negative',
    savingsProjects: [
      {
        id: PROJECT_P,
        name: 'Vacances',
        monthlyAllocation: 50,
        amountSaved: 200,
        targetAmount: 1000,
        deadlineDate: '2027-06-01',
        monthsRemaining: 9,
        pendingDelayFraction: 0,
      },
    ],
    ...overrides,
  }
}

const BASE = { context: 'profile' as const, profileId: 'p1', groupId: null }

beforeEach(async () => {
  const m = await getMocks()
  m.rpc.mockResolvedValue({ data: null, error: null })
  m.update.mockImplementation(() => ({ eq: m.updateEq }))
  m.updateEq.mockResolvedValue({ error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('executePrepareDeficit', () => {
  it('verse chaque surplus > 0 dans les économies via la RPC idempotente', async () => {
    const { executePrepareDeficit } = await import('../actions-negative')
    const m = await getMocks()
    const loadSummary = await getLoadSummary()
    const before = makeSummary({
      budgets: [
        { ...makeSummary().budgets[0]!, surplus: 30, cumulatedSavings: 0 },
        { ...makeSummary().budgets[1]!, surplus: 0 },
      ],
    })
    loadSummary.mockResolvedValueOnce(before).mockResolvedValueOnce(makeSummary())
    m.rpc.mockResolvedValueOnce({
      data: { already_done: false, applied: { [BUDGET_A]: 30 } },
      error: null,
    })

    const outcome = await executePrepareDeficit({
      ...BASE,
      recap: makeRecap({ surplus_savings_data: null }),
    })

    expect(m.rpc).toHaveBeenCalledWith('transfer_recap_surplus_to_savings', {
      p_recap_id: RECAP_ID,
      p_allocations: { [BUDGET_A]: 30 },
    })
    expect(outcome.surplusSavingsData).toEqual({ [BUDGET_A]: 30 })
    expect(outcome.alreadyDone).toBe(false)
    // 2e chargement du résumé : avec le surplus versé, pour qu'il retombe à 0.
    expect(loadSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ surplusSavingsData: { [BUDGET_A]: 30 } }),
    )
  })

  it('ne rappelle pas la RPC quand le versement est déjà fait', async () => {
    const { executePrepareDeficit } = await import('../actions-negative')
    const m = await getMocks()
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary())

    const outcome = await executePrepareDeficit({
      ...BASE,
      recap: makeRecap({ surplus_savings_data: { [BUDGET_A]: 30 } }),
    })

    expect(m.rpc).not.toHaveBeenCalled()
    expect(outcome.alreadyDone).toBe(true)
    expect(outcome.surplusSavingsData).toEqual({ [BUDGET_A]: 30 })
  })

  it('refuse (409 no_deficit) quand le bilan n’est pas négatif', async () => {
    const { executePrepareDeficit, RecapActionError } = await import('../actions-negative')
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary({ bilan: 20, bilanSign: 'positive' }))

    const promise = executePrepareDeficit({
      ...BASE,
      recap: makeRecap({ surplus_savings_data: null }),
    })
    await expect(promise).rejects.toBeInstanceOf(RecapActionError)
    await expect(promise).rejects.toMatchObject({ code: 'no_deficit', status: 409 })
  })

  it('remonte l’erreur de la RPC', async () => {
    const { executePrepareDeficit } = await import('../actions-negative')
    const m = await getMocks()
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary())
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })

    await expect(
      executePrepareDeficit({ ...BASE, recap: makeRecap({ surplus_savings_data: null }) }),
    ).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('executeSaveRefloatPlan', () => {
  it('refuse (409 not_prepared) tant que le surplus n’est pas versé', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    await expect(
      executeSaveRefloatPlan({
        ...BASE,
        recap: makeRecap({ surplus_savings_data: null }),
        input: { source: 'piggy', amount: 10 },
      }),
    ).rejects.toMatchObject({ code: 'not_prepared', status: 409 })
  })

  it('tirelire : enregistre le montant sans rien débiter', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    const m = await getMocks()
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary())

    const outcome = await executeSaveRefloatPlan({
      ...BASE,
      recap: makeRecap(),
      input: { source: 'piggy', amount: 80 },
    })

    expect(m.update).toHaveBeenCalledWith({ planned_piggy_refloat: 80 })
    expect(m.updateEq).toHaveBeenCalledWith('id', RECAP_ID)
    expect(m.rpc).not.toHaveBeenCalled()
    expect(outcome.plan.piggy).toBe(80)
    expect(outcome.deficitRemaining).toBe(268.06)
  })

  it('tirelire : refuse au-delà du solde de la tirelire', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary({ piggyAmount: 50 }))

    await expect(
      executeSaveRefloatPlan({
        ...BASE,
        recap: makeRecap(),
        input: { source: 'piggy', amount: 60 },
      }),
    ).rejects.toMatchObject({ code: 'piggy_insufficient', status: 400 })
  })

  it('refuse de renflouer plus que ce qu’il reste (les autres sources comptées)', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary({ bilan: -100, piggyAmount: 500 }))

    await expect(
      executeSaveRefloatPlan({
        ...BASE,
        // 70 déjà pris sur les budgets → la tirelire ne peut plus donner que 30
        recap: makeRecap({ budget_snapshot_data: { [BUDGET_B]: 70 } }),
        input: { source: 'piggy', amount: 40 },
      }),
    ).rejects.toMatchObject({ code: 'overflow', status: 400, extras: { deficitRemaining: 30 } })
  })

  it('remplace la valeur précédente de la source (pas d’addition)', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary({ bilan: -100 }))

    const outcome = await executeSaveRefloatPlan({
      ...BASE,
      // 90 déjà prévus sur la tirelire : en ré-enregistrer 100 doit passer
      recap: makeRecap({ planned_piggy_refloat: 90 }),
      input: { source: 'piggy', amount: 100 },
    })
    expect(outcome.plan.piggy).toBe(100)
    expect(outcome.deficitRemaining).toBe(0)
  })

  it('budgets : économies d’abord, puis budget du mois suivant', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    const m = await getMocks()
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary())

    const outcome = await executeSaveRefloatPlan({
      ...BASE,
      recap: makeRecap(),
      // A : 30 d'économies + 100 de budget → 50 = 30 + 20 ; B : 0 d'économies → 10 sur le budget
      input: { source: 'budgets', allocations: { [BUDGET_A]: 50, [BUDGET_B]: 10 } },
    })

    expect(m.update).toHaveBeenCalledWith({
      planned_savings_refloat: { [BUDGET_A]: 30 },
      budget_snapshot_data: { [BUDGET_A]: 20, [BUDGET_B]: 10 },
    })
    expect(outcome.plan.savings).toEqual({ [BUDGET_A]: 30 })
    expect(outcome.plan.budgets).toEqual({ [BUDGET_A]: 20, [BUDGET_B]: 10 })
    expect(outcome.deficitRemaining).toBe(288.06)
  })

  it('budgets : refuse au-delà de économies + budget', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary())

    await expect(
      executeSaveRefloatPlan({
        ...BASE,
        recap: makeRecap(),
        input: { source: 'budgets', allocations: { [BUDGET_A]: 130.5 } },
      }),
    ).rejects.toMatchObject({
      code: 'budget_capacity_exceeded',
      extras: { budgetId: BUDGET_A, capacity: 130 },
    })
  })

  it('budgets : refuse un budget inconnu (autre propriétaire)', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary())

    await expect(
      executeSaveRefloatPlan({
        ...BASE,
        recap: makeRecap(),
        input: { source: 'budgets', allocations: { 'ffff0000-0000-0000-0000-000000000000': 5 } },
      }),
    ).rejects.toMatchObject({ code: 'unknown_budget', status: 400 })
  })

  it('budgets : une liste vide efface la source', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    const m = await getMocks()
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary())

    await executeSaveRefloatPlan({
      ...BASE,
      recap: makeRecap({
        planned_savings_refloat: { [BUDGET_A]: 30 },
        budget_snapshot_data: { [BUDGET_A]: 20 },
      }),
      input: { source: 'budgets', allocations: {} },
    })
    expect(m.update).toHaveBeenCalledWith({ planned_savings_refloat: {}, budget_snapshot_data: {} })
  })

  it('projets : borné à la mensualité, écrit project_snapshot_data', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    const m = await getMocks()
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValue(makeSummary())

    await executeSaveRefloatPlan({
      ...BASE,
      recap: makeRecap(),
      input: { source: 'projects', allocations: { [PROJECT_P]: 50 } },
    })
    expect(m.update).toHaveBeenCalledWith({ project_snapshot_data: { [PROJECT_P]: 50 } })

    await expect(
      executeSaveRefloatPlan({
        ...BASE,
        recap: makeRecap(),
        input: { source: 'projects', allocations: { [PROJECT_P]: 50.5 } },
      }),
    ).rejects.toMatchObject({ code: 'project_capacity_exceeded', status: 400 })
  })

  it('refuse (409 no_deficit) quand le bilan n’est pas négatif', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary({ bilan: 0, bilanSign: 'zero' }))

    await expect(
      executeSaveRefloatPlan({
        ...BASE,
        recap: makeRecap(),
        input: { source: 'piggy', amount: 1 },
      }),
    ).rejects.toMatchObject({ code: 'no_deficit', status: 409 })
  })

  it('remonte une erreur d’écriture', async () => {
    const { executeSaveRefloatPlan } = await import('../actions-negative')
    const m = await getMocks()
    const loadSummary = await getLoadSummary()
    loadSummary.mockResolvedValueOnce(makeSummary())
    m.updateEq.mockResolvedValueOnce({ error: { message: 'write boom' } })

    await expect(
      executeSaveRefloatPlan({
        ...BASE,
        recap: makeRecap(),
        input: { source: 'piggy', amount: 1 },
      }),
    ).rejects.toMatchObject({ message: 'write boom' })
  })
})
