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

  it('accepts cross_budget_cascade array (P4 Phase 2)', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 200,
      description: 'Big purchase',
      estimated_budget_id: validUuid,
      cross_budget_cascade: [
        { budget_id: otherUuid, amount: 50 },
        { budget_id: '33333333-3333-4333-8333-333333333333', amount: 30 },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.cross_budget_cascade?.length).toBe(2)
  })

  it('rejects cross_budget_cascade with invalid budget_id', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 200,
      description: 'Big purchase',
      estimated_budget_id: validUuid,
      cross_budget_cascade: [{ budget_id: 'not-a-uuid', amount: 50 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects cross_budget_cascade with non-positive amount', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 200,
      description: 'Big purchase',
      estimated_budget_id: validUuid,
      cross_budget_cascade: [{ budget_id: otherUuid, amount: 0 }],
    })
    expect(result.success).toBe(false)
  })

  it('cross_budget_cascade is optional (absent → no Phase 2)', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 100,
      description: 'Lunch',
      estimated_budget_id: validUuid,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.cross_budget_cascade).toBeUndefined()
  })
})
