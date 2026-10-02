import { describe, it, expect } from 'vitest'
import { addExpenseWithLogicBodySchema } from '@/lib/schemas/expense'

const validUuid = '11111111-1111-4111-8111-111111111111'
const otherUuid = '22222222-2222-4222-8222-222222222222'

describe('addExpenseWithLogicBodySchema', () => {
  it('accepts a budgeted body (with estimated_budget_id) → smart-allocation path', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 150,
      description: 'Lunch',
      estimated_budget_id: validUuid,
      is_for_group: false,
    })
    expect(result.success).toBe(true)
    // P5 toggle defaults to false
    if (result.success) expect(result.data.use_savings).toBe(false)
  })

  it('accepts an exceptional body (no estimated_budget_id) → direct-insert path', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 50,
      description: 'Coffee',
    })
    expect(result.success).toBe(true)
  })

  it('accepts use_savings: true (P5 opt-in toggle)', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 100,
      description: 'Lunch',
      estimated_budget_id: validUuid,
      use_savings: true,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.use_savings).toBe(true)
  })

  it('accepts overflow_coverage (tirelire + économies d’autres budgets)', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 200,
      description: 'Big purchase',
      estimated_budget_id: validUuid,
      overflow_coverage: {
        piggy: 20,
        budgets: [
          { budget_id: otherUuid, amount: 50 },
          { budget_id: '33333333-3333-4333-8333-333333333333', amount: 30 },
        ],
      },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.overflow_coverage?.budgets.length).toBe(2)
  })

  it('rejects overflow_coverage with invalid budget_id', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 200,
      description: 'Big purchase',
      estimated_budget_id: validUuid,
      overflow_coverage: { piggy: 0, budgets: [{ budget_id: 'not-a-uuid', amount: 50 }] },
    })
    expect(result.success).toBe(false)
  })

  it('rejects overflow_coverage with non-positive budget amount or negative piggy', () => {
    const zeroBudget = addExpenseWithLogicBodySchema.safeParse({
      amount: 200,
      description: 'Big purchase',
      estimated_budget_id: validUuid,
      overflow_coverage: { piggy: 0, budgets: [{ budget_id: otherUuid, amount: 0 }] },
    })
    const negativePiggy = addExpenseWithLogicBodySchema.safeParse({
      amount: 200,
      description: 'Big purchase',
      estimated_budget_id: validUuid,
      overflow_coverage: { piggy: -1, budgets: [] },
    })
    expect(zeroBudget.success).toBe(false)
    expect(negativePiggy.success).toBe(false)
  })

  it('overflow_coverage is optional (absent → dépassement sur le reste à vivre)', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 100,
      description: 'Lunch',
      estimated_budget_id: validUuid,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.overflow_coverage).toBeUndefined()
  })

  // Sprint Exceptional-Expense-Piggy-Funding
  it('accepts amount_from_piggy_bank on an exceptional body', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 300,
      description: 'Vacances',
      amount_from_piggy_bank: 200,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.amount_from_piggy_bank).toBe(200)
  })

  it('accepts amount_from_piggy_bank = 0 (toggle off)', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 80,
      description: 'Coffee',
      amount_from_piggy_bank: 0,
    })
    expect(result.success).toBe(true)
  })

  it('amount_from_piggy_bank is optional (absent → undefined)', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 80,
      description: 'Coffee',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.amount_from_piggy_bank).toBeUndefined()
  })

  it('rejects negative amount_from_piggy_bank', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 80,
      description: 'Coffee',
      amount_from_piggy_bank: -5,
    })
    expect(result.success).toBe(false)
  })

  it('rejects amount_from_piggy_bank with > 2 decimals', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 80,
      description: 'Coffee',
      amount_from_piggy_bank: 12.345,
    })
    expect(result.success).toBe(false)
  })
})
