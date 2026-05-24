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
  describe('state=empty', () => {
    it('renders grey indicative card with "Pas d\'argent dans la tirelire"', () => {
      render(
        <RefloatPiggyLine
          context="profile"
          state="empty"
          piggyAmount={0}
          deficitRemaining={100}
          refloatedFromPiggy={0}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(screen.getByText("Pas d'argent dans la tirelire.")).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('state=done', () => {
    it('renders the amount used + the remaining piggy in the grey card', () => {
      render(
        <RefloatPiggyLine
          context="profile"
          state="done"
          piggyAmount={0}
          deficitRemaining={50}
          refloatedFromPiggy={80}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      // "80,00 €" and "de la tirelire utilisée…" are in 2 sibling nodes (span + text).
      // Verify via the parent <p> textContent.
      const usedLine = screen
        .getByText(/de la tirelire utilisée pour combler le déficit/)
        .closest('p')!
      expect(usedLine).toHaveTextContent(/80,00/)
      // Same shape for the "Il reste X dans la tirelire" line.
      const remainingLine = screen.getByText(/Il reste/).closest('p')!
      expect(remainingLine).toHaveTextContent(/0,00/)
      expect(remainingLine).toHaveTextContent(/dans la tirelire/)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('state=active', () => {
    it('clamps "À transférer" to deficitRemaining when piggy > deficit', () => {
      render(
        <RefloatPiggyLine
          context="profile"
          state="active"
          piggyAmount={200}
          deficitRemaining={50}
          refloatedFromPiggy={0}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(screen.getByText(/200,00/)).toBeInTheDocument()
      expect(screen.getAllByText(/50,00/)).toHaveLength(2) // À transférer + button label
      expect(screen.getByRole('button', { name: /Renflouer.+50,00/ })).toBeInTheDocument()
    })

    it('uses full piggy when piggy ≤ deficit', () => {
      render(
        <RefloatPiggyLine
          context="profile"
          state="active"
          piggyAmount={30}
          deficitRemaining={100}
          refloatedFromPiggy={0}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(screen.getAllByText(/30,00/)).toHaveLength(3) // Disponible + À transférer + button
      expect(screen.getByRole('button', { name: /Renflouer.+30,00/ })).toBeInTheDocument()
    })

    it('click triggers mutation with clamped amount AND calls onSuccess', async () => {
      const user = userEvent.setup()
      const onSuccess = vi.fn()
      refloatPiggyMock.mockResolvedValueOnce({})

      render(
        <RefloatPiggyLine
          context="profile"
          state="active"
          piggyAmount={200}
          deficitRemaining={75}
          refloatedFromPiggy={0}
          onError={vi.fn()}
          onSuccess={onSuccess}
        />,
      )
      await user.click(screen.getByRole('button', { name: /Renflouer.+75,00/ }))

      await waitFor(() => {
        expect(refloatPiggyMock).toHaveBeenCalledWith({ amount: 75 })
      })
      expect(onSuccess).toHaveBeenCalledWith(expect.stringMatching(/75,00.+tirelire/))
    })

    it('disables button + shows loading copy while mutation is pending', () => {
      refloatPiggyPending = true

      render(
        <RefloatPiggyLine
          context="profile"
          state="active"
          piggyAmount={100}
          deficitRemaining={50}
          refloatedFromPiggy={0}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: 'Chargement…' })).toBeDisabled()
    })

    it('forwards error code to onError when mutation rejects', async () => {
      const user = userEvent.setup()
      const onError = vi.fn()
      refloatPiggyMock.mockRejectedValueOnce(new Error('piggy_insufficient'))

      render(
        <RefloatPiggyLine
          context="profile"
          state="active"
          piggyAmount={100}
          deficitRemaining={50}
          refloatedFromPiggy={0}
          onError={onError}
          onSuccess={vi.fn()}
        />,
      )
      await user.click(screen.getByRole('button', { name: /Renflouer/ }))

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('piggy_insufficient')
      })
    })
  })
})
