import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BudgetSummary } from '@/lib/recap'

import { SurplusSelectionDrawer } from '../SurplusSelectionDrawer'

function makeBudget(overrides: Partial<BudgetSummary>): BudgetSummary {
  return {
    budgetId: 'b1',
    budgetName: 'Courses',
    estimatedAmount: 200,
    spentThisMonth: 150,
    cumulatedSavings: 0,
    carryoverSpentAmount: 0,
    surplus: 50,
    deficit: 0,
    ...overrides,
  }
}

const threeBudgets: BudgetSummary[] = [
  makeBudget({ budgetId: 'b1', budgetName: 'Courses', surplus: 50 }),
  makeBudget({ budgetId: 'b2', budgetName: 'Loisirs', surplus: 12.5 }),
  makeBudget({ budgetId: 'b3', budgetName: 'Transport', surplus: 33 }),
]

describe('SurplusSelectionDrawer', () => {
  it('renders one tappable row per budget + initial state (nothing selected)', () => {
    render(
      <SurplusSelectionDrawer
        isOpen
        onClose={vi.fn()}
        budgets={threeBudgets}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Répartir vers la tirelire' })).toBeInTheDocument()

    const rows = screen.getAllByRole('button', { pressed: false })
    // 3 budget rows. Other buttons (close X, footer "Transférer") use neither
    // aria-pressed nor are matched here.
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveAccessibleName(/Courses/)
    expect(rows[1]).toHaveAccessibleName(/Loisirs/)
    expect(rows[2]).toHaveAccessibleName(/Transport/)
  })

  it('toggles aria-pressed on row tap and updates the footer total', async () => {
    const user = userEvent.setup()
    render(
      <SurplusSelectionDrawer
        isOpen
        onClose={vi.fn()}
        budgets={threeBudgets}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )

    const coursesRow = screen.getByRole('button', { name: /Courses/ })
    await user.click(coursesRow)
    expect(coursesRow).toHaveAttribute('aria-pressed', 'true')

    // Footer button label uses formatted total (50,00 €). Intl.NumberFormat
    // fr-FR uses U+202F and U+00A0 separators — \s matches both.
    expect(
      screen.getByRole('button', { name: /Transférer.+50,00.+vers la tirelire/ }),
    ).toBeEnabled()

    const transportRow = screen.getByRole('button', { name: /Transport/ })
    await user.click(transportRow)
    expect(transportRow).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: /Transférer.+83,00.+vers la tirelire/ }),
    ).toBeEnabled()
  })

  it('un-selects a row on second tap', async () => {
    const user = userEvent.setup()
    render(
      <SurplusSelectionDrawer
        isOpen
        onClose={vi.fn()}
        budgets={threeBudgets}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )

    const coursesRow = screen.getByRole('button', { name: /Courses/ })
    await user.click(coursesRow)
    expect(coursesRow).toHaveAttribute('aria-pressed', 'true')
    await user.click(coursesRow)
    expect(coursesRow).toHaveAttribute('aria-pressed', 'false')
  })

  it('disables footer submit when nothing is selected', () => {
    render(
      <SurplusSelectionDrawer
        isOpen
        onClose={vi.fn()}
        budgets={threeBudgets}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )

    const submit = screen.getByRole('button', { name: /Transférer 0,00.+vers la tirelire/ })
    expect(submit).toBeDisabled()
  })

  it('disables footer submit and shows loading label when isSubmitting=true', async () => {
    const user = userEvent.setup()
    render(
      <SurplusSelectionDrawer
        isOpen
        onClose={vi.fn()}
        budgets={threeBudgets}
        isSubmitting
        onSubmit={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Courses/ }))
    const submit = screen.getByRole('button', { name: 'Transfert…' })
    expect(submit).toBeDisabled()
  })

  it('calls onSubmit with the selected budget ids on footer click', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <SurplusSelectionDrawer
        isOpen
        onClose={vi.fn()}
        budgets={threeBudgets}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Courses/ }))
    await user.click(screen.getByRole('button', { name: /Transport/ }))
    await user.click(screen.getByRole('button', { name: /Transférer.+83,00/ }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(expect.arrayContaining(['b1', 'b3']))
    expect(onSubmit.mock.calls[0]?.[0]).toHaveLength(2)
  })

  it('resets the selection when the drawer is re-opened', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <SurplusSelectionDrawer
        isOpen
        onClose={vi.fn()}
        budgets={threeBudgets}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Courses/ }))
    expect(screen.getByRole('button', { name: /Courses/ })).toHaveAttribute('aria-pressed', 'true')

    // Close
    rerender(
      <SurplusSelectionDrawer
        isOpen={false}
        onClose={vi.fn()}
        budgets={threeBudgets}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )

    // Re-open
    rerender(
      <SurplusSelectionDrawer
        isOpen
        onClose={vi.fn()}
        budgets={threeBudgets}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Courses/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Transférer 0,00/ })).toBeDisabled()
  })

  it('renders an empty-state copy when budgets list is empty', () => {
    render(
      <SurplusSelectionDrawer
        isOpen
        onClose={vi.fn()}
        budgets={[]}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText('Aucun surplus disponible.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Transférer 0,00/ })).toBeDisabled()
  })

  it('calls onClose when the close X button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <SurplusSelectionDrawer
        isOpen
        onClose={onClose}
        budgets={threeBudgets}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the user presses Escape (Radix native dismiss)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <SurplusSelectionDrawer
        isOpen
        onClose={onClose}
        budgets={threeBudgets}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
