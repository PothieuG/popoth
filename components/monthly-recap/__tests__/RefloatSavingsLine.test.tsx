import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BudgetSummary } from '@/lib/recap'

const refloatSavingsMock = vi.fn()
let refloatSavingsPending = false

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useRefloatFromSavings: () => ({
    mutateAsync: refloatSavingsMock,
    isPending: refloatSavingsPending,
  }),
}))

import { RefloatSavingsLine } from '../RefloatSavingsLine'

function makeBudget(overrides: Partial<BudgetSummary> = {}): BudgetSummary {
  return {
    budgetId: 'b1',
    budgetName: 'Courses',
    estimatedAmount: 400,
    spentThisMonth: 350,
    cumulatedSavings: 100,
    carryoverSpentAmount: 0,
    surplus: 50,
    deficit: 0,
    ...overrides,
  }
}

beforeEach(() => {
  refloatSavingsMock.mockReset()
  refloatSavingsPending = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RefloatSavingsLine', () => {
  describe('state=locked', () => {
    it('renders waiting copy + no button when piggy is not yet empty', () => {
      render(
        <RefloatSavingsLine
          context="profile"
          state="locked"
          totalSavings={100}
          budgets={[makeBudget()]}
          deficitRemaining={100}
          refloatedFromSavings={0}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(screen.getByText(/Disponible après avoir transféré la tirelire/)).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('state=empty', () => {
    it('renders "Pas d\'économies" grey card', () => {
      render(
        <RefloatSavingsLine
          context="profile"
          state="empty"
          totalSavings={0}
          budgets={[]}
          deficitRemaining={100}
          refloatedFromSavings={0}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(screen.getByText("Pas d'économies disponibles.")).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('state=done', () => {
    it('renders the cumulative savings refloat in a grey card', () => {
      render(
        <RefloatSavingsLine
          context="profile"
          state="done"
          totalSavings={0}
          budgets={[]}
          deficitRemaining={20}
          refloatedFromSavings={120}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      const transferLine = screen.getByText(/d'économies transférés vers le déficit/).closest('p')!
      expect(transferLine).toHaveTextContent(/120,00/)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('state=active', () => {
    it('renders per-budget preview with current → after (-debit) format', () => {
      const budgets = [
        makeBudget({ budgetId: 'b1', budgetName: 'Courses', cumulatedSavings: 60 }),
        makeBudget({ budgetId: 'b2', budgetName: 'Loisirs', cumulatedSavings: 40 }),
      ]

      render(
        <RefloatSavingsLine
          context="profile"
          state="active"
          totalSavings={100}
          budgets={budgets}
          deficitRemaining={50}
          refloatedFromSavings={0}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      // Total displayed
      expect(screen.getByText(/100,00/)).toBeInTheDocument()
      // Both budget names
      expect(screen.getByText('Courses')).toBeInTheDocument()
      expect(screen.getByText('Loisirs')).toBeInTheDocument()
      // Preview "current → after" arrow per budget row
      expect(screen.getAllByText('→')).toHaveLength(2)
      // Button has the new lean label
      expect(screen.getByRole('button', { name: 'Transférer les économies' })).toBeInTheDocument()
    })

    it('click triggers mutation + onSuccess receives the transferred amount', async () => {
      const user = userEvent.setup()
      const onSuccess = vi.fn()
      refloatSavingsMock.mockResolvedValueOnce({ refloatedFromSavings: 50 })

      render(
        <RefloatSavingsLine
          context="profile"
          state="active"
          totalSavings={100}
          budgets={[makeBudget({ cumulatedSavings: 100 })]}
          deficitRemaining={50}
          refloatedFromSavings={0}
          onError={vi.fn()}
          onSuccess={onSuccess}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Transférer les économies' }))

      await waitFor(() => {
        expect(refloatSavingsMock).toHaveBeenCalledTimes(1)
      })
      expect(onSuccess).toHaveBeenCalledWith(expect.stringMatching(/50,00.+économies transférées/))
    })

    it('forwards error code to onError on mutation failure', async () => {
      const user = userEvent.setup()
      const onError = vi.fn()
      refloatSavingsMock.mockRejectedValueOnce(new Error('no_deficit'))

      render(
        <RefloatSavingsLine
          context="profile"
          state="active"
          totalSavings={100}
          budgets={[makeBudget()]}
          deficitRemaining={50}
          refloatedFromSavings={0}
          onError={onError}
          onSuccess={vi.fn()}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Transférer les économies' }))

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('no_deficit')
      })
    })
  })
})
