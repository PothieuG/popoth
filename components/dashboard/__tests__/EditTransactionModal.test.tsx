import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const updateExpense = vi.fn(async () => true)
const updateIncome = vi.fn(async () => true)

const BUDGET_UUID = '11111111-1111-4111-8111-111111111111'

vi.mock('@/hooks/useBudgets', () => ({
  useBudgets: () => ({
    budgets: [
      { id: BUDGET_UUID, name: 'Alimentation', estimated_amount: 500, cumulated_savings: 0 },
    ],
  }),
}))
vi.mock('@/hooks/useIncomes', () => ({
  useIncomes: () => ({ incomes: [{ id: 'i-1', name: 'Salaire', estimated_amount: 1500 }] }),
}))
vi.mock('@/hooks/useRealExpenses', () => ({
  useRealExpenses: () => ({ updateExpense, expenses: [] }),
}))
vi.mock('@/hooks/useRealIncomes', () => ({
  useRealIncomes: () => ({ updateIncome, incomes: [] }),
}))
vi.mock('@/components/dashboard/ExpenseBreakdownPreview', () => ({
  default: () => null,
}))
vi.mock('@/components/ui/CustomDropdown', () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="fk-dropdown-readonly">FK={value || 'none'}</div>
  ),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import EditTransactionModal from '../EditTransactionModal'

const TRANSACTION_UUID = '33333333-3333-4333-8333-333333333333'

const baseExpense = {
  id: TRANSACTION_UUID,
  description: 'Vieille dépense',
  amount: 75,
  expense_date: '2026-05-01',
  is_exceptional: false,
  estimated_budget_id: BUDGET_UUID,
  amount_from_piggy: 0,
  amount_from_savings: 0,
  amount_from_budget: 75,
  is_for_group: false,
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
}

describe('EditTransactionModal', () => {
  beforeEach(() => {
    updateExpense.mockClear()
    updateIncome.mockClear()
    updateExpense.mockResolvedValue(true)
    updateIncome.mockResolvedValue(true)
  })

  it('renders nothing when transaction prop is null', () => {
    const { container } = render(
      <EditTransactionModal
        onClose={vi.fn()}
        transaction={null}
        transactionType="expense"
      />,
    )
    expect(container.querySelector('input[name="description"]')).toBeNull()
  })

  it('preserves transactionType via prop (no radio buttons rendered)', () => {
    render(
      <EditTransactionModal
        onClose={vi.fn()}
        transaction={baseExpense}
        transactionType="expense"
      />,
    )
    // EditTransactionModal does not expose a transactionType switcher
    expect(screen.queryByRole('button', { name: /^Revenu$/ })).toBeNull()
  })

  it('calls updateExpense with merged fields on happy submit', async () => {
    const onClose = vi.fn()
    const onTransactionUpdated = vi.fn()
    const user = userEvent.setup()
    render(
      <EditTransactionModal
        onClose={onClose}
        transaction={baseExpense}
        transactionType="expense"
        onTransactionUpdated={onTransactionUpdated}
      />,
    )
    const desc = screen.getByLabelText(/description/i) as HTMLInputElement
    await user.clear(desc)
    await user.type(desc, 'Nouvelle desc')
    await user.click(screen.getByRole('button', { name: /modifier la dépense/i }))
    await waitFor(() => {
      expect(updateExpense).toHaveBeenCalledWith(
        expect.objectContaining({ id: TRANSACTION_UUID, description: 'Nouvelle desc' }),
      )
    })
    expect(onTransactionUpdated).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
