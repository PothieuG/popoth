import { describe, it, expect } from 'vitest'
import {
  contextOnlyQuerySchema,
  deleteByIdQuerySchema,
  estimatedListQuerySchema,
  moneySchema,
} from '@/lib/schemas/common'

describe('moneySchema', () => {
  it('accepts a positive amount with up to 2 decimals', () => {
    expect(moneySchema.safeParse(42.99).success).toBe(true)
    expect(moneySchema.safeParse(0.01).success).toBe(true)
    expect(moneySchema.safeParse(1000).success).toBe(true)
  })

  it('rejects negative and zero amounts', () => {
    expect(moneySchema.safeParse(-1).success).toBe(false)
    expect(moneySchema.safeParse(0).success).toBe(false)
  })

  it('rejects NaN and Infinity', () => {
    expect(moneySchema.safeParse(Number.NaN).success).toBe(false)
    expect(moneySchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false)
    expect(moneySchema.safeParse(Number.NEGATIVE_INFINITY).success).toBe(false)
  })

  it('rejects more than 2 decimals', () => {
    expect(moneySchema.safeParse(0.001).success).toBe(false)
    expect(moneySchema.safeParse(1.234).success).toBe(false)
  })
})

describe('contextOnlyQuerySchema', () => {
  it('defaults to profile when context is absent', () => {
    const result = contextOnlyQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.context).toBe('profile')
  })

  it('accepts group as context value', () => {
    const result = contextOnlyQuerySchema.safeParse({ context: 'group' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.context).toBe('group')
  })
})

describe('estimatedListQuerySchema', () => {
  it('coerces group="true" to boolean true', () => {
    const result = estimatedListQuerySchema.safeParse({ group: 'true' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.group).toBe(true)
  })

  it('coerces group="false" or absent to boolean false', () => {
    const r1 = estimatedListQuerySchema.safeParse({ group: 'false' })
    const r2 = estimatedListQuerySchema.safeParse({})
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    if (r1.success) expect(r1.data.group).toBe(false)
    if (r2.success) expect(r2.data.group).toBe(false)
  })
})

describe('deleteByIdQuerySchema', () => {
  it('accepts a valid uuid', () => {
    const result = deleteByIdQuerySchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
    })
    expect(result.success).toBe(true)
  })

  it('rejects malformed uuid or missing id', () => {
    expect(deleteByIdQuerySchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false)
    expect(deleteByIdQuerySchema.safeParse({}).success).toBe(false)
  })
})
