import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddIncomeDialog from '../AddIncomeDialog'

// Labels in AddIncomeDialog are not linked to inputs via htmlFor (a11y gap
// tracked for Axe 5). Tests use placeholder-based queries instead.

describe('AddIncomeDialog', () => {
  it('shows inline error when name is empty (min 2 chars)', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <AddIncomeDialog
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        currentIncomesTotal={1000}
      />,
    )
    await user.type(screen.getByPlaceholderText('0.00'), '500')
    await user.click(screen.getByRole('button', { name: /ajouter le revenu/i }))
    expect(
      await screen.findByText(/Le nom du revenu est requis \(minimum 2 caractères\)/i),
    ).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not call onSave when estimatedAmount is 0 (positive refine)', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <AddIncomeDialog
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        currentIncomesTotal={1000}
      />,
    )
    await user.type(screen.getByPlaceholderText(/salaire, freelance/i), 'Salaire')
    // estimatedAmount stays at default 0 — moneyFormSchema rejects
    await user.click(screen.getByRole('button', { name: /ajouter le revenu/i }))
    await waitFor(() => {
      expect(onSave).not.toHaveBeenCalled()
    })
  })

  it('calls onSave with valid name + amount on happy submit', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <AddIncomeDialog
        isOpen={true}
        onClose={onClose}
        onSave={onSave}
        currentIncomesTotal={1000}
      />,
    )
    await user.type(screen.getByPlaceholderText(/salaire, freelance/i), 'Salaire')
    await user.type(screen.getByPlaceholderText('0.00'), '2500')
    await user.click(screen.getByRole('button', { name: /ajouter le revenu/i }))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ name: 'Salaire', estimatedAmount: 2500 })
    })
    expect(onClose).toHaveBeenCalled()
  })
})
