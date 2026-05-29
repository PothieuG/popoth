import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'

// Sprint Exceptional-Expense-Piggy-Funding — focused RTL file (separate from
// AddTransactionModal.test.tsx so the piggy fixture doesn't disturb the stable
// fixtures there). useFinancialData returns a non-zero piggyBank so the
// "Utiliser ma tirelire" section is eligible to render.

const addExpense = vi.fn(async () => true)
const addIncome = vi.fn(async () => true)

const BUDGET_UUID = '11111111-1111-4111-8111-111111111111'

vi.mock('@/hooks/useBudgets', () => ({
  useBudgets: () => ({
    budgets: [
      { id: BUDGET_UUID, name: 'Alimentation', estimated_amount: 500, cumulated_savings: 50 },
    ],
  }),
}))
vi.mock('@/hooks/useIncomes', () => ({
  useIncomes: () => ({ incomes: [] }),
}))
vi.mock('@/hooks/useRealExpenses', () => ({
  useRealExpenses: () => ({ addExpense, expenses: [] }),
}))
vi.mock('@/hooks/useRealIncomes', () => ({
  useRealIncomes: () => ({ addIncome, incomes: [] }),
}))
vi.mock('@/hooks/useProgressData', () => ({
  useProgressData: () => ({ expenseProgress: {} }),
}))
// Piggy balance = 200 → section eligible for exceptional expenses.
vi.mock('@/hooks/useFinancialData', () => ({
  useFinancialData: () => ({ financialData: { remainingToLive: 1000, piggyBank: 200 } }),
}))
vi.mock('@/components/dashboard/RemainingToLivePreview', () => ({ default: () => null }))
vi.mock('@/components/dashboard/ExpenseBreakdownPreview', () => ({ default: () => null }))
vi.mock('@/components/ui/CustomDropdown', () => ({
  default: ({
    options,
    value,
    onChange,
  }: {
    options: Array<{ id: string; name: string }>
    value: string
    onChange: (v: string) => void
  }) => (
    <select data-testid="fk-dropdown" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— select —</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import AddTransactionModal from '../AddTransactionModal'

async function gotoExpenseKind(user: UserEvent, opts: { exceptional?: boolean } = {}) {
  await user.click(screen.getByRole('button', { name: /Dépense/i }))
  await user.click(
    screen.getByRole('button', { name: opts.exceptional ? /Exceptionnelle/i : /Budgétée/i }),
  )
}

describe('AddTransactionModal — piggy funding (Sprint Exceptional-Expense-Piggy-Funding)', () => {
  beforeEach(() => {
    addExpense.mockClear()
    addExpense.mockResolvedValue(true)
  })

  it('shows the "Utiliser ma tirelire" toggle for an exceptional expense (piggy > 0)', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await gotoExpenseKind(user, { exceptional: true })
    expect(screen.getByRole('switch', { name: /utiliser ma tirelire/i })).toBeInTheDocument()
    expect(screen.getByText(/Disponible/i)).toBeInTheDocument()
  })

  it('does NOT show the piggy toggle for a budgeted expense', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await gotoExpenseKind(user)
    expect(screen.queryByRole('switch', { name: /utiliser ma tirelire/i })).toBeNull()
  })

  it('the piggy amount input is hidden until the toggle is on', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await gotoExpenseKind(user, { exceptional: true })
    expect(screen.queryByLabelText(/montant pris dans la tirelire/i)).toBeNull()
    await user.click(screen.getByRole('switch', { name: /utiliser ma tirelire/i }))
    expect(screen.getByLabelText(/montant pris dans la tirelire/i)).toBeInTheDocument()
  })

  it('submits amount_from_piggy_bank with the chosen piggy amount', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await gotoExpenseKind(user, { exceptional: true })

    // Amount first (only "Montant (€)" is present before toggling piggy).
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '300')
    await user.type(screen.getByLabelText(/description/i), 'Achat exceptionnel')

    // Toggle piggy on → input appears (prefilled to min(piggy, amount) = 200).
    await user.click(screen.getByRole('switch', { name: /utiliser ma tirelire/i }))
    const piggyInput = screen.getByLabelText(/montant pris dans la tirelire/i)
    await user.clear(piggyInput)
    await user.type(piggyInput, '120')

    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/i }))
    await waitFor(() => {
      expect(addExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Achat exceptionnel',
          amount: 300,
          estimated_budget_id: undefined,
          amount_from_piggy_bank: 120,
        }),
      )
    })
  })

  it('sends amount_from_piggy_bank: 0 when the toggle stays off', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await gotoExpenseKind(user, { exceptional: true })
    await user.type(screen.getByLabelText(/montant/i), '90')
    await user.type(screen.getByLabelText(/description/i), 'Sans tirelire')
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/i }))
    await waitFor(() => {
      expect(addExpense).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 90, amount_from_piggy_bank: 0 }),
      )
    })
  })
})
