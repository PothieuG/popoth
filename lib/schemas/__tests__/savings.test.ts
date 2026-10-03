import { describe, it, expect } from 'vitest'
import {
  isBudgetToPiggyBank,
  makeSavingsTransferFormSchema,
  savingsTransferBodySchema,
  transferSavingsBodySchema,
} from '@/lib/schemas/savings'

const validUuid = '11111111-1111-4111-8111-111111111111'
const otherUuid = '22222222-2222-4222-8222-222222222222'

describe('transferSavingsBodySchema', () => {
  it('accepts a valid budget → piggy-bank body and narrows via isBudgetToPiggyBank', () => {
    const result = transferSavingsBodySchema.safeParse({
      context: 'profile',
      action: 'budget_to_piggy_bank',
      from_budget_id: validUuid,
      amount: 50,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(isBudgetToPiggyBank(result.data)).toBe(true)
    }
  })

  it('accepts a valid budget → budget body (action absent)', () => {
    const result = transferSavingsBodySchema.safeParse({
      context: 'group',
      from_budget_id: validUuid,
      to_budget_id: otherUuid,
      amount: 30,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(isBudgetToPiggyBank(result.data)).toBe(false)
    }
  })

  it('rejects budget → budget when from_budget_id === to_budget_id (refine on path to_budget_id)', () => {
    const result = transferSavingsBodySchema.safeParse({
      context: 'profile',
      from_budget_id: validUuid,
      to_budget_id: validUuid,
      amount: 30,
    })
    expect(result.success).toBe(false)
  })
})

describe('savingsTransferBodySchema (Part 50)', () => {
  it('accepte un envoi et une réception', () => {
    expect(
      savingsTransferBodySchema.safeParse({ context: 'profile', direction: 'send', amount: 50 })
        .success,
    ).toBe(true)
    expect(
      savingsTransferBodySchema.safeParse({ context: 'group', direction: 'receive', amount: 0.5 })
        .success,
    ).toBe(true)
  })

  it('refuse un sens inconnu', () => {
    expect(
      savingsTransferBodySchema.safeParse({ context: 'profile', direction: 'move', amount: 50 })
        .success,
    ).toBe(false)
  })

  it('refuse un montant nul, négatif ou à 3 décimales', () => {
    for (const amount of [0, -10, 10.001]) {
      expect(
        savingsTransferBodySchema.safeParse({ context: 'profile', direction: 'send', amount })
          .success,
      ).toBe(false)
    }
  })
})

describe('makeSavingsTransferFormSchema (Part 50)', () => {
  const schema = makeSavingsTransferFormSchema({ totalSavings: 200 })

  it('accepte une saisie décimale jusqu’au total des économies', () => {
    const result = schema.safeParse({ amount: '200' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.amount).toBe(200)
  })

  it('refuse au-delà du total, avec le message sur le champ montant', () => {
    const result = schema.safeParse({ amount: '200.01' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['amount'])
      expect(result.error.issues[0]?.message).toBe('Le montant dépasse le total de vos économies')
    }
  })

  it('refuse un montant nul', () => {
    expect(schema.safeParse({ amount: '0' }).success).toBe(false)
  })
})
