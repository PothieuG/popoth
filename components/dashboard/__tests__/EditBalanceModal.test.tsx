import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import EditBalanceModal from '../EditBalanceModal'

describe('EditBalanceModal', () => {
  it('accepts a negative balance (allowNegative=true)', async () => {
    const onSubmit = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(
      <EditBalanceModal
        isOpen={true}
        currentBalance={100}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    )
    const balance = screen.getByLabelText(/Nouveau solde disponible/i) as HTMLInputElement
    await user.clear(balance)
    await user.type(balance, '-50')
    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(-50)
    })
  })

  it('calls onSubmit with positive coerced value on happy submit', async () => {
    const onSubmit = vi.fn(async () => undefined)
    const user = userEvent.setup()
    render(
      <EditBalanceModal isOpen={true} currentBalance={0} onSubmit={onSubmit} onCancel={vi.fn()} />,
    )
    const balance = screen.getByLabelText(/Nouveau solde disponible/i) as HTMLInputElement
    await user.clear(balance)
    await user.type(balance, '1234.56')
    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(1234.56)
    })
  })

  it('shows serverError when onSubmit throws', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('Network down')
    })
    const user = userEvent.setup()
    render(
      <EditBalanceModal isOpen={true} currentBalance={0} onSubmit={onSubmit} onCancel={vi.fn()} />,
    )
    const balance = screen.getByLabelText(/Nouveau solde disponible/i) as HTMLInputElement
    await user.clear(balance)
    await user.type(balance, '100')
    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    await waitFor(() => {
      expect(screen.getByText(/Erreur lors de la mise à jour du solde/i)).toBeInTheDocument()
    })
  })
})
