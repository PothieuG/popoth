import { describe, it, expect } from 'vitest'
import { updateBankBalanceBodySchema } from '@/lib/schemas/bank-balance'

describe('updateBankBalanceBodySchema', () => {
  it('accepts positive, zero, and negative balances (overdraft allowed)', () => {
    expect(updateBankBalanceBodySchema.safeParse({ balance: 1500.5 }).success).toBe(true)
    expect(updateBankBalanceBodySchema.safeParse({ balance: 0 }).success).toBe(true)
    expect(updateBankBalanceBodySchema.safeParse({ balance: -250.99 }).success).toBe(true)
  })

  it('rejects NaN, Infinity, missing balance, and non-number types', () => {
    expect(updateBankBalanceBodySchema.safeParse({ balance: Number.NaN }).success).toBe(false)
    expect(
      updateBankBalanceBodySchema.safeParse({ balance: Number.POSITIVE_INFINITY }).success,
    ).toBe(false)
    expect(updateBankBalanceBodySchema.safeParse({ balance: '100' }).success).toBe(false)
    expect(updateBankBalanceBodySchema.safeParse({}).success).toBe(false)
  })
})
