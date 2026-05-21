import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import TransactionListItem from '../TransactionListItem'
import type { RealExpense } from '@/hooks/useRealExpenses'
import type { RealIncome } from '@/hooks/useRealIncomes'

// Sprint Enrich-Delete-Confirmation — covers the `details` ReactNode passed
// to the ConfirmationDialog when deleting an expense or income. Layout is a
// 3-column grid (label / amount / "→ new balance"). 4 branches:
//   - Budgeted expense: budget/savings/piggy/RAV lines per > 0 source
//   - Exceptional expense: single RAV recovery line
//   - Regular income: RAV impact line via cumul/estimated deficit math
//   - Exceptional income: single RAV loss line

const buildExpense = (overrides: Partial<RealExpense> = {}): RealExpense => ({
  id: 'exp-1',
  amount: 60,
  description: 'Test expense',
  expense_date: '2026-05-21',
  is_exceptional: false,
  created_at: '2026-05-21T10:00:00Z',
  estimated_budget_id: 'bud-1',
  estimated_budget: { name: 'Courses' },
  amount_from_piggy_bank: 5,
  amount_from_budget_savings: 15,
  amount_from_budget: 40,
  ...overrides,
})

const buildIncome = (overrides: Partial<RealIncome> = {}): RealIncome => ({
  id: 'inc-1',
  amount: 200,
  description: 'Test income',
  entry_date: '2026-05-21',
  is_exceptional: false,
  created_at: '2026-05-21T10:00:00Z',
  estimated_income_id: 'src-1',
  estimated_income: { name: 'Salaire Mai' },
  ...overrides,
})

const openDeleteDialog = async (user: UserEvent) => {
  await user.click(screen.getByLabelText('Options'))
  // After dropdown opens, the "Supprimer" button is the dropdown item; click
  // it to dismiss the dropdown and open the ConfirmationDialog.
  await user.click(screen.getByRole('button', { name: 'Supprimer' }))
}

/**
 * Scope queries to within the open ConfirmationDialog (role="dialog"). The row
 * outside the dialog also renders the transaction amount, source name, and
 * breakdown badges — so unscoped `screen.getByText` would match multiple.
 */
const inDialog = () => within(screen.getByRole('dialog'))

describe('<TransactionListItem> delete confirmation details', () => {
  describe('expense branch', () => {
    it('budgeted expense with 3 sources (no overflow) shows budget/savings/piggy lines', async () => {
      // amount=60, budget=200, spentSnapshot includes this expense (=40 own contribution),
      // → spentAfter = 0, no deficit, no RAV line. 3 source lines.
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildExpense()}
          type="expense"
          budgetSnapshot={{ cumulatedSavings: 100, estimatedAmount: 200, spentAmount: 40 }}
          currentRemainingToLive={1000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText('Cette suppression recrédite :')).toBeInTheDocument()

      // Budget line: blue-600 + bold, amount 40,00 €.
      const budgetAmount = dlg.getByText(/40,00/)
      expect(budgetAmount.className).toMatch(/text-blue-600/)
      expect(budgetAmount.className).toMatch(/font-semibold/)
      expect(dlg.getByText(/Budget « Courses »/)).toBeInTheDocument()

      // Savings line: emerald-600, budget name included.
      const savingsAmount = dlg.getByText(/15,00/)
      expect(savingsAmount.className).toMatch(/text-emerald-600/)
      expect(dlg.getByText(/Économies « Courses »/)).toBeInTheDocument()

      // Piggy line: purple-600.
      const piggyAmount = dlg.getByText(/^5,00/)
      expect(piggyAmount.className).toMatch(/text-purple-600/)
      expect(dlg.getByText('Tirelire')).toBeInTheDocument()

      // No RAV recovery line (no deficit).
      expect(dlg.queryByText('Reste à vivre')).not.toBeInTheDocument()
    })

    it('budgeted expense with overflow shows budget + savings + RAV recovery (200/300/100 case)', async () => {
      // User's reported scenario: budget=200, savings=300, expense=600
      // → fromBudget=300 (200 in-budget + 100 overflow), fromSavings=300
      // After delete: budget 200/200 available, savings +300, RAV +100
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildExpense({
            amount: 600,
            amount_from_piggy_bank: 0,
            amount_from_budget_savings: 300,
            amount_from_budget: 300,
          })}
          type="expense"
          budgetSnapshot={{ cumulatedSavings: 0, estimatedAmount: 200, spentAmount: 300 }}
          currentRemainingToLive={1050}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText('Cette suppression recrédite :')).toBeInTheDocument()

      // Budget line: split shows 200€ (not 300€), with "→ 200/200" suffix.
      expect(dlg.getByText(/Budget « Courses »/)).toBeInTheDocument()
      const blueAmounts = document.querySelectorAll('.text-blue-600.font-semibold')
      expect(blueAmounts).toHaveLength(1)
      expect(blueAmounts[0]?.textContent).toMatch(/200,00/)
      expect(dlg.getByText(/200\s*€\/200\s*€/)).toBeInTheDocument()

      // Savings line: 300€, "→ 300 €" (cumulated_savings was 0 + 300 recredited).
      expect(dlg.getByText(/Économies « Courses »/)).toBeInTheDocument()
      const emeraldAmounts = document.querySelectorAll('.text-emerald-600.font-semibold')
      // 2 emerald: savings + RAV recovery.
      expect(emeraldAmounts).toHaveLength(2)
      const savingsSpan = Array.from(emeraldAmounts).find((s) => s.textContent?.match(/300,00/))
      expect(savingsSpan).toBeDefined()

      // RAV line: 100€ recovered, "→ 1 150 €" (1050 + 100).
      expect(dlg.getByText('Reste à vivre')).toBeInTheDocument()
      const ravSpan = Array.from(emeraldAmounts).find((s) => s.textContent?.match(/100,00/))
      expect(ravSpan).toBeDefined()
      expect(dlg.getByText(/1\s*150\s*€/)).toBeInTheDocument()
    })

    it('budgeted expense with only budget > 0 shows just the budget line', async () => {
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildExpense({
            amount: 30,
            amount_from_piggy_bank: 0,
            amount_from_budget_savings: 0,
            amount_from_budget: 30,
          })}
          type="expense"
          budgetSnapshot={{ cumulatedSavings: 50, estimatedAmount: 200, spentAmount: 30 }}
          currentRemainingToLive={1000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText('Cette suppression recrédite :')).toBeInTheDocument()
      expect(dlg.getByText(/Budget « Courses »/)).toBeInTheDocument()
      expect(dlg.queryByText(/Économies/)).not.toBeInTheDocument()
      expect(dlg.queryByText('Tirelire')).not.toBeInTheDocument()
      expect(dlg.queryByText('Reste à vivre')).not.toBeInTheDocument()
    })

    it('budgeted expense without budgetSnapshot: shows lines without "→ new balance" suffix', async () => {
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildExpense({
            amount: 30,
            amount_from_piggy_bank: 0,
            amount_from_budget_savings: 0,
            amount_from_budget: 30,
          })}
          type="expense"
          // No budgetSnapshot prop → no new-balance suffix
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText(/Budget « Courses »/)).toBeInTheDocument()
      // No "→" arrows since no snapshot.
      expect(dlg.queryByText(/→/)).not.toBeInTheDocument()
    })

    it('legacy budgeted expense (no amount_from_* fields) falls back to amount on budget line', async () => {
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildExpense({
            amount: 80,
            amount_from_piggy_bank: undefined,
            amount_from_budget_savings: undefined,
            amount_from_budget: undefined,
          })}
          type="expense"
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText('Cette suppression recrédite :')).toBeInTheDocument()
      const coloredSpans = document.querySelectorAll('.text-blue-600.font-semibold')
      expect(coloredSpans).toHaveLength(1)
      expect(coloredSpans[0]?.textContent).toMatch(/80,00/)
    })

    it('exceptional expense shows RAV recovery line in emerald', async () => {
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildExpense({
            amount: 25,
            is_exceptional: true,
            estimated_budget_id: undefined,
            estimated_budget: undefined,
            amount_from_piggy_bank: undefined,
            amount_from_budget_savings: undefined,
            amount_from_budget: undefined,
          })}
          type="expense"
          currentRemainingToLive={1000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText('Cette suppression recrédite :')).toBeInTheDocument()
      expect(dlg.getByText('Reste à vivre')).toBeInTheDocument()
      const coloredSpans = document.querySelectorAll('.text-emerald-600.font-semibold')
      expect(coloredSpans).toHaveLength(1)
      expect(coloredSpans[0]?.textContent).toMatch(/25,00/)
      // New RAV balance suffix: 1000 + 25 = 1025.
      expect(dlg.getByText(/1\s*025\s*€/)).toBeInTheDocument()
    })
  })

  describe('income branch', () => {
    it('exceptional income shows RAV loss in red with new balance', async () => {
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildIncome({
            amount: 150,
            is_exceptional: true,
            estimated_income_id: undefined,
            estimated_income: undefined,
          })}
          type="income"
          currentRemainingToLive={1000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText('Cette suppression diminue :')).toBeInTheDocument()
      expect(dlg.getByText('Reste à vivre')).toBeInTheDocument()
      const coloredSpans = document.querySelectorAll('.text-red-600.font-semibold')
      expect(coloredSpans).toHaveLength(1)
      expect(coloredSpans[0]?.textContent).toMatch(/-150,00/)
      // New RAV balance suffix: 1000 - 150 = 850.
      expect(dlg.getByText(/850\s*€/)).toBeInTheDocument()
    })

    it('regular income, cumul stays above estimated after delete: full delta (-amount)', async () => {
      // cumulReal=2000, estimated=1500, amount=200 → after=1800, max(1800,1500)=1800
      // before=max(2000,1500)=2000. Delta = -200. Full impact.
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildIncome({ amount: 200 })}
          type="income"
          incomeSourceContext={{ cumulRealAmount: 2000, estimatedAmount: 1500 }}
          currentRemainingToLive={3000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText(/Salaire Mai/)).toBeInTheDocument()
      expect(dlg.getByText('Impact :')).toBeInTheDocument()
      const coloredSpans = document.querySelectorAll('.text-red-600.font-semibold')
      expect(coloredSpans).toHaveLength(1)
      expect(coloredSpans[0]?.textContent).toMatch(/-200,00/)
      // New RAV balance: 3000 - 200 = 2800.
      expect(dlg.getByText(/2\s*800\s*€/)).toBeInTheDocument()
    })

    it('regular income, cumul descends below estimated after delete: partial delta', async () => {
      // cumulReal=1600, estimated=1500, amount=200 → after=1400, max(1400,1500)=1500
      // before=max(1600,1500)=1600. Delta = -100. Partial impact.
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildIncome({ amount: 200 })}
          type="income"
          incomeSourceContext={{ cumulRealAmount: 1600, estimatedAmount: 1500 }}
          currentRemainingToLive={3000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
        />,
      )
      await openDeleteDialog(user)

      const coloredSpans = document.querySelectorAll('.text-red-600.font-semibold')
      expect(coloredSpans).toHaveLength(1)
      expect(coloredSpans[0]?.textContent).toMatch(/-100,00/)
    })

    it('regular income, cumul already ≤ estimated: shows "ne sera pas affecté" without amount', async () => {
      // cumulReal=1400, estimated=1500, amount=200 → after=1200, max(1200,1500)=1500
      // before=max(1400,1500)=1500. Delta = 0. No impact.
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildIncome({ amount: 200 })}
          type="income"
          incomeSourceContext={{ cumulRealAmount: 1400, estimatedAmount: 1500 }}
          currentRemainingToLive={3000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText(/Salaire Mai/)).toBeInTheDocument()
      expect(dlg.getByText(/ne sera pas affecté/)).toBeInTheDocument()
      expect(document.querySelectorAll('.text-red-600.font-semibold')).toHaveLength(0)
    })

    it('regular income without incomeSourceContext: fallback informative text', async () => {
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildIncome({ amount: 200 })}
          type="income"
          incomeSourceContext={null}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText(/Salaire Mai/)).toBeInTheDocument()
      expect(dlg.getByText(/sera réajusté en conséquence/)).toBeInTheDocument()
      expect(document.querySelectorAll('.text-red-600.font-semibold')).toHaveLength(0)
    })
  })
})
