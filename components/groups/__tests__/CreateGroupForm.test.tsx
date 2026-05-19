import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CreateGroupForm from '../CreateGroupForm'

describe('CreateGroupForm', () => {
  it('shows inline error when name is empty (min 2 chars)', async () => {
    const onSubmit = vi.fn(async () => true)
    const user = userEvent.setup()
    render(<CreateGroupForm onSubmit={onSubmit} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /créer le groupe/i }))
    expect(
      await screen.findByText(/Le nom du groupe doit contenir au moins 2 caractères/i),
    ).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onSubmit with the trimmed name on happy submit', async () => {
    const onSubmit = vi.fn(async () => true)
    const user = userEvent.setup()
    render(<CreateGroupForm onSubmit={onSubmit} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText(/nom du groupe/i), 'Famille Test')
    await user.click(screen.getByRole('button', { name: /créer le groupe/i }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Famille Test')
    })
  })

  it('renders serverError when onSubmit throws (Pattern F)', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('Conflit de nom')
    })
    const user = userEvent.setup()
    render(<CreateGroupForm onSubmit={onSubmit} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText(/nom du groupe/i), 'Famille Test')
    await user.click(screen.getByRole('button', { name: /créer le groupe/i }))
    await waitFor(() => {
      expect(screen.getByText('Conflit de nom')).toBeInTheDocument()
    })
  })
})
