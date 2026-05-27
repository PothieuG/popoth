import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddBudgetDialog from '../AddBudgetDialog'

// Same a11y gap as AddIncomeDialog — labels not linked via htmlFor.
// Tests use getByPlaceholderText. Tracked for Axe 5.

describe('AddBudgetDialog', () => {
  it('shows inline error when name is empty (min 2 chars)', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <AddBudgetDialog
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        currentBudgetsTotal={500}
        totalEstimatedIncome={2000}
      />,
    )
    await user.type(screen.getByPlaceholderText('0.00'), '300')
    await user.click(screen.getByRole('button', { name: /ajouter le budget/i }))
    expect(
      await screen.findByText(/Le nom du budget est requis \(minimum 2 caractères\)/i),
    ).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('allows submit even when newTotal exceeds totalEstimatedIncome (RAV may go negative)', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <AddBudgetDialog
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        currentBudgetsTotal={1800}
        totalEstimatedIncome={2000}
      />,
    )
    await user.type(screen.getByPlaceholderText(/alimentation/i), 'Voyages')
    // 1800 + 500 = 2300 > 2000 — would push RAV negative, but allowed since 2026-05-27
    await user.type(screen.getByPlaceholderText('0.00'), '500')
    await user.click(screen.getByRole('button', { name: /ajouter le budget/i }))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ name: 'Voyages', estimatedAmount: 500 })
    })
  })

  it('calls onSave with valid name + amount on happy submit', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <AddBudgetDialog
        isOpen={true}
        onClose={onClose}
        onSave={onSave}
        currentBudgetsTotal={500}
        totalEstimatedIncome={2000}
      />,
    )
    await user.type(screen.getByPlaceholderText(/alimentation/i), 'Loisirs')
    await user.type(screen.getByPlaceholderText('0.00'), '300')
    await user.click(screen.getByRole('button', { name: /ajouter le budget/i }))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ name: 'Loisirs', estimatedAmount: 300 })
    })
    expect(onClose).toHaveBeenCalled()
  })

  // Sprint Zod-Rollout v6 / Axe 3 — regression-guards for Axe 1 (a11y
  // attribute linkage) + Axe 2 (setFocus on invalid submit).
  it('aria-describedby + aria-invalid + setFocus on invalid empty name (Axe 1 + 2)', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <AddBudgetDialog
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        currentBudgetsTotal={500}
        totalEstimatedIncome={2000}
      />,
    )
    // Submit with empty name (amount = 300 to bypass the amount field error)
    await user.type(screen.getByPlaceholderText('0.00'), '300')
    await user.click(screen.getByRole('button', { name: /ajouter le budget/i }))
    // Wait for validation
    await waitFor(() => {
      expect(
        screen.getByText(/Le nom du budget est requis \(minimum 2 caractères\)/i),
      ).toBeInTheDocument()
    })
    const nameInput = screen.getByLabelText(/nom du budget/i)
    expect(nameInput).toHaveAttribute('aria-describedby', 'add-budget-name-error')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    const errorBox = document.getElementById('add-budget-name-error')
    expect(errorBox).toHaveTextContent(/Le nom du budget est requis/)
    // Axe 2 setFocus assertion : focus moved to first faulty field
    expect(nameInput).toHaveFocus()
  })
})
