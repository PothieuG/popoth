import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FirstTimeProfileDialog from '../FirstTimeProfileDialog'

describe('FirstTimeProfileDialog', () => {
  it('shows inline error when first_name is empty', async () => {
    const onSubmit = vi.fn(async () => true)
    const user = userEvent.setup()
    render(<FirstTimeProfileDialog isOpen={true} onSubmit={onSubmit} />)
    await user.type(screen.getByLabelText('Nom *'), 'Dupont')
    await user.click(screen.getByRole('button', { name: /terminer la configuration/i }))
    expect((await screen.findAllByText(/Au moins 2 caractères/i)).length).toBeGreaterThan(0)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows inline error when first_name is shorter than 2 chars', async () => {
    const onSubmit = vi.fn(async () => true)
    const user = userEvent.setup()
    render(<FirstTimeProfileDialog isOpen={true} onSubmit={onSubmit} />)
    await user.type(screen.getByLabelText('Prénom *'), 'A')
    await user.type(screen.getByLabelText('Nom *'), 'Dupont')
    await user.click(screen.getByRole('button', { name: /terminer la configuration/i }))
    expect(await screen.findByText(/Au moins 2 caractères/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onSubmit with valid first + last name', async () => {
    const onSubmit = vi.fn(async () => true)
    const user = userEvent.setup()
    render(<FirstTimeProfileDialog isOpen={true} onSubmit={onSubmit} />)
    await user.type(screen.getByLabelText('Prénom *'), 'Jean')
    await user.type(screen.getByLabelText('Nom *'), 'Dupont')
    await user.click(screen.getByRole('button', { name: /terminer la configuration/i }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Jean', 'Dupont')
    })
  })
})
