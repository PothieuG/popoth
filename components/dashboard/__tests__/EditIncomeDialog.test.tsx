import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditIncomeDialog from '../EditIncomeDialog'

const baseIncome = {
  id: 'inc-1',
  name: 'Salaire',
  estimated_amount: 1500,
}

describe('EditIncomeDialog', () => {
  it('renders nothing when income prop is null', () => {
    const { container } = render(
      <EditIncomeDialog
        onClose={vi.fn()}
        onSave={vi.fn(async () => true)}
        income={null}
        currentIncomesTotal={1000}
      />,
    )
    expect(container.querySelector('input[name="name"]')).toBeNull()
  })

  it('shows inline error when name is cleared below 2 chars', async () => {
    const onSave = vi.fn(async () => true)
    const user = userEvent.setup()
    render(
      <EditIncomeDialog
        onClose={vi.fn()}
        onSave={onSave}
        income={baseIncome}
        currentIncomesTotal={3000}
      />,
    )
    const nameInput = screen.getByLabelText(/nom du revenu/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'A')
    await user.click(screen.getByRole('button', { name: /sauvegarder/i }))
    expect(
      await screen.findByText(/Le nom du revenu est requis \(minimum 2 caractères\)/i),
    ).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onSave with updated values on happy submit', async () => {
    const onSave = vi.fn(async () => true)
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <EditIncomeDialog
        onClose={onClose}
        onSave={onSave}
        income={baseIncome}
        currentIncomesTotal={3000}
      />,
    )
    const nameInput = screen.getByLabelText(/nom du revenu/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Salaire Sept')
    await user.click(screen.getByRole('button', { name: /sauvegarder/i }))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ name: 'Salaire Sept', estimatedAmount: 1500 })
    })
    expect(onClose).toHaveBeenCalled()
  })

  // Sprint Zod-Rollout v6 / Axe 3 — regression-guards for Axe 1 (a11y
  // attribute linkage) + Axe 2 (setFocus on invalid submit).
  it('aria-describedby + aria-invalid + setFocus on invalid name (Axe 1 + 2)', async () => {
    const onSave = vi.fn(async () => true)
    const user = userEvent.setup()
    render(
      <EditIncomeDialog
        onClose={vi.fn()}
        onSave={onSave}
        income={baseIncome}
        currentIncomesTotal={3000}
      />,
    )
    const nameInput = screen.getByLabelText(/nom du revenu/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'A')
    await user.click(screen.getByRole('button', { name: /sauvegarder/i }))
    await waitFor(() => {
      expect(nameInput).toHaveAttribute('aria-describedby', 'edit-income-name-error')
      expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    })
    const errorBox = document.getElementById('edit-income-name-error')
    expect(errorBox).toHaveTextContent(/Le nom du revenu est requis/)
    // Axe 2 setFocus assertion : focus moved to first faulty field
    expect(nameInput).toHaveFocus()
  })
})
