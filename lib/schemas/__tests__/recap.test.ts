import { describe, it, expect } from 'vitest'
import {
  accumulatePiggyBankBodySchema,
  autoBalanceBodySchema,
  manualTransferBodySchema,
  refreshRecapQuerySchema,
} from '@/lib/schemas/recap'

const validUuid = '11111111-1111-4111-8111-111111111111'
const otherUuid = '22222222-2222-4222-8222-222222222222'

describe('autoBalanceBodySchema', () => {
  it('accepts a valid context', () => {
    expect(autoBalanceBodySchema.safeParse({ context: 'profile' }).success).toBe(true)
    expect(autoBalanceBodySchema.safeParse({ context: 'group' }).success).toBe(true)
  })

  it('rejects invalid context values', () => {
    expect(autoBalanceBodySchema.safeParse({ context: 'invalid' }).success).toBe(false)
    expect(autoBalanceBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('accumulatePiggyBankBodySchema', () => {
  it('accepts zero amount (route short-circuits the no-op)', () => {
    const result = accumulatePiggyBankBodySchema.safeParse({ context: 'profile', amount: 0 })
    expect(result.success).toBe(true)
  })
})

describe('manualTransferBodySchema', () => {
  it('rejects same-id transfer (refine on path to_budget_id)', () => {
    const result = manualTransferBodySchema.safeParse({
      context: 'profile',
      from_budget_id: validUuid,
      to_budget_id: validUuid,
      amount: 30,
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid transfer with monthly_recap_id null', () => {
    const result = manualTransferBodySchema.safeParse({
      context: 'profile',
      from_budget_id: validUuid,
      to_budget_id: otherUuid,
      amount: 30,
      monthly_recap_id: null,
    })
    expect(result.success).toBe(true)
  })
})

describe('refreshRecapQuerySchema', () => {
  it('accepts valid context + session_id', () => {
    const result = refreshRecapQuerySchema.safeParse({
      context: 'group',
      session_id: 'profile_abc_5_2026_1234567',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.context).toBe('group')
  })

  it('defaults context to profile when absent', () => {
    const result = refreshRecapQuerySchema.safeParse({ session_id: 'x' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.context).toBe('profile')
  })

  it('rejects missing session_id', () => {
    expect(refreshRecapQuerySchema.safeParse({ context: 'profile' }).success).toBe(false)
    expect(refreshRecapQuerySchema.safeParse({ session_id: '' }).success).toBe(false)
  })
})
