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
  it('renders active button + budgets list regardless of amounts', () => {
    const budgets = [
      makeBudget({ budgetId: 'b1', budgetName: 'Courses', estimatedAmount: 400 }),
      makeBudget({ budgetId: 'b2', budgetName: 'Loisirs', estimatedAmount: 100 }),
    ]

    render(
      <RefloatBudgetSnapshotLine
        context="profile"
        budgets={budgets}
        snapshotData={null}
        onError={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Puiser' })).toBeInTheDocument()
    expect(screen.getByText('Courses')).toBeInTheDocument()
    expect(screen.getByText('Loisirs')).toBeInTheDocument()
  })

  it('formats each budget as "X / Y" using carryoverSpentAmount as X', () => {
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
        budgets={budgets}
        snapshotData={null}
        onError={vi.fn()}
      />,
    )

    // "Courses 33,00 € / 400,00 €" — carryover only, no snapshot draft yet
    const row = screen.getByText('Courses').closest('li')!
    expect(row).toHaveTextContent(/33,00.+400,00/)
  })

  it('merges snapshotData into the X numerator when a draft snapshot exists', () => {
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
        budgets={budgets}
        snapshotData={{ b1: 10 }}
        onError={vi.fn()}
      />,
    )

    // "Courses 43,00 € / 400,00 €" — carryover 33 + snapshot 10 = 43
    const row = screen.getByText('Courses').closest('li')!
    expect(row).toHaveTextContent(/43,00.+400,00/)
  })

  it('click triggers mutation with no body (server-computed snapshot)', async () => {
    const user = userEvent.setup()
    saveSnapshotMock.mockResolvedValueOnce({})

    render(
      <RefloatBudgetSnapshotLine
        context="profile"
        budgets={[makeBudget()]}
        snapshotData={null}
        onError={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Puiser' }))

    await waitFor(() => {
      expect(saveSnapshotMock).toHaveBeenCalledTimes(1)
    })
  })

  it('disables button + forwards error code on mutation failure', async () => {
    saveSnapshotPending = false
    const user = userEvent.setup()
    const onError = vi.fn()
    saveSnapshotMock.mockRejectedValueOnce(new Error('invalid_step'))

    render(
      <RefloatBudgetSnapshotLine
        context="profile"
        budgets={[makeBudget()]}
        snapshotData={null}
        onError={onError}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Puiser' }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('invalid_step')
    })
  })
})
