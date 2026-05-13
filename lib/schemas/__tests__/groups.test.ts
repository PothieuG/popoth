import { describe, it, expect } from 'vitest'
import {
  createGroupBodySchema,
  searchGroupsQuerySchema,
  updateGroupBodySchema,
} from '@/lib/schemas/groups'

describe('searchGroupsQuerySchema', () => {
  it('accepts valid q + limit and coerces limit string to int', () => {
    const result = searchGroupsQuerySchema.safeParse({ q: '  budget  ', limit: '15' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.q).toBe('budget')
      expect(result.data.limit).toBe(15)
    }
  })

  it('defaults q="" and limit=20 when absent', () => {
    const result = searchGroupsQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.q).toBe('')
      expect(result.data.limit).toBe(20)
    }
  })

  it('rejects limit > 50', () => {
    expect(searchGroupsQuerySchema.safeParse({ limit: '100' }).success).toBe(false)
  })
})

describe('createGroupBodySchema', () => {
  it('accepts a valid body and trims the name', () => {
    const result = createGroupBodySchema.safeParse({
      name: '  Famille  ',
      monthly_budget_estimate: 1500,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.name).toBe('Famille')
  })

  it('rejects short name and non-positive budget', () => {
    expect(
      createGroupBodySchema.safeParse({ name: 'X', monthly_budget_estimate: 100 }).success,
    ).toBe(false)
    expect(
      createGroupBodySchema.safeParse({ name: 'Famille', monthly_budget_estimate: 0 }).success,
    ).toBe(false)
  })
})

describe('updateGroupBodySchema', () => {
  it('accepts partial update with only name', () => {
    expect(updateGroupBodySchema.safeParse({ name: 'Famille' }).success).toBe(true)
  })

  it('accepts partial update with only monthly_budget_estimate', () => {
    expect(updateGroupBodySchema.safeParse({ monthly_budget_estimate: 2000 }).success).toBe(true)
  })

  it('rejects empty update body (refine at-least-one)', () => {
    const result = updateGroupBodySchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Aucune donnée à mettre à jour')
    }
  })
})
