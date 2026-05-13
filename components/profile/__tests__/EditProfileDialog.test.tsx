import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditProfileDialog from '../EditProfileDialog'
import type { ProfileData } from '@/app/api/profile/route'

const baseProfile: ProfileData = {
  id: 'profile-1',
  first_name: 'Jean',
  last_name: 'Dupont',
  salary: 1500,
  group_id: null,
  group_name: null,
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('EditProfileDialog', () => {
  it('preserves the form button disabled when no changes are made', () => {
    render(
      <EditProfileDialog
        isOpen={true}
        onClose={vi.fn()}
        profile={baseProfile}
        onSubmit={vi.fn(async () => true)}
      />,
    )
    expect(screen.getByRole('button', { name: /sauvegarder/i })).toBeDisabled()
  })

  it('shows inline error when first_name is cleared below 2 chars', async () => {
    const onSubmit = vi.fn(async () => true)
    const user = userEvent.setup()
    render(
      <EditProfileDialog
        isOpen={true}
        onClose={vi.fn()}
        profile={baseProfile}
        onSubmit={onSubmit}
      />,
    )
    const firstNameInput = screen.getByLabelText('Prénom *')
    await user.clear(firstNameInput)
    await user.type(firstNameInput, 'A')
    await user.click(screen.getByRole('button', { name: /sauvegarder/i }))
    expect(await screen.findByText(/Au moins 2 caractères/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onSubmit then onClose on happy submit', async () => {
    const onSubmit = vi.fn(async () => true)
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <EditProfileDialog
        isOpen={true}
        onClose={onClose}
        profile={baseProfile}
        onSubmit={onSubmit}
      />,
    )
    const firstNameInput = screen.getByLabelText('Prénom *')
    await user.clear(firstNameInput)
    await user.type(firstNameInput, 'Marie')
    await user.click(screen.getByRole('button', { name: /sauvegarder/i }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Marie', 'Dupont')
    })
    expect(onClose).toHaveBeenCalled()
  })
})
