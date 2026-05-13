import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Hoisted mocks
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

type ResetResp = { error: null | { message: string } }
const resetPasswordForEmail = vi.fn(
  async (_email: string, _opts: unknown): Promise<ResetResp> => ({ error: null }),
)
vi.mock('@/lib/supabase-client', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (email: string, opts: unknown) => resetPasswordForEmail(email, opts),
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import MotDePasseOubliePage from '../page'

describe('forgot-password page', () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset()
    resetPasswordForEmail.mockResolvedValue({ error: null })
  })

  it('shows inline error when email is empty + a11y aria-describedby linkage', async () => {
    const user = userEvent.setup()
    render(<MotDePasseOubliePage />)
    await user.click(screen.getByRole('button', { name: /envoyer le lien/i }))
    expect(await screen.findByText("Format d'email invalide")).toBeInTheDocument()
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
    // a11y (Axe 5): input is linked to its error message via aria-describedby
    const input = screen.getByLabelText(/adresse email/i)
    expect(input).toHaveAttribute('aria-describedby', 'email-error')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows inline error when email format is invalid', async () => {
    const user = userEvent.setup()
    render(<MotDePasseOubliePage />)
    await user.type(screen.getByLabelText(/adresse email/i), 'not-an-email')
    await user.click(screen.getByRole('button', { name: /envoyer le lien/i }))
    expect(await screen.findByText("Format d'email invalide")).toBeInTheDocument()
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('renders success state with submitted email after happy submit', async () => {
    const user = userEvent.setup()
    render(<MotDePasseOubliePage />)
    await user.type(screen.getByLabelText(/adresse email/i), 'foo@bar.com')
    await user.click(screen.getByRole('button', { name: /envoyer le lien/i }))
    await waitFor(() => {
      expect(screen.getByText('Email envoyé !')).toBeInTheDocument()
    })
    expect(screen.getByText(/foo@bar\.com/)).toBeInTheDocument()
    expect(resetPasswordForEmail).toHaveBeenCalledWith('foo@bar.com', expect.any(Object))
  })

  it('maps rate-limit Supabase error to specific serverError + a11y role="alert"', async () => {
    resetPasswordForEmail.mockResolvedValueOnce({
      error: { message: 'email rate limit exceeded' },
    })
    const user = userEvent.setup()
    render(<MotDePasseOubliePage />)
    await user.type(screen.getByLabelText(/adresse email/i), 'foo@bar.com')
    await user.click(screen.getByRole('button', { name: /envoyer le lien/i }))
    // The role="alert" wrapper is announced by screen readers as soon as it
    // mounts — assert it surfaces alongside the mapped message (Axe 5).
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Trop de demandes/)
  })

  it('maps generic Supabase error to fallback serverError', async () => {
    resetPasswordForEmail.mockResolvedValueOnce({
      error: { message: 'unexpected error' },
    })
    const user = userEvent.setup()
    render(<MotDePasseOubliePage />)
    await user.type(screen.getByLabelText(/adresse email/i), 'foo@bar.com')
    await user.click(screen.getByRole('button', { name: /envoyer le lien/i }))
    await waitFor(() => {
      expect(screen.getByText(/Erreur lors de l'envoi/)).toBeInTheDocument()
    })
  })
})
