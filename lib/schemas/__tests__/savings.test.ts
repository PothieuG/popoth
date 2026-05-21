import { describe, it, expect } from 'vitest'
import { transferSavingsBodySchema, isBudgetToPiggyBank } from '@/lib/schemas/savings'

const validUuid = '11111111-1111-4111-8111-111111111111'
const otherUuid = '22222222-2222-4222-8222-222222222222'

describe('transferSavingsBodySchema', () => {
  it('accepts a valid budget → piggy-bank body and narrows via isBudgetToPiggyBank', () => {
    const result = transferSavingsBodySchema.safeParse({
      context: 'profile',
      action: 'budget_to_piggy_bank',
      from_budget_id: validUuid,
      amount: 50,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(isBudgetToPiggyBank(result.data)).toBe(true)
    }
  })

  it('accepts a valid budget → budget body (action absent)', () => {
    const result = transferSavingsBodySchema.safeParse({
      context: 'group',
      from_budget_id: validUuid,
      to_budget_id: otherUuid,
      amount: 30,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(isBudgetToPiggyBank(result.data)).toBe(false)
    }
  })

  it('rejects budget → budget when from_budget_id === to_budget_id (refine on path to_budget_id)', () => {
    const result = transferSavingsBodySchema.safeParse({
      context: 'profile',
      from_budget_id: validUuid,
      to_budget_id: validUuid,
      amount: 30,
    })
    expect(result.success).toBe(false)
  })
})
