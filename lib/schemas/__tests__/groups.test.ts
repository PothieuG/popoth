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
    const result = createGroupBodySchema.safeParse({ name: '  Famille  ' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.name).toBe('Famille')
  })

  it('rejects short name', () => {
    expect(createGroupBodySchema.safeParse({ name: 'X' }).success).toBe(false)
  })

  it('ignores monthly_budget_estimate if passed (auto-synced via DB trigger)', () => {
    // Z default mode strips unknown keys; the body parser will simply ignore
    // a stray monthly_budget_estimate from older clients without throwing.
    const result = createGroupBodySchema.safeParse({
      name: 'Famille',
      monthly_budget_estimate: 1500,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Famille')
      expect('monthly_budget_estimate' in result.data).toBe(false)
    }
  })
})

describe('updateGroupBodySchema', () => {
  it('accepts a body with only name', () => {
    expect(updateGroupBodySchema.safeParse({ name: 'Famille' }).success).toBe(true)
  })

  it('rejects an empty body (name required)', () => {
    expect(updateGroupBodySchema.safeParse({}).success).toBe(false)
  })

  it('ignores monthly_budget_estimate if passed (auto-synced via DB trigger)', () => {
    const result = updateGroupBodySchema.safeParse({
      name: 'Famille',
      monthly_budget_estimate: 2000,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect('monthly_budget_estimate' in result.data).toBe(false)
    }
  })
})
