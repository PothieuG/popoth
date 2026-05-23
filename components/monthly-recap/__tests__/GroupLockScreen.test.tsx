import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const logoutMock = vi.fn(async () => {})

vi.mock('@/hooks/useAuth', () => ({
  useLogoutAndRedirect: () => ({ logoutAndRedirect: logoutMock }),
}))

import { GroupLockScreen } from '../GroupLockScreen'

describe('GroupLockScreen', () => {
  it('renders the starter name when provided', () => {
    render(<GroupLockScreen startedByName="Alice" />)
    expect(
      screen.getByText('Alice est en train de réaliser le récap mensuel du groupe.'),
    ).toBeInTheDocument()
  })

  it('renders a generic fallback when name is null', () => {
    render(<GroupLockScreen startedByName={null} />)
    expect(
      screen.getByText('Un membre du groupe est en train de réaliser le récap mensuel du groupe.'),
    ).toBeInTheDocument()
  })

  it('calls logoutAndRedirect when the user clicks "Se déconnecter"', async () => {
    logoutMock.mockClear()
    const user = userEvent.setup()
    render(<GroupLockScreen startedByName="Alice" />)
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    expect(logoutMock).toHaveBeenCalledTimes(1)
  })
})
