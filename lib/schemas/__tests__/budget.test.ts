import { describe, it, expect } from 'vitest'
import { createBudgetBodySchema } from '@/lib/schemas/budget'

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
