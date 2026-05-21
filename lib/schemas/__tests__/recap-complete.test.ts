import { describe, it, expect } from 'vitest'
import { completeBodySchema } from '@/lib/schemas/recap-legacy'

const validUuid = '11111111-1111-4111-8111-111111111111'

describe('completeBodySchema', () => {
  it('accepts a carry_forward choice (no budget_id needed)', () => {
    const result = completeBodySchema.safeParse({
      context: 'profile',
      session_id: 'session-abc',
      remaining_to_live_choice: {
        action: 'carry_forward',
        final_amount: 50,
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a deduct_from_budget choice with budget_id', () => {
    const result = completeBodySchema.safeParse({
      context: 'group',
      session_id: 'session-abc',
      remaining_to_live_choice: {
        action: 'deduct_from_budget',
        budget_id: validUuid,
        final_amount: -20,
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects deduct_from_budget without budget_id (discriminatedUnion narrowing)', () => {
    const result = completeBodySchema.safeParse({
      context: 'profile',
      session_id: 'session-abc',
      remaining_to_live_choice: {
        action: 'deduct_from_budget',
        final_amount: -20,
      },
    })
    expect(result.success).toBe(false)
  })
})
