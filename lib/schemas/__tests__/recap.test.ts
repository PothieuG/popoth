import { describe, it, expect } from 'vitest'
import {
  accumulatePiggyBankBodySchema,
  autoBalanceBodySchema,
  initializeRecapBodySchema,
  manualTransferBodySchema,
  recoverRecapBodySchema,
  refreshRecapQuerySchema,
  updateRecapStepBodySchema,
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

describe('initializeRecapBodySchema', () => {
  it('defaults context to profile when body is empty', () => {
    const result = initializeRecapBodySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.context).toBe('profile')
  })

  it('accepts explicit group context', () => {
    expect(initializeRecapBodySchema.safeParse({ context: 'group' }).success).toBe(true)
  })

  it('rejects invalid context values', () => {
    expect(initializeRecapBodySchema.safeParse({ context: 'foo' }).success).toBe(false)
  })
})

describe('recoverRecapBodySchema', () => {
  it('accepts valid body with confirm:true', () => {
    expect(recoverRecapBodySchema.safeParse({ confirm: true }).success).toBe(true)
    expect(
      recoverRecapBodySchema.safeParse({
        context: 'group',
        snapshot_id: validUuid,
        confirm: true,
      }).success,
    ).toBe(true)
  })

  it('rejects when confirm is missing or false', () => {
    expect(recoverRecapBodySchema.safeParse({ confirm: false }).success).toBe(false)
    expect(recoverRecapBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects malformed snapshot_id', () => {
    expect(
      recoverRecapBodySchema.safeParse({ confirm: true, snapshot_id: 'not-a-uuid' }).success,
    ).toBe(false)
  })
})

describe('updateRecapStepBodySchema', () => {
  it('accepts a valid body with all 5 session_id parts well-formed', () => {
    const result = updateRecapStepBodySchema.safeParse({
      context: 'profile',
      session_id: 'profile_abc-123_5_2026_1700000000',
      current_step: 2,
    })
    expect(result.success).toBe(true)
  })

  it('rejects session_id with fewer than 5 parts', () => {
    expect(
      updateRecapStepBodySchema.safeParse({
        session_id: 'profile_abc_5_2026',
        current_step: 1,
      }).success,
    ).toBe(false)
  })

  it('rejects out-of-range current_step', () => {
    expect(
      updateRecapStepBodySchema.safeParse({
        session_id: 'profile_abc_5_2026_1700000000',
        current_step: 4,
      }).success,
    ).toBe(false)
    expect(
      updateRecapStepBodySchema.safeParse({
        session_id: 'profile_abc_5_2026_1700000000',
        current_step: 0,
      }).success,
    ).toBe(false)
  })
})
