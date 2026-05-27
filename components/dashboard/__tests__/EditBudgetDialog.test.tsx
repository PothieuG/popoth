import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditBudgetDialog from '../EditBudgetDialog'

const baseBudget = {
  id: 'budget-1',
  name: 'Alimentation',
  estimated_amount: 500,
}

describe('EditBudgetDialog', () => {
  it('renders nothing when budget prop is null', () => {
    const { container } = render(
      <EditBudgetDialog
        onClose={vi.fn()}
        onSave={vi.fn(async () => true)}
        budget={null}
        currentBudgetsTotal={500}
        totalEstimatedIncome={2000}
      />,
    )
    expect(container.querySelector('input[name="name"]')).toBeNull()
  })

  it('preserves edit delta : raising the same budget within income is OK', async () => {
    const onSave = vi.fn(async () => true)
    const user = userEvent.setup()
    render(
      <EditBudgetDialog
        onClose={vi.fn()}
        onSave={onSave}
        budget={baseBudget}
        currentBudgetsTotal={1000}
        totalEstimatedIncome={2000}
      />,
    )
    // otherBudgets = 1000 - 500 = 500. New amount = 800. Total = 1300 < 2000 → OK.
    const amount = screen.getByLabelText(/montant mensuel/i)
    await user.clear(amount)
    await user.type(amount, '800')
    await user.click(screen.getByRole('button', { name: /sauvegarder/i }))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ name: 'Alimentation', estimatedAmount: 800 })
    })
  })

  it('allows edit even when new amount pushes total over income (RAV may go negative)', async () => {
    const onSave = vi.fn(async () => true)
    const user = userEvent.setup()
    render(
      <EditBudgetDialog
        onClose={vi.fn()}
        onSave={onSave}
        budget={baseBudget}
        currentBudgetsTotal={1500}
        totalEstimatedIncome={2000}
      />,
    )
    // otherBudgets = 1500 - 500 = 1000. New amount = 1500. Total = 2500 > 2000 →
    // allowed since 2026-05-27 (RAV negative permitted).
    const amount = screen.getByLabelText(/montant mensuel/i)
    await user.clear(amount)
    await user.type(amount, '1500')
    await user.click(screen.getByRole('button', { name: /sauvegarder/i }))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ name: 'Alimentation', estimatedAmount: 1500 })
    })
  })

  it('calls onSave and onClose on successful happy submit', async () => {
    const onSave = vi.fn(async () => true)
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <EditBudgetDialog
        onClose={onClose}
        onSave={onSave}
        budget={baseBudget}
        currentBudgetsTotal={1000}
        totalEstimatedIncome={3000}
      />,
    )
    const nameInput = screen.getByLabelText(/nom du budget/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Courses')
    await user.click(screen.getByRole('button', { name: /sauvegarder/i }))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ name: 'Courses', estimatedAmount: 500 })
    })
    expect(onClose).toHaveBeenCalled()
  })
})
