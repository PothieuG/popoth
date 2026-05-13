import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

type SignUpResp = {
  data: { user: { id: string } | null }
  error: null | { message: string }
}
const signUp = vi.fn(
  async (_args: unknown): Promise<SignUpResp> => ({
    data: { user: { id: 'u1' } },
    error: null,
  }),
)

vi.mock('@/lib/supabase-client', () => ({
  supabase: {
    auth: {
      signUp: (args: unknown) => signUp(args),
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import InscriptionPage from '../page'

describe('inscription page', () => {
  beforeEach(() => {
    signUp.mockReset()
    signUp.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  })

  it('shows inline error when passwords do not match', async () => {
    const user = userEvent.setup()
    render(<InscriptionPage />)
    await user.type(screen.getByLabelText(/adresse email/i), 'foo@bar.com')
    await user.type(screen.getByLabelText('Mot de passe'), 'goodpass1')
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'different1')
    await user.click(screen.getByRole('button', { name: /créer mon compte/i }))
    expect(await screen.findByText(/ne correspondent pas/i)).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('renders success state after happy signup', async () => {
    const user = userEvent.setup()
    render(<InscriptionPage />)
    await user.type(screen.getByLabelText(/adresse email/i), 'foo@bar.com')
    await user.type(screen.getByLabelText('Mot de passe'), 'goodpass1')
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'goodpass1')
    await user.click(screen.getByRole('button', { name: /créer mon compte/i }))
    await waitFor(() => {
      expect(screen.getByText('Compte créé !')).toBeInTheDocument()
    })
    expect(signUp).toHaveBeenCalledTimes(1)
  })

  it('maps already-registered error to specific serverError', async () => {
    signUp.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'User already registered' },
    })
    const user = userEvent.setup()
    render(<InscriptionPage />)
    await user.type(screen.getByLabelText(/adresse email/i), 'foo@bar.com')
    await user.type(screen.getByLabelText('Mot de passe'), 'goodpass1')
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'goodpass1')
    await user.click(screen.getByRole('button', { name: /créer mon compte/i }))
    await waitFor(() => {
      expect(screen.getByText(/déjà utilisée/)).toBeInTheDocument()
    })
  })

  it('maps weak-password error to specific serverError', async () => {
    signUp.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'weak password — too short' },
    })
    const user = userEvent.setup()
    render(<InscriptionPage />)
    await user.type(screen.getByLabelText(/adresse email/i), 'foo@bar.com')
    await user.type(screen.getByLabelText('Mot de passe'), 'goodpass1')
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'goodpass1')
    await user.click(screen.getByRole('button', { name: /créer mon compte/i }))
    await waitFor(() => {
      expect(screen.getByText(/trop faible/)).toBeInTheDocument()
    })
  })

  it('maps signup-disabled error to specific serverError', async () => {
    signUp.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Signup disabled for this project' },
    })
    const user = userEvent.setup()
    render(<InscriptionPage />)
    await user.type(screen.getByLabelText(/adresse email/i), 'foo@bar.com')
    await user.type(screen.getByLabelText('Mot de passe'), 'goodpass1')
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'goodpass1')
    await user.click(screen.getByRole('button', { name: /créer mon compte/i }))
    await waitFor(() => {
      expect(screen.getByText(/temporairement désactivées/)).toBeInTheDocument()
    })
  })
})
