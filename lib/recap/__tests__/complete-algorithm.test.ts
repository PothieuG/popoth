/**
 * Pure-unit tests for `decideCompleteAllocation` — Sprint Refactor-I6.
 *
 * Pattern mirror lib/recap/__tests__/step1-algorithm.test.ts (Sprint
 * Refactor-I5). Direct vitest imports, no mocks, no env var, no Supabase.
 * These tests pin the 4 sub-flows of the original route's algorithm:
 *   - recapData composition (carry_forward vs deduct_from_budget)
 *   - Block 3 deficit + carryover calc (pre/post transfer)
 *   - Block 4 exceptional expense (adjustedDifference < 0 path)
 *   - Block 5 surplus → cumulated_savings delta
 */

import { describe, it, expect } from 'vitest'

import { decideCompleteAllocation } from '@/lib/recap/complete-algorithm'
import type {
  BudgetSnapshot,
  ProcessCompleteInput,
  ProcessCompleteSnapshot,
} from '@/lib/recap/complete-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBudget(overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Budget A',
    estimated_amount: 100,
    cumulated_savings: 0,
    monthly_surplus: 0,
    monthly_deficit: 0,
    ...overrides,
  }
}

function buildInput(overrides: Partial<ProcessCompleteInput> = {}): ProcessCompleteInput {
  return {
    userId: 'user-1',
    context: 'profile',
    contextId: 'profile-1',
    ownerField: 'profile_id',
    sessionId: 'profile_1_5_2026_123',
    finalAmount: 100,
    action: 'carry_forward',
    currentDate: new Date('2026-05-14T12:00:00.000Z'),
    ...overrides,
  }
}

function buildSnapshot(overrides: Partial<ProcessCompleteSnapshot> = {}): ProcessCompleteSnapshot {
  return {
    context: 'profile',
    contextId: 'profile-1',
    ownerField: 'profile_id',
    initialRemainingToLive: 100,
    totalEstimatedIncome: 200,
    totalEstimatedBudgets: 100,
    bankCurrentRemainingToLive: 100,
    budgets: [buildBudget()],
    realExpensesByBudget: new Map(),
    transfers: [],
    existingRecapId: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// recapData composition
// ---------------------------------------------------------------------------
describe('decideCompleteAllocation — recapData composition', () => {
  it('carry_forward: remaining_to_live_source = carried_forward + amount = initialRtl', () => {
    const decision = decideCompleteAllocation(buildSnapshot(), buildInput())
    expect(decision.recapData.remaining_to_live_source).toBe('carried_forward')
    expect(decision.recapData.remaining_to_live_amount).toBe(100) // initialRtl
    expect(decision.selectedBudgetName).toBe(null)
  })

  it('deduct_from_budget: remaining_to_live_source = from_budget_<name> + amount = finalAmount', () => {
    const budgetId = '22222222-2222-4222-8222-222222222222'
    const decision = decideCompleteAllocation(
      buildSnapshot({ budgets: [buildBudget({ id: budgetId, name: 'Compte courant' })] }),
      buildInput({ action: 'deduct_from_budget', budgetId, finalAmount: 50 }),
    )
    expect(decision.recapData.remaining_to_live_source).toBe('from_budget_Compte courant')
    expect(decision.recapData.remaining_to_live_amount).toBe(50)
    expect(decision.selectedBudgetName).toBe('Compte courant')
  })

  it('profile context: recapData.profile_id set, group_id absent', () => {
    const decision = decideCompleteAllocation(buildSnapshot(), buildInput({ context: 'profile' }))
    expect(decision.recapData.profile_id).toBe('profile-1')
    expect(decision.recapData.group_id).toBeUndefined()
  })

  it('group context: recapData.group_id set, profile_id absent', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({ context: 'group', ownerField: 'group_id' }),
      buildInput({ context: 'group', ownerField: 'group_id' }),
    )
    expect(decision.recapData.group_id).toBe('profile-1') // contextId
    expect(decision.recapData.profile_id).toBeUndefined()
  })

  it('recap_month/year derived from input.currentDate (1-indexed month, local TZ)', () => {
    // currentDate is read via local-tz getMonth()/getFullYear() — mirror original
    // route L54-55. Use a noon UTC date to avoid timezone edge cases (midnight
    // UTC end-of-year flips to January in CET+1/2).
    const decision = decideCompleteAllocation(
      buildSnapshot(),
      buildInput({ currentDate: new Date('2027-12-15T12:00:00.000Z') }),
    )
    expect(decision.recapData.recap_month).toBe(12)
    expect(decision.recapData.recap_year).toBe(2027)
  })

  it('current_step locked to 3 (completion marker)', () => {
    const decision = decideCompleteAllocation(buildSnapshot(), buildInput())
    expect(decision.recapData.current_step).toBe(3)
  })

  it('completed_at = input.currentDate.toISOString() (deterministic)', () => {
    const date = new Date('2026-05-14T10:00:00.000Z')
    const decision = decideCompleteAllocation(buildSnapshot(), buildInput({ currentDate: date }))
    expect(decision.recapData.completed_at).toBe(date.toISOString())
  })

  it('deduct_from_budget with budget not in snapshot → throws invariant violation', () => {
    expect(() =>
      decideCompleteAllocation(
        buildSnapshot(),
        buildInput({ action: 'deduct_from_budget', budgetId: 'nonexistent' }),
      ),
    ).toThrow(/invariant violation/)
  })
})

// ---------------------------------------------------------------------------
// Block 3 — deficit processing
// ---------------------------------------------------------------------------
describe('decideCompleteAllocation — Block 3 deficit processing', () => {
  it('no expenses: all budgets get carryover_amount = 0', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [
          buildBudget({ id: '11111111-1111-4111-8111-111111111111', estimated_amount: 100 }),
          buildBudget({ id: '22222222-2222-4222-8222-222222222222', estimated_amount: 200 }),
        ],
      }),
      buildInput(),
    )
    expect(decision.carryoverUpdates).toHaveLength(2)
    expect(decision.carryoverUpdates.every((u) => u.carryover_amount === 0)).toBe(true)
    expect(decision.preTransferBudgetDeficit).toBe(0)
    expect(decision.postTransferBudgetDeficit).toBe(0)
  })

  it('overspend single budget: carryover_amount = overspend', () => {
    const budgetId = '11111111-1111-4111-8111-111111111111'
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [buildBudget({ id: budgetId, estimated_amount: 100 })],
        realExpensesByBudget: new Map([[budgetId, 300]]), // overspent 200
      }),
      buildInput(),
    )
    expect(decision.carryoverUpdates).toHaveLength(1)
    expect(decision.carryoverUpdates[0]?.carryover_amount).toBe(200)
    expect(decision.preTransferBudgetDeficit).toBe(200)
    expect(decision.postTransferBudgetDeficit).toBe(200)
  })

  it('transfers IN reduce deficit (post-transfer adjustment)', () => {
    const budgetId = '11111111-1111-4111-8111-111111111111'
    const otherId = '22222222-2222-4222-8222-222222222222'
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [buildBudget({ id: budgetId, estimated_amount: 100 })],
        realExpensesByBudget: new Map([[budgetId, 300]]),
        transfers: [{ from_budget_id: otherId, to_budget_id: budgetId, transfer_amount: 150 }],
      }),
      buildInput(),
    )
    // adjustedSpent = 300 + 0 - 150 = 150, deficit = 50
    // preDeficit = 300 - 100 = 200 (NO transfers in preDeficit)
    expect(decision.carryoverUpdates[0]?.carryover_amount).toBe(50)
    expect(decision.preTransferBudgetDeficit).toBe(200)
    expect(decision.postTransferBudgetDeficit).toBe(50)
  })

  it('transfers OUT increase adjusted spent (post-transfer adjustment)', () => {
    const budgetId = '11111111-1111-4111-8111-111111111111'
    const otherId = '22222222-2222-4222-8222-222222222222'
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [
          buildBudget({ id: budgetId, estimated_amount: 100 }),
          buildBudget({ id: otherId, estimated_amount: 200 }),
        ],
        realExpensesByBudget: new Map([[budgetId, 50]]),
        transfers: [{ from_budget_id: budgetId, to_budget_id: otherId, transfer_amount: 80 }],
      }),
      buildInput(),
    )
    // For budgetId: adjustedSpent = 50 + 80 - 0 = 130, deficit = 30
    // For otherId: adjustedSpent = 0 + 0 - 80 = -80, deficit = 0
    expect(decision.carryoverUpdates.find((u) => u.budget_id === budgetId)?.carryover_amount).toBe(
      30,
    )
    expect(decision.carryoverUpdates.find((u) => u.budget_id === otherId)?.carryover_amount).toBe(0)
  })

  it('preTransferBudgetDeficit ignores transfers (raw realExpenses - estimated)', () => {
    const idA = '11111111-1111-4111-8111-111111111111'
    const idB = '22222222-2222-4222-8222-222222222222'
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [
          buildBudget({ id: idA, estimated_amount: 100 }),
          buildBudget({ id: idB, estimated_amount: 50 }),
        ],
        realExpensesByBudget: new Map([
          [idA, 200],
          [idB, 80],
        ]),
        transfers: [{ from_budget_id: idB, to_budget_id: idA, transfer_amount: 100 }],
      }),
      buildInput(),
    )
    // preDeficit A = 200 - 100 = 100
    // preDeficit B = 80 - 50 = 30
    // Sum = 130 (transfers IGNORED in pre calc)
    expect(decision.preTransferBudgetDeficit).toBe(130)
    // post: A adjusted = 200 + 0 - 100 = 100, deficit = 0
    //       B adjusted = 80 + 100 - 0 = 180, deficit = 130
    expect(decision.postTransferBudgetDeficit).toBe(130)
  })

  it('every budget gets a carryoverUpdates entry (even with carryover = 0)', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [
          buildBudget({ id: '11111111-1111-4111-8111-111111111111', name: 'A' }),
          buildBudget({ id: '22222222-2222-4222-8222-222222222222', name: 'B' }),
          buildBudget({ id: '33333333-3333-4333-8333-333333333333', name: 'C' }),
        ],
      }),
      buildInput(),
    )
    expect(decision.carryoverUpdates).toHaveLength(3)
    expect(decision.carryoverUpdates.map((u) => u.budget_name)).toEqual(['A', 'B', 'C'])
  })
})

// ---------------------------------------------------------------------------
// Block 4 — exceptional expense
// ---------------------------------------------------------------------------
describe('decideCompleteAllocation — Block 4 exceptional expense', () => {
  it('bank current_rtl == base_rtl: no exceptional (adjustedDifference = 0)', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({
        totalEstimatedIncome: 1000,
        totalEstimatedBudgets: 500,
        bankCurrentRemainingToLive: 500, // base = 500, diff = 0
      }),
      buildInput(),
    )
    expect(decision.exceptionalExpense).toBeUndefined()
  })

  it('bank current_rtl < base_rtl: exceptional expense with abs(adjustedDifference)', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({
        totalEstimatedIncome: 1000,
        totalEstimatedBudgets: 500,
        bankCurrentRemainingToLive: 300, // base=500, diff=-200, adjusted=-200 (no deficit cover)
      }),
      buildInput(),
    )
    expect(decision.exceptionalExpense).toBeDefined()
    expect(decision.exceptionalExpense?.amount).toBe(200)
    expect(decision.exceptionalExpense?.is_exceptional).toBe(true)
    expect(decision.exceptionalExpense?.estimated_budget_id).toBe(null)
    expect(decision.exceptionalExpense?.description).toMatch(/Écart de reste à vivre/)
    // Sprint Group-Transaction-Creator-Avatar : exceptional expense generated
    // by the recap finalization is attributed to the user who clicked Finaliser.
    expect(decision.exceptionalExpense?.created_by_profile_id).toBe('user-1')
  })

  it('deficit covered by transfers reduces exceptional magnitude', () => {
    const idA = '11111111-1111-4111-8111-111111111111'
    const idB = '22222222-2222-4222-8222-222222222222'
    const decision = decideCompleteAllocation(
      buildSnapshot({
        totalEstimatedIncome: 1000,
        totalEstimatedBudgets: 500,
        bankCurrentRemainingToLive: 300, // base=500, diff=-200
        budgets: [
          buildBudget({ id: idA, estimated_amount: 300 }),
          buildBudget({ id: idB, estimated_amount: 200 }),
        ],
        // A overspent 100 (pre); transfer from B covers it (post)
        realExpensesByBudget: new Map([[idA, 400]]),
        transfers: [{ from_budget_id: idB, to_budget_id: idA, transfer_amount: 100 }],
      }),
      buildInput(),
    )
    // preTransferBudgetDeficit = 400 - 300 = 100
    // postTransferBudgetDeficit: A post = 400 - 100 = 300, deficit = 0
    //                            B post = 0 + 100 = 100 transfers out, deficit = 0 (no spend)
    //                            sum = 0
    // deficitCoveredByTransfers = 100 - 0 = 100
    // adjustedDifference = -200 + 100 = -100
    expect(decision.exceptionalExpense?.amount).toBe(100)
  })

  it('exceptional expense profile_id set when context=profile', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({
        totalEstimatedIncome: 1000,
        totalEstimatedBudgets: 500,
        bankCurrentRemainingToLive: 0,
      }),
      buildInput({ context: 'profile', contextId: 'p-1' }),
    )
    expect(decision.exceptionalExpense?.profile_id).toBe('p-1')
    expect(decision.exceptionalExpense?.group_id).toBe(null)
  })

  it('exceptional expense group_id set when context=group', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({
        context: 'group',
        ownerField: 'group_id',
        totalEstimatedIncome: 1000,
        totalEstimatedBudgets: 500,
        bankCurrentRemainingToLive: 0,
      }),
      buildInput({ context: 'group', ownerField: 'group_id', contextId: 'g-1' }),
    )
    expect(decision.exceptionalExpense?.group_id).toBe('g-1')
    expect(decision.exceptionalExpense?.profile_id).toBe(null)
  })

  it('exceptional expense description includes month/year from currentDate', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({
        totalEstimatedIncome: 1000,
        totalEstimatedBudgets: 500,
        bankCurrentRemainingToLive: 0,
      }),
      buildInput({ currentDate: new Date('2026-08-15T00:00:00.000Z') }),
    )
    expect(decision.exceptionalExpense?.description).toBe(
      'Écart de reste à vivre reporté du récap 8/2026',
    )
  })

  it('exceptional expense expense_date = currentDate YYYY-MM-DD format', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({
        totalEstimatedIncome: 1000,
        totalEstimatedBudgets: 500,
        bankCurrentRemainingToLive: 0,
      }),
      buildInput({ currentDate: new Date('2026-05-14T12:34:56.000Z') }),
    )
    expect(decision.exceptionalExpense?.expense_date).toBe('2026-05-14')
  })
})

// ---------------------------------------------------------------------------
// Block 5 — surplus transfers
// ---------------------------------------------------------------------------
describe('decideCompleteAllocation — Block 5 surplus transfers', () => {
  it('no expenses → all budgets contribute surplus = estimated_amount', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [
          buildBudget({ id: '11111111-1111-4111-8111-111111111111', estimated_amount: 100 }),
          buildBudget({ id: '22222222-2222-4222-8222-222222222222', estimated_amount: 200 }),
        ],
      }),
      buildInput(),
    )
    expect(decision.surplusTransfers).toHaveLength(2)
    expect(decision.surplusTransfers.reduce((s, t) => s + t.surplus, 0)).toBe(300)
  })

  it('overspent budget excluded from surplusTransfers (surplus = 0)', () => {
    const idA = '11111111-1111-4111-8111-111111111111'
    const idB = '22222222-2222-4222-8222-222222222222'
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [
          buildBudget({ id: idA, estimated_amount: 100 }),
          buildBudget({ id: idB, estimated_amount: 200 }),
        ],
        realExpensesByBudget: new Map([
          [idA, 150], // overspent → no surplus
          [idB, 50], // surplus 150
        ]),
      }),
      buildInput(),
    )
    expect(decision.surplusTransfers).toHaveLength(1)
    expect(decision.surplusTransfers[0]?.budget_id).toBe(idB)
    expect(decision.surplusTransfers[0]?.surplus).toBe(150)
  })

  it('surplus transfer entry includes old_savings + new_savings (delta is implicit)', () => {
    const budgetId = '11111111-1111-4111-8111-111111111111'
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [buildBudget({ id: budgetId, estimated_amount: 200, cumulated_savings: 50 })],
      }),
      buildInput(),
    )
    expect(decision.surplusTransfers[0]?.old_savings).toBe(50)
    expect(decision.surplusTransfers[0]?.new_savings).toBe(250) // 50 + 200 surplus
    expect(decision.surplusTransfers[0]?.surplus).toBe(200)
  })

  it('transfers in compensate spending in surplus calc (adjustedSpent includes transfersFrom-transfersTo)', () => {
    const budgetId = '11111111-1111-4111-8111-111111111111'
    const otherId = '22222222-2222-4222-8222-222222222222'
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [
          buildBudget({ id: budgetId, estimated_amount: 200 }),
          buildBudget({ id: otherId, estimated_amount: 100 }),
        ],
        realExpensesByBudget: new Map([[budgetId, 50]]),
        transfers: [{ from_budget_id: otherId, to_budget_id: budgetId, transfer_amount: 100 }],
      }),
      buildInput(),
    )
    // adjustedSpent budgetId = 50 + 0 - 100 = -50, surplus = 200 - (-50) = 250
    expect(decision.surplusTransfers.find((t) => t.budget_id === budgetId)?.surplus).toBe(250)
  })

  it('cumulated_savings null is treated as 0 (?? fallback)', () => {
    const budgetId = '11111111-1111-4111-8111-111111111111'
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [buildBudget({ id: budgetId, estimated_amount: 100, cumulated_savings: 0 })],
      }),
      buildInput(),
    )
    expect(decision.surplusTransfers[0]?.old_savings).toBe(0)
    expect(decision.surplusTransfers[0]?.new_savings).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Summary totals
// ---------------------------------------------------------------------------
describe('decideCompleteAllocation — summary totals', () => {
  it('totalSurplus = sum of estimated_budgets.monthly_surplus (null → 0)', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [
          buildBudget({
            id: '11111111-1111-4111-8111-111111111111',
            monthly_surplus: 100,
            monthly_deficit: 0,
          }),
          buildBudget({
            id: '22222222-2222-4222-8222-222222222222',
            monthly_surplus: null,
            monthly_deficit: 0,
          }),
          buildBudget({
            id: '33333333-3333-4333-8333-333333333333',
            monthly_surplus: 50,
            monthly_deficit: 0,
          }),
        ],
      }),
      buildInput(),
    )
    expect(decision.totalSurplus).toBe(150)
  })

  it('totalDeficit = sum of estimated_budgets.monthly_deficit (null → 0)', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({
        budgets: [
          buildBudget({
            id: '11111111-1111-4111-8111-111111111111',
            monthly_deficit: 75,
            monthly_surplus: 0,
          }),
          buildBudget({
            id: '22222222-2222-4222-8222-222222222222',
            monthly_deficit: 25,
            monthly_surplus: 0,
          }),
        ],
      }),
      buildInput(),
    )
    expect(decision.totalDeficit).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// recapOperation discriminator
// ---------------------------------------------------------------------------
describe('decideCompleteAllocation — recapOperation discriminator', () => {
  it('existingRecapId === null → operation = insert', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({ existingRecapId: null }),
      buildInput(),
    )
    expect(decision.recapOperation).toBe('insert')
    expect(decision.existingRecapId).toBe(null)
  })

  it('existingRecapId set → operation = update', () => {
    const decision = decideCompleteAllocation(
      buildSnapshot({ existingRecapId: 'existing-uuid' }),
      buildInput(),
    )
    expect(decision.recapOperation).toBe('update')
    expect(decision.existingRecapId).toBe('existing-uuid')
  })
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------
describe('decideCompleteAllocation — determinism', () => {
  it('budget order in snapshot does NOT change carryoverUpdates total or surplusTransfers total', () => {
    const idA = '11111111-1111-4111-8111-111111111111'
    const idB = '22222222-2222-4222-8222-222222222222'
    const baseSnapshot = buildSnapshot({
      budgets: [
        buildBudget({ id: idA, estimated_amount: 100 }),
        buildBudget({ id: idB, estimated_amount: 200 }),
      ],
      realExpensesByBudget: new Map([[idA, 150]]), // A overspent by 50
    })
    const reorderedSnapshot = {
      ...baseSnapshot,
      budgets: [...baseSnapshot.budgets].reverse(),
    }
    const decision1 = decideCompleteAllocation(baseSnapshot, buildInput())
    const decision2 = decideCompleteAllocation(reorderedSnapshot, buildInput())
    // carryoverUpdates ordered by sorted id (deterministic)
    expect(decision1.carryoverUpdates).toEqual(decision2.carryoverUpdates)
    expect(decision1.surplusTransfers).toEqual(decision2.surplusTransfers)
    expect(decision1.preTransferBudgetDeficit).toBe(decision2.preTransferBudgetDeficit)
    expect(decision1.postTransferBudgetDeficit).toBe(decision2.postTransferBudgetDeficit)
  })

  it('decision does NOT mutate snapshot.budgets or snapshot.transfers', () => {
    const snapshot = buildSnapshot({
      budgets: [buildBudget({ id: '11111111-1111-4111-8111-111111111111', cumulated_savings: 50 })],
    })
    const originalBudgets = JSON.parse(JSON.stringify(snapshot.budgets))
    const originalTransfers = JSON.parse(JSON.stringify(snapshot.transfers))
    decideCompleteAllocation(snapshot, buildInput())
    expect(snapshot.budgets).toEqual(originalBudgets)
    expect(snapshot.transfers).toEqual(originalTransfers)
  })
})
