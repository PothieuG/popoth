import { describe, it, expect } from 'vitest'
import { searchGroupsQuerySchema } from '@/lib/schemas/groups'

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
