import { describe, it, expect } from 'vitest'
import {
  createRealExpenseBodySchema,
  previewBreakdownQuerySchema,
  updateRealExpenseBodySchema,
} from '@/lib/schemas/expense'

const validUuid = '11111111-1111-4111-8111-111111111111'

describe('createRealExpenseBodySchema', () => {
  it('accepts a valid budgeted-expense body', () => {
    const result = createRealExpenseBodySchema.safeParse({
      amount: 42.5,
      description: 'Courses du 10/05',
      expense_date: '2026-05-10',
      estimated_budget_id: validUuid,
    })
    expect(result.success).toBe(true)
  })
})

describe('updateRealExpenseBodySchema', () => {
  it('rejects an update body with only id (refine: at least one field required)', () => {
    const result = updateRealExpenseBodySchema.safeParse({ id: validUuid })
    expect(result.success).toBe(false)
    if (!result.success) {
      const refineIssue = result.error.issues.find((i) =>
        i.message.includes('Aucune donnée à mettre à jour'),
      )
      expect(refineIssue).toBeDefined()
    }
  })
})

describe('previewBreakdownQuerySchema', () => {
  it('coerces amount string to positive number and parses required uuid', () => {
    const result = previewBreakdownQuerySchema.safeParse({
      amount: '42.5',
      budget_id: validUuid,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.amount).toBe(42.5)
      expect(result.data.context).toBe('profile')
    }
  })

  it('rejects zero/negative amount and missing budget_id', () => {
    expect(
      previewBreakdownQuerySchema.safeParse({ amount: '0', budget_id: validUuid }).success,
    ).toBe(false)
    expect(previewBreakdownQuerySchema.safeParse({ amount: '5' }).success).toBe(false)
  })
})
