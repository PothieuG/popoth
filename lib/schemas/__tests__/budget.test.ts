import { describe, it, expect } from 'vitest'
import {
  createBudgetBodySchema,
  createEstimatedBudgetBodySchema,
  updateEstimatedBudgetBodySchema,
} from '@/lib/schemas/budget'

describe('createBudgetBodySchema', () => {
  it('accepts a valid create body and trims the name', () => {
    const result = createBudgetBodySchema.safeParse({
      name: '  Courses  ',
      estimatedAmount: 250,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Courses')
    }
  })

  it('rejects zero/negative estimatedAmount and short names', () => {
    expect(createBudgetBodySchema.safeParse({ name: 'Courses', estimatedAmount: 0 }).success).toBe(
      false,
    )
    expect(
      createBudgetBodySchema.safeParse({ name: 'Courses', estimatedAmount: -50 }).success,
    ).toBe(false)
    expect(createBudgetBodySchema.safeParse({ name: 'X', estimatedAmount: 10 }).success).toBe(false)
  })
})

describe('createEstimatedBudgetBodySchema', () => {
  it('accepts a minimal create body (no optional booleans)', () => {
    const result = createEstimatedBudgetBodySchema.safeParse({
      name: 'Courses',
      estimated_amount: 250,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.is_monthly_recurring).toBeUndefined()
      expect(result.data.is_for_group).toBeUndefined()
    }
  })

  it('accepts a full body with both booleans set', () => {
    const result = createEstimatedBudgetBodySchema.safeParse({
      name: '  Loyer  ',
      estimated_amount: 1200,
      is_monthly_recurring: false,
      is_for_group: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Loyer')
      expect(result.data.is_for_group).toBe(true)
    }
  })

  it('rejects negative estimated_amount and short names (snake_case mirror of camelCase v1)', () => {
    expect(
      createEstimatedBudgetBodySchema.safeParse({ name: 'Courses', estimated_amount: -50 }).success,
    ).toBe(false)
    expect(
      createEstimatedBudgetBodySchema.safeParse({ name: 'X', estimated_amount: 10 }).success,
    ).toBe(false)
  })
})

describe('updateEstimatedBudgetBodySchema', () => {
  it('accepts a partial update with only estimated_amount', () => {
    const result = updateEstimatedBudgetBodySchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      estimated_amount: 300,
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty update body (refine at-least-one)', () => {
    const result = updateEstimatedBudgetBodySchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Aucune donnée à mettre à jour')
    }
  })

  it('rejects malformed id (non-uuid)', () => {
    expect(
      updateEstimatedBudgetBodySchema.safeParse({ id: 'not-a-uuid', name: 'Courses' }).success,
    ).toBe(false)
  })
})
