import { describe, it, expect } from 'vitest'
import {
  createEstimatedIncomeBodySchema,
  updateEstimatedIncomeBodySchema,
} from '@/lib/schemas/income'

describe('createEstimatedIncomeBodySchema', () => {
  it('accepts a minimal create body (no optional booleans)', () => {
    const result = createEstimatedIncomeBodySchema.safeParse({
      name: 'Salaire',
      estimated_amount: 1500,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.is_monthly_recurring).toBeUndefined()
      expect(result.data.is_for_group).toBeUndefined()
    }
  })

  it('accepts a full body and trims the name', () => {
    const result = createEstimatedIncomeBodySchema.safeParse({
      name: '  Freelance  ',
      estimated_amount: 800,
      is_monthly_recurring: false,
      is_for_group: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Freelance')
      expect(result.data.is_for_group).toBe(true)
    }
  })

  it('rejects negative estimated_amount and short names (snake_case mirror of camelCase v1)', () => {
    expect(
      createEstimatedIncomeBodySchema.safeParse({ name: 'Salaire', estimated_amount: -100 })
        .success,
    ).toBe(false)
    expect(
      createEstimatedIncomeBodySchema.safeParse({ name: 'X', estimated_amount: 100 }).success,
    ).toBe(false)
  })
})

describe('updateEstimatedIncomeBodySchema', () => {
  it('accepts a partial update with only is_monthly_recurring', () => {
    const result = updateEstimatedIncomeBodySchema.safeParse({
      id: '22222222-2222-4222-8222-222222222222',
      is_monthly_recurring: false,
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty update body (refine at-least-one)', () => {
    const result = updateEstimatedIncomeBodySchema.safeParse({
      id: '22222222-2222-4222-8222-222222222222',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Aucune donnée à mettre à jour')
    }
  })

  it('rejects malformed id (non-uuid)', () => {
    expect(
      updateEstimatedIncomeBodySchema.safeParse({ id: 'not-a-uuid', name: 'Salaire' }).success,
    ).toBe(false)
  })
})
