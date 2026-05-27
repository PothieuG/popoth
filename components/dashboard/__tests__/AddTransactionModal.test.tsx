import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'

// 5 hooks mocked — AddTransactionModal has the broadest data surface of any
// client form. Fixtures kept stable across tests.

const addExpense = vi.fn(async () => true)
const addIncome = vi.fn(async () => true)

const BUDGET_UUID = '11111111-1111-4111-8111-111111111111'
const INCOME_UUID = '22222222-2222-4222-8222-222222222222'

vi.mock('@/hooks/useBudgets', () => ({
  useBudgets: () => ({
    budgets: [
      { id: BUDGET_UUID, name: 'Alimentation', estimated_amount: 500, cumulated_savings: 50 },
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

/**
 * Wizard navigation helpers (Sprint P4-P5-P6 / Phase B3).
 * Each test that needs to reach the form fields navigates the wizard first.
 */
// The wizard cards have multi-line content (title + description), so the
// accessible name is the full concatenation. We match partially.
async function navigateToFieldsExpense(user: UserEvent, opts: { exceptional?: boolean } = {}) {
  // Step 1: select-type → click Dépense card
  await user.click(screen.getByRole('button', { name: /Dépense/i }))
  // Step 2: select-kind → click Budgétée OR Exceptionnelle
  if (opts.exceptional) {
    await user.click(screen.getByRole('button', { name: /Exceptionnelle/i }))
  } else {
    await user.click(screen.getByRole('button', { name: /Budgétée/i }))
  }
}

async function navigateToFieldsIncome(user: UserEvent, opts: { exceptional?: boolean } = {}) {
  // Step 1: select-type → click Revenu card
  await user.click(screen.getByRole('button', { name: /Revenu/i }))
  // Step 2: select-kind → click Régulier OR Exceptionnel
  if (opts.exceptional) {
    await user.click(screen.getByRole('button', { name: /Exceptionnel/i }))
  } else {
    await user.click(screen.getByRole('button', { name: /Régulier/i }))
  }
}

describe('AddTransactionModal — wizard navigation (Sprint P4-P5-P6 / B1)', () => {
  beforeEach(() => {
    addExpense.mockClear()
    addIncome.mockClear()
    addExpense.mockResolvedValue(true)
    addIncome.mockResolvedValue(true)
  })

  it('Step 1 renders type selection cards', () => {
    render(<AddTransactionModal onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Dépense/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Revenu/i })).toBeInTheDocument()
    // Fields not visible yet
    expect(screen.queryByLabelText(/description/i)).not.toBeInTheDocument()
  })

  it('Dépense → Step 2 renders Budgétée / Exceptionnelle cards', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Dépense/i }))
    expect(screen.getByRole('button', { name: /Budgétée/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Exceptionnelle/i })).toBeInTheDocument()
    // Fields still not visible yet
    expect(screen.queryByLabelText(/description/i)).not.toBeInTheDocument()
  })

  it('Revenu → Step 2 renders Régulier / Exceptionnel cards', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Revenu/i }))
    expect(screen.getByRole('button', { name: /Régulier/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Exceptionnel/i })).toBeInTheDocument()
    // The expense kind cards must NOT appear in the income flow
    expect(screen.queryByRole('button', { name: /Budgétée/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Exceptionnelle/i })).not.toBeInTheDocument()
    // Fields not yet rendered — we're still at the kind step
    expect(screen.queryByLabelText(/description/i)).not.toBeInTheDocument()
  })

  it('Revenu Régulier → lands on fields with FK dropdown', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsIncome(user)
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
    expect(screen.getByTestId('fk-dropdown')).toBeInTheDocument()
  })

  it('Revenu Exceptionnel → lands on fields WITHOUT FK dropdown', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsIncome(user, { exceptional: true })
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
    expect(screen.queryByTestId('fk-dropdown')).toBeNull()
  })

  it('back button preserves description + amount across step transitions', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user)
    // Fill description + amount
    await user.type(screen.getByLabelText(/description/i), 'Achat')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '50')
    // Go back to Step 2 (back button is icon-only with aria-label)
    await user.click(screen.getByRole('button', { name: /retour à l'étape précédente/i }))
    expect(screen.getByRole('button', { name: /Budgétée/i })).toBeInTheDocument()
    // Forward again → description + amount preserved
    await user.click(screen.getByRole('button', { name: /Budgétée/i }))
    expect((screen.getByLabelText(/description/i) as HTMLInputElement).value).toBe('Achat')
    expect((screen.getByLabelText(/montant/i) as HTMLInputElement).value).toBe('50')
  })

  it('Exceptionnelle path hides the FK dropdown', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user, { exceptional: true })
    // No FK dropdown for exceptional expense
    expect(screen.queryByTestId('fk-dropdown')).toBeNull()
  })

  it('Budgétée path shows the FK dropdown', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user)
    expect(screen.getByTestId('fk-dropdown')).toBeInTheDocument()
  })
})

describe('AddTransactionModal — use_savings auto-enabled (Sprint 2026-05-21 / Auto-Use-Savings)', () => {
  beforeEach(() => {
    addExpense.mockClear()
    addExpense.mockResolvedValue(true)
  })

  it('no longer renders a "Utiliser les économies" toggle UI', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user)
    await user.selectOptions(screen.getByTestId('fk-dropdown'), BUDGET_UUID)
    // Toggle UI was removed Sprint Auto-Use-Savings — savings used by default.
    expect(screen.queryByLabelText(/utiliser les économies/i)).not.toBeInTheDocument()
  })

  it('passes use_savings: true to addExpense on budgeted expense submit', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user)
    await user.selectOptions(screen.getByTestId('fk-dropdown'), BUDGET_UUID)
    await user.type(screen.getByLabelText(/description/i), 'Courses')
    await user.clear(screen.getByLabelText(/montant/i))
    await user.type(screen.getByLabelText(/montant/i), '40')
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/i }))
    await waitFor(() => {
      expect(addExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Courses',
          amount: 40,
          estimated_budget_id: BUDGET_UUID,
          use_savings: true,
        }),
      )
    })
  })
})

describe('AddTransactionModal — submit flows', () => {
  beforeEach(() => {
    addExpense.mockClear()
    addIncome.mockClear()
    addExpense.mockResolvedValue(true)
    addIncome.mockResolvedValue(true)
  })

  it('calls addExpense with correct data on happy budgétée submit', async () => {
    const onClose = vi.fn()
    const onTransactionAdded = vi.fn()
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={onClose} onTransactionAdded={onTransactionAdded} />)
    await navigateToFieldsExpense(user)
    await user.selectOptions(screen.getByTestId('fk-dropdown'), BUDGET_UUID)
    await user.type(screen.getByLabelText(/description/i), 'Courses')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '100')
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/i }))
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

  it('allows submit even when expense exceeds remaining-to-live (RAV may go negative)', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user, { exceptional: true })
    await user.type(screen.getByLabelText(/description/i), 'Achat hors budget')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '2000')
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/i }))
    await waitFor(() => {
      expect(addExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Achat hors budget',
          amount: 2000,
        }),
      )
    })
  })

  it('calls addIncome on happy income submit', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsIncome(user)
    await user.selectOptions(screen.getByTestId('fk-dropdown'), INCOME_UUID)
    await user.type(screen.getByLabelText(/description/i), 'Paie')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '1500')
    await user.click(screen.getByRole('button', { name: /^Ajouter le revenu$/i }))
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

  it('exceptional income submit → addIncome called with estimated_income_id undefined', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsIncome(user, { exceptional: true })
    await user.type(screen.getByLabelText(/description/i), 'Cadeau anniversaire')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '150')
    await user.click(screen.getByRole('button', { name: /^Ajouter le revenu$/i }))
    await waitFor(() => {
      expect(addIncome).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Cadeau anniversaire',
          amount: 150,
          estimated_income_id: undefined,
        }),
      )
    })
  })

  // Sprint Zod-Rollout v6 / Axe 3 — regression-guards for Axe 1 (a11y
  // attribute linkage) + Axe 2 (setFocus on invalid submit). Updated for
  // wizard (Sprint P4-P5-P6 / B3) — navigation to fields first.
  it('aria-describedby + aria-invalid + setFocus on invalid description (Axe 1 + 2)', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user)
    // Submit empty form — description (min 1) is the first failing field
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/i }))
    const descInput = screen.getByLabelText(/description/i)
    await waitFor(() => {
      expect(descInput).toHaveAttribute('aria-invalid', 'true')
      expect(descInput).toHaveAttribute('aria-describedby', 'add-transaction-description-error')
    })
    const errorBox = document.getElementById('add-transaction-description-error')
    expect(errorBox).toBeTruthy()
    // Axe 2 setFocus assertion : focus moved to the first faulty field
    expect(descInput).toHaveFocus()
    expect(addExpense).not.toHaveBeenCalled()
  })
})
