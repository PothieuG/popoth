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
  it('renders grey indicative copy when totalSavings is 0', () => {
    render(
      <RefloatSavingsLine
        context="profile"
        totalSavings={0}
        savingsByBudget={[]}
        onError={vi.fn()}
      />,
    )

    expect(screen.getByText("Pas d'économies disponibles.")).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders total + per-budget list + transfer button when savings > 0', () => {
    const budgets = [
      makeBudget({ budgetId: 'b1', budgetName: 'Courses', cumulatedSavings: 80 }),
      makeBudget({ budgetId: 'b2', budgetName: 'Loisirs', cumulatedSavings: 45.5 }),
    ]

    render(
      <RefloatSavingsLine
        context="profile"
        totalSavings={125.5}
        savingsByBudget={budgets}
        onError={vi.fn()}
      />,
    )

    expect(screen.getByText('Courses')).toBeInTheDocument()
    expect(screen.getByText(/80,00/)).toBeInTheDocument()
    expect(screen.getByText('Loisirs')).toBeInTheDocument()
    expect(screen.getByText(/45,50/)).toBeInTheDocument()
    expect(screen.getByText(/125,50/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Transférer mes économies dans le déficit' }),
    ).toBeInTheDocument()
  })

  it('click triggers mutation with no body (server-computed allocation)', async () => {
    const user = userEvent.setup()
    refloatSavingsMock.mockResolvedValueOnce({})
    const budgets = [makeBudget({ cumulatedSavings: 100 })]

    render(
      <RefloatSavingsLine
        context="profile"
        totalSavings={100}
        savingsByBudget={budgets}
        onError={vi.fn()}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: 'Transférer mes économies dans le déficit' }),
    )

    await waitFor(() => {
      expect(refloatSavingsMock).toHaveBeenCalledTimes(1)
    })
    // No args — the hook factory accepts undefined `void` calls.
    expect(refloatSavingsMock).toHaveBeenCalledWith()
  })

  it('disables button + shows loading copy while mutation is pending', () => {
    refloatSavingsPending = true
    const budgets = [makeBudget()]

    render(
      <RefloatSavingsLine
        context="profile"
        totalSavings={50}
        savingsByBudget={budgets}
        onError={vi.fn()}
      />,
    )

    const btn = screen.getByRole('button', { name: 'Chargement…' })
    expect(btn).toBeDisabled()
  })

  it('forwards error code to onError when mutation rejects', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    refloatSavingsMock.mockRejectedValueOnce(new Error('no_deficit'))

    render(
      <RefloatSavingsLine
        context="profile"
        totalSavings={100}
        savingsByBudget={[makeBudget()]}
        onError={onError}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: 'Transférer mes économies dans le déficit' }),
    )

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('no_deficit')
    })
  })
})
