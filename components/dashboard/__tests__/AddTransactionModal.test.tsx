import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// 6 hooks mocked — AddTransactionModal has the broadest data surface of any
// client form. Fixtures kept stable across tests; ravValidation state is
// mutable via the module-level object to toggle blocked between cases.

const addExpense = vi.fn(async () => true)
const addIncome = vi.fn(async () => true)
const ravState: { blocked: boolean; newRav: number } = { blocked: false, newRav: 0 }

const BUDGET_UUID = '11111111-1111-4111-8111-111111111111'
const INCOME_UUID = '22222222-2222-4222-8222-222222222222'

vi.mock('@/hooks/useBudgets', () => ({
  useBudgets: () => ({
    budgets: [
      { id: BUDGET_UUID, name: 'Alimentation', estimated_amount: 500, cumulated_savings: 0 },
    ],
  }),
}))
vi.mock('@/hooks/useIncomes', () => ({
  useIncomes: () => ({
    incomes: [{ id: INCOME_UUID, name: 'Salaire', estimated_amount: 1500 }],
  }),
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
vi.mock('@/hooks/useFinancialData', () => ({
  useFinancialData: () => ({ financialData: { remainingToLive: 1000 } }),
}))
vi.mock('@/hooks/useRavValidation', () => ({
  useRavValidation: () => ravState,
}))
vi.mock('@/components/dashboard/RemainingToLivePreview', () => ({
  default: () => null,
}))
vi.mock('@/components/dashboard/ExpenseBreakdownPreview', () => ({
  default: () => null,
}))
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

describe('AddTransactionModal', () => {
  beforeEach(() => {
    addExpense.mockClear()
    addIncome.mockClear()
    addExpense.mockResolvedValue(true)
    addIncome.mockResolvedValue(true)
    ravState.blocked = false
    ravState.newRav = 0
  })

  it('switches expense → income preserving description and amount', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    // Type description + amount in expense branch
    await user.type(screen.getByLabelText(/description/i), 'Achat')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '50')
    // Switch to income
    await user.click(screen.getByRole('button', { name: /^Revenu$/ }))
    // Description preserved, amount preserved
    expect((screen.getByLabelText(/description/i) as HTMLInputElement).value).toBe('Achat')
    expect((screen.getByLabelText(/montant/i) as HTMLInputElement).value).toBe('50')
  })

  it('exceptional toggle hides the FK dropdown', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    // Initially FK dropdown is shown (not exceptional)
    expect(screen.getByTestId('fk-dropdown')).toBeInTheDocument()
    // Check exceptional
    await user.click(screen.getByLabelText(/dépense exceptionnelle/i))
    // FK dropdown is hidden
    expect(screen.queryByTestId('fk-dropdown')).toBeNull()
  })

  it('calls addExpense with correct data on happy expense submit', async () => {
    const onClose = vi.fn()
    const onTransactionAdded = vi.fn()
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={onClose} onTransactionAdded={onTransactionAdded} />)
    // Select budget
    await user.selectOptions(screen.getByTestId('fk-dropdown'), BUDGET_UUID)
    await user.type(screen.getByLabelText(/description/i), 'Courses')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '100')
    await user.click(screen.getByRole('button', { name: /^Ajouter (la dépense|le revenu)$/i }))
    await waitFor(() => {
      expect(addExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Courses',
          amount: 100,
          estimated_budget_id: BUDGET_UUID,
        }),
      )
    })
    expect(onTransactionAdded).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('blocks submit when useRavValidation reports blocked=true (Pattern E)', async () => {
    ravState.blocked = true
    ravState.newRav = -200
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await user.selectOptions(screen.getByTestId('fk-dropdown'), BUDGET_UUID)
    await user.type(screen.getByLabelText(/description/i), 'Trop cher')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '2000')
    await user.click(screen.getByRole('button', { name: /^Ajouter (la dépense|le revenu)$/i }))
    // serverError surfaces, addExpense NOT called
    expect(await screen.findByText(/votre reste à vivre.*négatif/i)).toBeInTheDocument()
    expect(addExpense).not.toHaveBeenCalled()
  })

  it('calls addIncome when transactionType is income on happy submit', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    // Switch to income
    await user.click(screen.getByRole('button', { name: /^Revenu$/ }))
    await user.selectOptions(screen.getByTestId('fk-dropdown'), INCOME_UUID)
    await user.type(screen.getByLabelText(/description/i), 'Paie')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '1500')
    await user.click(screen.getByRole('button', { name: /^Ajouter (la dépense|le revenu)$/i }))
    await waitFor(() => {
      expect(addIncome).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Paie',
          amount: 1500,
          estimated_income_id: INCOME_UUID,
        }),
      )
    })
  })
})
