import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const replaceMock = vi.fn()
const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}))

const authState: {
  user: { id: string; email: string } | null
  loading: boolean
  error: string | null
  isLoggedIn: boolean
} = { user: null, loading: true, error: null, isLoggedIn: false }

vi.mock('@/contexts/AuthContext', () => ({
  useAuthUser: () => authState,
}))

import HomePage from '../page'

describe('HomePage flicker fix (P10)', () => {
  beforeEach(() => {
    replaceMock.mockReset()
    pushMock.mockReset()
    authState.user = null
    authState.loading = true
    authState.error = null
    authState.isLoggedIn = false
  })

  it('renders loader (role=status) while auth is initializing — never the guest content', () => {
    render(<HomePage />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/bienvenue sur popoth/i)).not.toBeInTheDocument()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('renders guest content after INIT_SUCCESS with user=null', () => {
    authState.loading = false
    authState.isLoggedIn = false
    render(<HomePage />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText(/bienvenue sur popoth/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /se connecter/i })).toBeInTheDocument()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('calls router.replace("/dashboard") after INIT_SUCCESS with user — never flashes guest', () => {
    authState.user = { id: 'u1', email: 'a@b.c' }
    authState.loading = false
    authState.isLoggedIn = true
    render(<HomePage />)
    expect(replaceMock).toHaveBeenCalledWith('/dashboard')
    // Loader visible during redirect — guest content must NOT flash
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/bienvenue sur popoth/i)).not.toBeInTheDocument()
  })
})
