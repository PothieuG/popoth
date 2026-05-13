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

  it('shows balance refine error when newTotal exceeds totalEstimatedIncome', async () => {
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
    // 1800 + 500 = 2300 > 2000 — refine fails
    await user.type(screen.getByPlaceholderText('0.00'), '500')
    await user.click(screen.getByRole('button', { name: /ajouter le budget/i }))
    expect(
      await screen.findByText(
        /Impossible : le reste à vivre \(sans économies\) deviendrait négatif/i,
      ),
    ).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
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

  it('rebuilds schema when currentBudgetsTotal prop changes (Pattern D)', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <AddBudgetDialog
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        currentBudgetsTotal={500}
        totalEstimatedIncome={2000}
      />,
    )
    // First : 500 + 300 = 800 (well under 2000) — would pass refine
    await user.type(screen.getByPlaceholderText(/alimentation/i), 'Loisirs')
    await user.type(screen.getByPlaceholderText('0.00'), '300')
    // Now bump props : 1900 + 300 = 2200 > 2000 — refine fails
    rerender(
      <AddBudgetDialog
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        currentBudgetsTotal={1900}
        totalEstimatedIncome={2000}
      />,
    )
    await user.click(screen.getByRole('button', { name: /ajouter le budget/i }))
    await waitFor(() => {
      expect(onSave).not.toHaveBeenCalled()
    })
  })
})
