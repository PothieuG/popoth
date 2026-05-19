import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ─── Hoisted mocks ──────────────────────────────────────────────────────

const searchParamsRef: { current: URLSearchParams } = { current: new URLSearchParams() }
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsRef.current,
}))

type VerifyResp = { error: null | { message: string } }
const verifyOtp = vi.fn(async (_args: unknown): Promise<VerifyResp> => ({ error: null }))

vi.mock('@/lib/supabase-client', () => ({
  supabase: {
    auth: {
      verifyOtp: (args: unknown) => verifyOtp(args),
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import AuthConfirmPage from '../page'

// ─── window.location.href stubbing ──────────────────────────────────────
// jsdom marks `window.location` as non-configurable; the recommended
// vitest 4.x dance is to define a writable shim via `Object.defineProperty`
// in beforeEach + restore in afterEach.

let hrefSink = ''
let originalLocation: Location

beforeEach(() => {
  hrefSink = ''
  originalLocation = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      ...originalLocation,
      origin: 'http://localhost:3000',
      get href() {
        return hrefSink
      },
      set href(value: string) {
        hrefSink = value
      },
    } as Location,
  })
  verifyOtp.mockReset()
  verifyOtp.mockResolvedValue({ error: null })
  searchParamsRef.current = new URLSearchParams()
})

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  })
})

describe('auth/confirm page', () => {
  it('renders the click-to-confirm gate with the confirm button when token_hash + type are present', () => {
    searchParamsRef.current = new URLSearchParams({
      token_hash: 'abc',
      type: 'recovery',
      next: '/reset-password',
    })
    render(<AuthConfirmPage />)
    const button = screen.getByRole('button', { name: /confirmer/i })
    expect(button).toBeEnabled()
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('shows an invalid-link alert and disables the button when token_hash is missing', () => {
    searchParamsRef.current = new URLSearchParams({ type: 'recovery' })
    render(<AuthConfirmPage />)
    expect(screen.getByRole('button', { name: /confirmer/i })).toBeDisabled()
    expect(screen.getByRole('alert').textContent).toMatch(/invalide ou incomplet/i)
  })

  it('shows an invalid-link alert when type is not in the allowlist', () => {
    searchParamsRef.current = new URLSearchParams({ token_hash: 'abc', type: 'unknown' })
    render(<AuthConfirmPage />)
    expect(screen.getByRole('button', { name: /confirmer/i })).toBeDisabled()
    expect(screen.getByRole('alert').textContent).toMatch(/invalide ou incomplet/i)
  })

  it('calls verifyOtp on click and redirects to `next` on success', async () => {
    searchParamsRef.current = new URLSearchParams({
      token_hash: 'abc',
      type: 'recovery',
      next: '/reset-password',
    })
    const user = userEvent.setup()
    render(<AuthConfirmPage />)
    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'recovery' })
    await waitFor(() => expect(hrefSink).toBe('/reset-password'))
  })

  it('falls back to /reset-password when `next` is missing for type=recovery', async () => {
    searchParamsRef.current = new URLSearchParams({ token_hash: 'abc', type: 'recovery' })
    const user = userEvent.setup()
    render(<AuthConfirmPage />)
    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    await waitFor(() => expect(hrefSink).toBe('/reset-password'))
  })

  it('falls back to /dashboard when `next` is missing for non-recovery types', async () => {
    searchParamsRef.current = new URLSearchParams({ token_hash: 'abc', type: 'signup' })
    const user = userEvent.setup()
    render(<AuthConfirmPage />)
    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    await waitFor(() => expect(hrefSink).toBe('/dashboard'))
  })

  it('rejects external `next` URLs to prevent open-redirect', async () => {
    searchParamsRef.current = new URLSearchParams({
      token_hash: 'abc',
      type: 'recovery',
      next: 'https://evil.example.com/steal',
    })
    const user = userEvent.setup()
    render(<AuthConfirmPage />)
    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    await waitFor(() => expect(hrefSink).toBe('/reset-password'))
  })

  it('rejects protocol-relative `next` (//evil.example.com)', async () => {
    searchParamsRef.current = new URLSearchParams({
      token_hash: 'abc',
      type: 'recovery',
      next: '//evil.example.com/steal',
    })
    const user = userEvent.setup()
    render(<AuthConfirmPage />)
    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    await waitFor(() => expect(hrefSink).toBe('/reset-password'))
  })

  it('redirects to /auth/auth-code-error?error=expired when verifyOtp returns an expired error', async () => {
    verifyOtp.mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } })
    searchParamsRef.current = new URLSearchParams({
      token_hash: 'abc',
      type: 'recovery',
      next: '/reset-password',
    })
    const user = userEvent.setup()
    render(<AuthConfirmPage />)
    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    await waitFor(() => expect(hrefSink).toBe('/auth/auth-code-error?error=expired'))
  })

  it('redirects to /auth/auth-code-error?error=invalid on generic verifyOtp error', async () => {
    verifyOtp.mockResolvedValueOnce({ error: { message: 'something else' } })
    searchParamsRef.current = new URLSearchParams({
      token_hash: 'abc',
      type: 'recovery',
      next: '/reset-password',
    })
    const user = userEvent.setup()
    render(<AuthConfirmPage />)
    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    await waitFor(() => expect(hrefSink).toBe('/auth/auth-code-error?error=invalid'))
  })

  it('redirects to /auth/auth-code-error?error=server when verifyOtp throws', async () => {
    verifyOtp.mockRejectedValueOnce(new Error('network down'))
    searchParamsRef.current = new URLSearchParams({
      token_hash: 'abc',
      type: 'recovery',
      next: '/reset-password',
    })
    const user = userEvent.setup()
    render(<AuthConfirmPage />)
    await user.click(screen.getByRole('button', { name: /confirmer/i }))
    await waitFor(() => expect(hrefSink).toBe('/auth/auth-code-error?error=server'))
  })
})
