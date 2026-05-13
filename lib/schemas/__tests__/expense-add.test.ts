import { describe, it, expect } from 'vitest'
import { addExpenseWithLogicBodySchema } from '@/lib/schemas/expense'

const validUuid = '11111111-1111-4111-8111-111111111111'

describe('addExpenseWithLogicBodySchema', () => {
  it('accepts a budgeted body (with estimated_budget_id) → smart-allocation path', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 150,
      description: 'Lunch',
      estimated_budget_id: validUuid,
      is_for_group: false,
    })
    expect(result.success).toBe(true)
  })

  it('accepts an exceptional body (no estimated_budget_id) → direct-insert path', () => {
    const result = addExpenseWithLogicBodySchema.safeParse({
      amount: 50,
      description: 'Coffee',
    })
    expect(result.success).toBe(true)
  })
})
