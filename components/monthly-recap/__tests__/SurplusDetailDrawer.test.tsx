import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BudgetSummary } from '@/lib/recap'

import { SurplusDetailDrawer } from '../SurplusDetailDrawer'

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

describe('SurplusDetailDrawer', () => {
  it('renders each budget with name + green amount when budgets list is non-empty', () => {
    const budgets = [
      makeBudget({ budgetId: 'b1', budgetName: 'Courses', surplus: 50 }),
      makeBudget({ budgetId: 'b2', budgetName: 'Loisirs', surplus: 12.5 }),
    ]
    render(<SurplusDetailDrawer isOpen onClose={vi.fn()} budgets={budgets} />)

    expect(screen.getByRole('heading', { name: 'Surplus par budget' })).toBeInTheDocument()
    expect(screen.getByText('Courses')).toBeInTheDocument()
    expect(screen.getByText('Loisirs')).toBeInTheDocument()
    expect(screen.getByText(/\+.*50,00/)).toBeInTheDocument()
    expect(screen.getByText(/\+.*12,50/)).toBeInTheDocument()
    expect(screen.queryByText(/Aucun surplus/)).not.toBeInTheDocument()
  })

  it('shows empty-state copy when budgets list is empty', () => {
    render(<SurplusDetailDrawer isOpen onClose={vi.fn()} budgets={[]} />)

    expect(screen.getByText('Aucun surplus ce mois-ci.')).toBeInTheDocument()
  })

  it('does NOT render content when isOpen=false (Radix unmounts)', () => {
    const budgets = [makeBudget({ budgetName: 'Courses', surplus: 50 })]
    render(<SurplusDetailDrawer isOpen={false} onClose={vi.fn()} budgets={budgets} />)

    expect(screen.queryByRole('heading', { name: 'Surplus par budget' })).not.toBeInTheDocument()
    expect(screen.queryByText('Courses')).not.toBeInTheDocument()
  })

  it('renders the close button with aria-label="Fermer"', () => {
    render(<SurplusDetailDrawer isOpen onClose={vi.fn()} budgets={[]} />)
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument()
  })
})
