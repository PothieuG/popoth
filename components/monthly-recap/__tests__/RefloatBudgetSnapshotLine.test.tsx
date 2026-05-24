import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BudgetSummary } from '@/lib/recap'

const saveSnapshotMock = vi.fn()
let saveSnapshotPending = false

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useSaveBudgetSnapshot: () => ({
    mutateAsync: saveSnapshotMock,
    isPending: saveSnapshotPending,
  }),
}))

import { RefloatBudgetSnapshotLine } from '../RefloatBudgetSnapshotLine'

function makeBudget(overrides: Partial<BudgetSummary> = {}): BudgetSummary {
  return {
    budgetId: 'b1',
    budgetName: 'Courses',
    estimatedAmount: 400,
    spentThisMonth: 0,
    cumulatedSavings: 0,
    carryoverSpentAmount: 0,
    surplus: 400,
    deficit: 0,
    ...overrides,
  }
}

beforeEach(() => {
  saveSnapshotMock.mockReset()
  saveSnapshotPending = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RefloatBudgetSnapshotLine', () => {
  describe('state=locked', () => {
    it('renders waiting copy + no button when piggy or savings still has money', () => {
      render(
        <RefloatBudgetSnapshotLine
          context="profile"
          state="locked"
          budgets={[makeBudget()]}
          deficitRemaining={100}
          snapshotData={null}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(
        screen.getByText(/Disponible après avoir épuisé la tirelire et les économies/),
      ).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('state=done', () => {
    it('renders total equilibre + per-budget new values in a grey card', () => {
      const budgets = [
        makeBudget({
          budgetId: 'b1',
          budgetName: 'Courses',
          estimatedAmount: 400,
          carryoverSpentAmount: 0,
        }),
        makeBudget({
          budgetId: 'b2',
          budgetName: 'Loisirs',
          estimatedAmount: 100,
          carryoverSpentAmount: 5,
        }),
      ]

      render(
        <RefloatBudgetSnapshotLine
          context="profile"
          state="done"
          budgets={budgets}
          deficitRemaining={0}
          snapshotData={{ b1: 30, b2: 20 }}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      // Phrase total (text split across span + text node — assert via parent)
      const totalLine = screen.getByText(/équilibrés depuis les budgets/).closest('p')!
      expect(totalLine).toHaveTextContent(/50,00/)
      // Per-budget new values "consumed / estimated"
      // Courses : 0 (carryover) + 30 (snapshot) = 30 / 400
      expect(screen.getByText('Courses').closest('li')).toHaveTextContent(/30,00.+\/.+400,00/)
      // Loisirs : 5 + 20 = 25 / 100
      expect(screen.getByText('Loisirs').closest('li')).toHaveTextContent(/25,00.+\/.+100,00/)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('state=active', () => {
    it('renders per-budget preview "X / Y → X+puiser / Y" with the puiser delta', () => {
      const budgets = [
        makeBudget({
          budgetId: 'b1',
          budgetName: 'Courses',
          estimatedAmount: 400,
          carryoverSpentAmount: 33,
        }),
      ]

      render(
        <RefloatBudgetSnapshotLine
          context="profile"
          state="active"
          budgets={budgets}
          deficitRemaining={20}
          snapshotData={null}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      // Single budget → full deficit (20€) puised : preview
      // "33,00 € / 400,00 € → 53,00 € / 400,00 € (+20,00 €)"
      const row = screen.getByText('Courses').closest('li')!
      const text = row.textContent ?? ''
      expect(text).toContain('33,00')
      expect(text).toContain('53,00')
      expect(text).toContain('400,00')
      expect(text).toContain('+20,00')
      expect(text).toContain('→')
      expect(screen.getByRole('button', { name: 'Équilibrer' })).toBeInTheDocument()
    })

    it('click triggers mutation + onSuccess receives the total puised amount', async () => {
      const user = userEvent.setup()
      const onSuccess = vi.fn()
      saveSnapshotMock.mockResolvedValueOnce({
        newDeficit: 0,
        snapshot: { b1: 30, b2: 20 },
        perBudget: [
          { budgetId: 'b1', amount: 30 },
          { budgetId: 'b2', amount: 20 },
        ],
        shortfall: 0,
        nextStep: 'salary_update',
      })

      render(
        <RefloatBudgetSnapshotLine
          context="profile"
          state="active"
          budgets={[makeBudget()]}
          deficitRemaining={50}
          snapshotData={null}
          onError={vi.fn()}
          onSuccess={onSuccess}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Équilibrer' }))

      await waitFor(() => {
        expect(saveSnapshotMock).toHaveBeenCalledTimes(1)
      })
      expect(onSuccess).toHaveBeenCalledWith(expect.stringMatching(/50,00.+équilibrés/))
    })

    it('forwards error code to onError on mutation failure', async () => {
      const user = userEvent.setup()
      const onError = vi.fn()
      saveSnapshotMock.mockRejectedValueOnce(new Error('invalid_step'))

      render(
        <RefloatBudgetSnapshotLine
          context="profile"
          state="active"
          budgets={[makeBudget()]}
          deficitRemaining={50}
          snapshotData={null}
          onError={onError}
          onSuccess={vi.fn()}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Équilibrer' }))

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('invalid_step')
      })
    })
  })
})
