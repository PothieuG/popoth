import { describe, it, expect } from 'vitest'
import { addTransactionFormSchema } from '@/lib/schemas/transactions'

const validUuid = '11111111-1111-4111-8111-111111111111'

const baseExpense = {
  transactionType: 'expense' as const,
  description: 'Dépense',
  expense_date: '2026-05-29',
}

describe('addTransactionFormSchema — expense branch', () => {
  it('accepts a budgeted expense (regression: XOR refine)', () => {
    const result = addTransactionFormSchema.safeParse({
      ...baseExpense,
      amount: 100,
      is_exceptional: false,
      estimated_budget_id: validUuid,
    })
    expect(result.success).toBe(true)
  })

  it('accepts an exceptional expense without piggy field', () => {
    const result = addTransactionFormSchema.safeParse({
      ...baseExpense,
      amount: 100,
      is_exceptional: true,
      estimated_budget_id: null,
    })
    expect(result.success).toBe(true)
  })

  // Sprint Exceptional-Expense-Piggy-Funding
  it('accepts an exceptional expense with piggy ≤ amount', () => {
    const result = addTransactionFormSchema.safeParse({
      ...baseExpense,
      amount: 300,
      is_exceptional: true,
      estimated_budget_id: null,
      amount_from_piggy_bank: 200,
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.transactionType === 'expense') {
      expect(result.data.amount_from_piggy_bank).toBe(200)
    }
  })

  it('accepts piggy === amount (fully funded)', () => {
    const result = addTransactionFormSchema.safeParse({
      ...baseExpense,
      amount: 150,
      is_exceptional: true,
      estimated_budget_id: null,
      amount_from_piggy_bank: 150,
    })
    expect(result.success).toBe(true)
  })

  it('rejects piggy > amount (refine)', () => {
    const result = addTransactionFormSchema.safeParse({
      ...baseExpense,
      amount: 100,
      is_exceptional: true,
      estimated_budget_id: null,
      amount_from_piggy_bank: 120,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('amount_from_piggy_bank'))).toBe(true)
    }
  })

  it('coerces a comma-decimal string piggy amount (DecimalFormInput input)', () => {
    const result = addTransactionFormSchema.safeParse({
      ...baseExpense,
      amount: 300,
      is_exceptional: true,
      estimated_budget_id: null,
      amount_from_piggy_bank: '49.50',
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.transactionType === 'expense') {
      expect(result.data.amount_from_piggy_bank).toBe(49.5)
    }
  })
})
