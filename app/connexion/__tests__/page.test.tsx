import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const handleLogin = vi.fn(async () => ({ success: true }))
const loginState: { error: string | null; isSubmitting: boolean } = {
  error: null,
  isSubmitting: false,
}

vi.mock('@/hooks/useAuth', () => ({
  useLogin: () => ({
    handleLogin,
    isSubmitting: loginState.isSubmitting,
    error: loginState.error,
    clearError: vi.fn(),
  }),
  useRequireGuest: () => ({ loading: false, isLoggedIn: false }),
}))

import ConnexionPage from '../page'

describe('connexion page', () => {
  beforeEach(() => {
    handleLogin.mockReset()
    handleLogin.mockResolvedValue({ success: true })
    loginState.error = null
    loginState.isSubmitting = false
  })

  it('shows inline errors when both fields are empty and does not call handleLogin', async () => {
    const user = userEvent.setup()
    render(<ConnexionPage />)
    await user.click(screen.getByRole('button', { name: /se connecter/i }))
    // Both fields fail validation — at least one error visible
    expect(await screen.findByText("Format d'email invalide")).toBeInTheDocument()
    expect(screen.getByText(/au moins 6 caractères/i)).toBeInTheDocument()
    expect(handleLogin).not.toHaveBeenCalled()
  })

  it('shows inline email error on invalid format', async () => {
    const user = userEvent.setup()
    render(<ConnexionPage />)
    await user.type(screen.getByLabelText(/adresse email/i), 'not-an-email')
    await user.type(screen.getByLabelText(/mot de passe/i), 'goodpass1')
    await user.click(screen.getByRole('button', { name: /se connecter/i }))
    expect(await screen.findByText("Format d'email invalide")).toBeInTheDocument()
    expect(handleLogin).not.toHaveBeenCalled()
  })

  it('calls handleLogin with email + password on happy submit', async () => {
    const user = userEvent.setup()
    render(<ConnexionPage />)
    await user.type(screen.getByLabelText(/adresse email/i), 'foo@bar.com')
    await user.type(screen.getByLabelText(/mot de passe/i), 'goodpass1')
    await user.click(screen.getByRole('button', { name: /se connecter/i }))
    // wait for the form to flush submit
    expect(handleLogin).toHaveBeenCalledWith('foo@bar.com', 'goodpass1')
  })

  it('renders serverError from useLogin hook (Pattern F)', () => {
    loginState.error = 'Identifiants invalides'
    render(<ConnexionPage />)
    expect(screen.getByText('Identifiants invalides')).toBeInTheDocument()
  })
})
