import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CreateGroupForm from '../CreateGroupForm'

describe('CreateGroupForm', () => {
  it('shows inline error when name is empty (min 2 chars)', async () => {
    const onSubmit = vi.fn(async () => true)
    const user = userEvent.setup()
    render(<CreateGroupForm onSubmit={onSubmit} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText(/budget mensuel/i), '1000')
    await user.click(screen.getByRole('button', { name: /créer le groupe/i }))
    expect(
      await screen.findByText(/Le nom du groupe doit contenir au moins 2 caractères/i),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows inline error when budget is 0 (moneyFormSchema positive)', async () => {
    const onSubmit = vi.fn(async () => true)
    const user = userEvent.setup()
    render(<CreateGroupForm onSubmit={onSubmit} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText(/nom du groupe/i), 'Famille Test')
    // monthly_budget_estimate already defaults to 0 — submit triggers refine
    await user.click(screen.getByRole('button', { name: /créer le groupe/i }))
    // moneyFormSchema is z.coerce.number().positive() — error message specific to schema
    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled()
    })
    // The button submit didn't fire onSubmit (validation blocked); inline error shown under budget
    const budgetError = screen.queryByText(/positif|montant.*invalide|requis|minimum/i)
    expect(budgetError).not.toBeNull()
  })

  it('calls onSubmit with valid name + budget on happy submit', async () => {
    const onSubmit = vi.fn(async () => true)
    const user = userEvent.setup()
    render(<CreateGroupForm onSubmit={onSubmit} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText(/nom du groupe/i), 'Famille Test')
    await user.type(screen.getByLabelText(/budget mensuel/i), '2500')
    await user.click(screen.getByRole('button', { name: /créer le groupe/i }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Famille Test', 2500)
    })
  })

  it('renders serverError when onSubmit throws (Pattern F)', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('Conflit de nom')
    })
    const user = userEvent.setup()
    render(<CreateGroupForm onSubmit={onSubmit} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText(/nom du groupe/i), 'Famille Test')
    await user.type(screen.getByLabelText(/budget mensuel/i), '2500')
    await user.click(screen.getByRole('button', { name: /créer le groupe/i }))
    await waitFor(() => {
      expect(screen.getByText('Conflit de nom')).toBeInTheDocument()
    })
  })
})
