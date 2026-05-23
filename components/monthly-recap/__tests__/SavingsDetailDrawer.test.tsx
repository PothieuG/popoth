import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BudgetSummary } from '@/lib/recap'

import { SavingsDetailDrawer } from '../SavingsDetailDrawer'

function makeBudget(overrides: Partial<BudgetSummary>): BudgetSummary {
  return {
    budgetId: 'b1',
    budgetName: 'Courses',
    estimatedAmount: 200,
    spentThisMonth: 150,
    cumulatedSavings: 100,
    surplus: 0,
    deficit: 0,
    ...overrides,
  }
}

describe('SavingsDetailDrawer', () => {
  it('renders Tirelire line + per-budget cumulated_savings', () => {
    const budgets = [
      makeBudget({ budgetId: 'b1', budgetName: 'Courses', cumulatedSavings: 80 }),
      makeBudget({ budgetId: 'b2', budgetName: 'Loisirs', cumulatedSavings: 220.5 }),
    ]
    render(<SavingsDetailDrawer isOpen onClose={vi.fn()} piggyAmount={50} budgets={budgets} />)

    expect(screen.getByRole('heading', { name: 'Détail des économies' })).toBeInTheDocument()
    expect(screen.getByText('Tirelire')).toBeInTheDocument()
    expect(screen.getByText(/50,00/)).toBeInTheDocument()
    expect(screen.getByText('Courses')).toBeInTheDocument()
    expect(screen.getByText(/80,00/)).toBeInTheDocument()
    expect(screen.getByText('Loisirs')).toBeInTheDocument()
    expect(screen.getByText(/220,50/)).toBeInTheDocument()
    expect(screen.queryByText(/Aucune économie/)).not.toBeInTheDocument()
  })

  it('skips Tirelire line when piggyAmount is 0', () => {
    const budgets = [makeBudget({ cumulatedSavings: 100 })]
    render(<SavingsDetailDrawer isOpen onClose={vi.fn()} piggyAmount={0} budgets={budgets} />)

    expect(screen.queryByText('Tirelire')).not.toBeInTheDocument()
    expect(screen.getByText('Courses')).toBeInTheDocument()
  })

  it('shows empty-state copy when piggy is 0 and no budgets have cumulated_savings', () => {
    render(<SavingsDetailDrawer isOpen onClose={vi.fn()} piggyAmount={0} budgets={[]} />)

    expect(screen.getByText('Aucune économie pour le moment.')).toBeInTheDocument()
    expect(screen.queryByText('Tirelire')).not.toBeInTheDocument()
  })

  it('does NOT render content when isOpen=false', () => {
    render(
      <SavingsDetailDrawer
        isOpen={false}
        onClose={vi.fn()}
        piggyAmount={50}
        budgets={[makeBudget({})]}
      />,
    )

    expect(screen.queryByRole('heading', { name: 'Détail des économies' })).not.toBeInTheDocument()
  })
})
