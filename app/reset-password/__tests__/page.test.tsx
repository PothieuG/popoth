import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

type SessionResp = { data: { session: unknown }; error: null | { message: string } }
type UpdateResp = { error: null | { message: string } }

const getSession = vi.fn(
  async (): Promise<SessionResp> => ({
    data: { session: { user: { id: 'u1' } } },
    error: null,
  }),
)
const updateUser = vi.fn(async (_args: unknown): Promise<UpdateResp> => ({ error: null }))

vi.mock('@/lib/supabase-client', () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
      updateUser: (args: unknown) => updateUser(args),
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import NouveauMotDePassePage from '../page'

describe('reset-password page', () => {
  beforeEach(() => {
    getSession.mockReset()
    updateUser.mockReset()
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    updateUser.mockResolvedValue({ error: null })
  })

  it('renders invalid-token state when getSession returns no session', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null })
    render(<NouveauMotDePassePage />)
    await waitFor(() => {
      expect(screen.getByText('Lien invalide')).toBeInTheDocument()
    })
    expect(screen.getByText(/invalide ou expiré/)).toBeInTheDocument()
  })

  it('renders the form when getSession returns a valid session', async () => {
    render(<NouveauMotDePassePage />)
    await waitFor(() => {
      expect(screen.getByLabelText(/nouveau mot de passe/i)).toBeInTheDocument()
    })
    expect(screen.getByLabelText(/confirmer le mot de passe/i)).toBeInTheDocument()
  })

  it('shows inline error when password is shorter than 6 chars', async () => {
    const user = userEvent.setup()
    render(<NouveauMotDePassePage />)
    await waitFor(() => screen.getByLabelText(/nouveau mot de passe/i))
    await user.type(screen.getByLabelText(/nouveau mot de passe/i), '123')
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), '123')
    await user.click(screen.getByRole('button', { name: /mettre à jour/i }))
    // Match the field error message specifically — the helper bullet list also
    // contains "Au moins 6 caractères" which would create ambiguity.
    expect(await screen.findByText(/Le mot de passe doit contenir au moins 6/i)).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('shows inline error when passwords do not match', async () => {
    const user = userEvent.setup()
    render(<NouveauMotDePassePage />)
    await waitFor(() => screen.getByLabelText(/nouveau mot de passe/i))
    await user.type(screen.getByLabelText(/nouveau mot de passe/i), 'goodpass')
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'different')
    await user.click(screen.getByRole('button', { name: /mettre à jour/i }))
    expect(await screen.findByText(/ne correspondent pas/i)).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('renders success state after happy updateUser', async () => {
    const user = userEvent.setup()
    render(<NouveauMotDePassePage />)
    await waitFor(() => screen.getByLabelText(/nouveau mot de passe/i))
    await user.type(screen.getByLabelText(/nouveau mot de passe/i), 'goodpass1')
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'goodpass1')
    await user.click(screen.getByRole('button', { name: /mettre à jour/i }))
    await waitFor(() => {
      expect(screen.getByText('Mot de passe mis à jour !')).toBeInTheDocument()
    })
    expect(updateUser).toHaveBeenCalledWith({ password: 'goodpass1' })
  })

  it('maps session_not_found error to specific serverError', async () => {
    updateUser.mockResolvedValueOnce({ error: { message: 'session_not_found at xyz' } })
    const user = userEvent.setup()
    render(<NouveauMotDePassePage />)
    await waitFor(() => screen.getByLabelText(/nouveau mot de passe/i))
    await user.type(screen.getByLabelText(/nouveau mot de passe/i), 'goodpass1')
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'goodpass1')
    await user.click(screen.getByRole('button', { name: /mettre à jour/i }))
    await waitFor(() => {
      expect(screen.getByText(/Session expirée/)).toBeInTheDocument()
    })
  })

  it('maps "different from old password" error to specific serverError', async () => {
    updateUser.mockResolvedValueOnce({
      error: { message: 'New password should be different from the old password' },
    })
    const user = userEvent.setup()
    render(<NouveauMotDePassePage />)
    await waitFor(() => screen.getByLabelText(/nouveau mot de passe/i))
    await user.type(screen.getByLabelText(/nouveau mot de passe/i), 'goodpass1')
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'goodpass1')
    await user.click(screen.getByRole('button', { name: /mettre à jour/i }))
    await waitFor(() => {
      expect(screen.getByText(/différent de l'ancien/)).toBeInTheDocument()
    })
  })
})
