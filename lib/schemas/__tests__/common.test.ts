import { describe, it, expect } from 'vitest'
import { moneySchema } from '@/lib/schemas/common'

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
