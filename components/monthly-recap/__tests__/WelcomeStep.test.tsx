import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startMock = vi.fn()
const advanceMock = vi.fn()
const routerReplaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}))

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useStartRecap: () => ({ mutateAsync: startMock, isPending: false }),
  useAdvanceStep: () => ({ mutateAsync: advanceMock, isPending: false }),
}))

import { WelcomeStep } from '../steps/WelcomeStep'

beforeEach(() => {
  startMock.mockReset()
  advanceMock.mockReset()
  routerReplaceMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('WelcomeStep', () => {
  it('renders the intro copy + Commencer button', () => {
    render(<WelcomeStep context="profile" />)

    expect(screen.getByRole('heading', { name: 'Bienvenue' })).toBeInTheDocument()
    expect(screen.getByText(/Bienvenue dans le récap mensuel/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commencer' })).toBeInTheDocument()
  })

  it('on click, calls /start then /advance-step(welcome → complete_month)', async () => {
    const user = userEvent.setup()
    startMock.mockResolvedValueOnce({})
    advanceMock.mockResolvedValueOnce({})

    render(<WelcomeStep context="profile" />)
    await user.click(screen.getByRole('button', { name: 'Commencer' }))

    await waitFor(() => {
      expect(startMock).toHaveBeenCalledTimes(1)
    })
    expect(advanceMock).toHaveBeenCalledTimes(1)
    // Sprint Complete-Month-Step (2026-05-29) — la cible passe de 'summary'
    // à 'complete_month' (l'étape 2 nouvellement insérée du wizard).
    expect(advanceMock).toHaveBeenCalledWith({ fromStep: 'welcome', toStep: 'complete_month' })
  })

  it('shows user-friendly message when /start returns locked_by_other', async () => {
    const user = userEvent.setup()
    startMock.mockRejectedValueOnce(new Error('locked_by_other'))

    render(<WelcomeStep context="group" />)
    await user.click(screen.getByRole('button', { name: 'Commencer' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Un autre membre est déjà en train de faire le récap/,
      )
    })
    expect(advanceMock).not.toHaveBeenCalled()
  })

  it('redirects to /dashboard on already_completed (profile)', async () => {
    const user = userEvent.setup()
    startMock.mockRejectedValueOnce(new Error('already_completed'))

    render(<WelcomeStep context="profile" />)
    await user.click(screen.getByRole('button', { name: 'Commencer' }))

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('redirects to /group-dashboard on already_completed (group)', async () => {
    const user = userEvent.setup()
    startMock.mockRejectedValueOnce(new Error('already_completed'))

    render(<WelcomeStep context="group" />)
    await user.click(screen.getByRole('button', { name: 'Commencer' }))

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith('/group-dashboard')
    })
  })

  it('falls through to /advance-step even if /start was a no-op resume (idempotent)', async () => {
    const user = userEvent.setup()
    // Simulate the 'resumed' case where /start succeeds and /advance-step moves the wizard.
    startMock.mockResolvedValueOnce({ recap: { id: 'r1', current_step: 'welcome' } })
    advanceMock.mockResolvedValueOnce({ recap: { id: 'r1', current_step: 'complete_month' } })

    render(<WelcomeStep context="profile" />)
    await user.click(screen.getByRole('button', { name: 'Commencer' }))

    await waitFor(() => {
      expect(advanceMock).toHaveBeenCalledWith({ fromStep: 'welcome', toStep: 'complete_month' })
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows generic copy on unknown error', async () => {
    const user = userEvent.setup()
    startMock.mockRejectedValueOnce(new Error('boom'))

    render(<WelcomeStep context="profile" />)
    await user.click(screen.getByRole('button', { name: 'Commencer' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Une erreur est survenue/)
    })
  })
})
