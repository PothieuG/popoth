import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refloatPiggyMock = vi.fn()
let refloatPiggyPending = false

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useRefloatFromPiggy: () => ({ mutateAsync: refloatPiggyMock, isPending: refloatPiggyPending }),
}))

import { RefloatPiggyLine } from '../RefloatPiggyLine'

beforeEach(() => {
  refloatPiggyMock.mockReset()
  refloatPiggyPending = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RefloatPiggyLine', () => {
  it('renders grey indicative copy when piggyAmount is 0', () => {
    render(
      <RefloatPiggyLine
        context="profile"
        piggyAmount={0}
        deficitRemaining={100}
        onError={vi.fn()}
      />,
    )

    expect(screen.getByText("Pas d'argent dans la tirelire.")).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('clamps "À utiliser" to deficitRemaining when piggy > deficit', () => {
    render(
      <RefloatPiggyLine
        context="profile"
        piggyAmount={200}
        deficitRemaining={50}
        onError={vi.fn()}
      />,
    )

    // Disponible row : 200,00 € (1 occurrence)
    expect(screen.getByText(/200,00/)).toBeInTheDocument()
    // À utiliser row + button both render "50,00" (2 occurrences total)
    expect(screen.getAllByText(/50,00/)).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Renflouer.+50,00/ })).toBeInTheDocument()
  })

  it('shows piggyAmount when piggy ≤ deficit (full piggy used)', () => {
    render(
      <RefloatPiggyLine
        context="profile"
        piggyAmount={30}
        deficitRemaining={100}
        onError={vi.fn()}
      />,
    )

    // 3 occurrences : Disponible row + À utiliser row + button label
    expect(screen.getAllByText(/30,00/)).toHaveLength(3)
    expect(screen.getByRole('button', { name: /Renflouer.+30,00/ })).toBeInTheDocument()
  })

  it('click triggers mutation with clamped amount', async () => {
    const user = userEvent.setup()
    refloatPiggyMock.mockResolvedValueOnce({})

    render(
      <RefloatPiggyLine
        context="profile"
        piggyAmount={200}
        deficitRemaining={75}
        onError={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Renflouer.+75,00/ }))

    await waitFor(() => {
      expect(refloatPiggyMock).toHaveBeenCalledTimes(1)
    })
    expect(refloatPiggyMock).toHaveBeenCalledWith({ amount: 75 })
  })

  it('disables button + shows loading copy while mutation is pending', () => {
    refloatPiggyPending = true

    render(
      <RefloatPiggyLine
        context="profile"
        piggyAmount={100}
        deficitRemaining={50}
        onError={vi.fn()}
      />,
    )

    const btn = screen.getByRole('button', { name: 'Chargement…' })
    expect(btn).toBeDisabled()
  })

  it('forwards error code to onError when mutation rejects', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    refloatPiggyMock.mockRejectedValueOnce(new Error('piggy_insufficient'))

    render(
      <RefloatPiggyLine
        context="profile"
        piggyAmount={100}
        deficitRemaining={50}
        onError={onError}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Renflouer/ }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('piggy_insufficient')
    })
  })
})
