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

  // Sprint Fix-Recap-EditPath-Month 2026-08-31 — month/year sont des paramètres
  // de contexte (fenêtre du recalcul), pas des champs à mettre à jour.
  it('accepts month/year alongside a real update field', () => {
    const result = updateRealExpenseBodySchema.safeParse({
      id: validUuid,
      amount: 42.5,
      month: 5,
      year: 2026,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.month).toBe(5)
      expect(result.data.year).toBe(2026)
    }
  })

  it('still rejects a body carrying only id + month/year (they are not update fields)', () => {
    const result = updateRealExpenseBodySchema.safeParse({
      id: validUuid,
      month: 5,
      year: 2026,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const refineIssue = result.error.issues.find((i) =>
        i.message.includes('Aucune donnée à mettre à jour'),
      )
      expect(refineIssue).toBeDefined()
    }
  })

  it('rejects out-of-range month/year', () => {
    expect(
      updateRealExpenseBodySchema.safeParse({ id: validUuid, amount: 10, month: 13, year: 2026 })
        .success,
    ).toBe(false)
    expect(
      updateRealExpenseBodySchema.safeParse({ id: validUuid, amount: 10, month: 0, year: 2026 })
        .success,
    ).toBe(false)
    expect(
      updateRealExpenseBodySchema.safeParse({ id: validUuid, amount: 10, month: 5, year: 1999 })
        .success,
    ).toBe(false)
  })

  it('accepts month without year (route falls back to today when either is missing)', () => {
    const result = updateRealExpenseBodySchema.safeParse({
      id: validUuid,
      amount: 10,
      month: 5,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.year).toBeUndefined()
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

  it('coerces month/year strings to numbers when both fournis (wizard récap)', () => {
    const result = previewBreakdownQuerySchema.safeParse({
      amount: '100',
      budget_id: validUuid,
      month: '5',
      year: '2026',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.month).toBe(5)
      expect(result.data.year).toBe(2026)
    }
  })

  it('rejects month=13 et month=0 (1-12 bornes)', () => {
    expect(
      previewBreakdownQuerySchema.safeParse({
        amount: '100',
        budget_id: validUuid,
        month: '13',
        year: '2026',
      }).success,
    ).toBe(false)
    expect(
      previewBreakdownQuerySchema.safeParse({
        amount: '100',
        budget_id: validUuid,
        month: '0',
        year: '2026',
      }).success,
    ).toBe(false)
  })

  it('accepte month seul sans year (route applique le fallback today)', () => {
    const result = previewBreakdownQuerySchema.safeParse({
      amount: '100',
      budget_id: validUuid,
      month: '5',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.month).toBe(5)
      expect(result.data.year).toBeUndefined()
    }
  })
})
