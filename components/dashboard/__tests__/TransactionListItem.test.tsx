import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import TransactionListItem from '../TransactionListItem'
import type { RealExpense } from '@/hooks/useRealExpenses'
import type { RealIncome } from '@/hooks/useRealIncomes'

// Sprint 2026-05-21 / Recap-Reuse-Delete-Confirmation — couvre le ReactNode
// `details` passé à ConfirmationDialog. Le breakdown 3-col historique (label
// / amount / "→ new balance") a été remplacé par le panel `<AfterOperationPanel
// compact>` partagé avec ExpenseBreakdownPreview. En mode compact (Sprint
// 2026-05-22 / Recap-Compact-And-Uniform) le header "Après opération" est
// masqué pour plus de discrétion dans la modal — les lignes
// Tirelire/Économies/Budget/RAV avec labels colorés par entité (pink/violet/
// orange/blue) et balances en noir (text-gray-900) restent intactes.
//
// 4 branches :
//   - Budgeted expense : Tirelire/Économies/RAV affichées si touchées,
//     Budget toujours affiché si snapshot dispo. Returns undefined sans
//     budgetSnapshot (impossible de calculer le post-state).
//   - Exceptional expense : 1 ligne RAV post-delete (+amount au RAV).
//   - Regular income (avec context) : ligne RAV post-delete si delta<0,
//     sinon message texte "ne sera pas affecté".
//   - Exceptional income : 1 ligne RAV post-delete (-amount au RAV).

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
  await user.click(screen.getByRole('button', { name: 'Supprimer' }))
}

/**
 * Scope queries to within the open ConfirmationDialog (role="dialog").
 */
const inDialog = () => within(screen.getByRole('dialog'))

describe('<TransactionListItem> delete confirmation details (Après-opération panel)', () => {
  describe('expense branch', () => {
    it('budgeted expense with savings + budget shows post-delete balances in panel', async () => {
      // amount=60, snapshot includes this expense (spent=40 own contribution)
      // → newSpent = 0, no deficit, no RAV row. piggyBankAmount not passed →
      // no Tirelire row even though piggy was recovered.
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildExpense()}
          type="expense"
          budgetSnapshot={{ cumulatedSavings: 100, estimatedAmount: 200, spentAmount: 40 }}
          currentRemainingToLive={1000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
          onToggleApplied={vi.fn(async () => 'applied' as const)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      // Savings row : label violet + new pool (100 + 15 = 115)
      expect(dlg.getByText('Économies')).toHaveClass('text-violet-600')
      expect(dlg.getByText(/115\s*€/)).toBeInTheDocument()

      // Budget row : orange label + bold name + "0 €/200 €" ratio
      expect(dlg.getByText('Budget')).toHaveClass('text-orange-600')
      expect(dlg.getByText('Courses')).toHaveClass('font-bold')
      expect(dlg.getByText(/0\s*€\/200\s*€/)).toBeInTheDocument()

      // No piggy row (piggyBankAmount not provided), no RAV row (no deficit)
      expect(dlg.queryByText('Tirelire')).not.toBeInTheDocument()
      expect(dlg.queryByText('Reste à vivre')).not.toBeInTheDocument()
    })

    it('budgeted expense with overflow shows RAV recovery in panel (200/300/100 case)', async () => {
      // User-reported scenario: budget=200, savings=300, expense=600 →
      // fromBudget=300 (200 in-budget + 100 overflow), fromSavings=300.
      // After delete: savings pool +300, budget 0/200, RAV +100.
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
          onToggleApplied={vi.fn(async () => 'applied' as const)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      // Savings : 0 + 300 = 300
      expect(dlg.getByText('Économies')).toHaveClass('text-violet-600')
      expect(dlg.getByText(/^300\s*€$/)).toBeInTheDocument()

      // Budget : "0/200"
      expect(dlg.getByText('Budget')).toHaveClass('text-orange-600')
      expect(dlg.getByText(/0\s*€\/200\s*€/)).toBeInTheDocument()

      // RAV : 1050 + 100 = 1150
      expect(dlg.getByText('Reste à vivre')).toHaveClass('text-blue-600')
      expect(dlg.getByText(/1\s*150\s*€/)).toBeInTheDocument()
    })

    it('budgeted expense with only budget > 0 shows just budget row in panel', async () => {
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
          onToggleApplied={vi.fn(async () => 'applied' as const)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText('Budget')).toBeInTheDocument()
      expect(dlg.queryByText('Économies')).not.toBeInTheDocument()
      expect(dlg.queryByText('Tirelire')).not.toBeInTheDocument()
      expect(dlg.queryByText('Reste à vivre')).not.toBeInTheDocument()
    })

    it('budgeted expense without budgetSnapshot: no panel rendered (cannot compute post-state)', async () => {
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
          // No budgetSnapshot → buildExpenseDeleteDetails returns undefined
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
          onToggleApplied={vi.fn(async () => 'applied' as const)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      // Compact mode drops the "Après opération" header, so we assert
      // absence of the Reste à vivre label as the panel-absence indicator.
      expect(dlg.queryByText('Reste à vivre')).not.toBeInTheDocument()
      expect(dlg.queryByText('Budget')).not.toBeInTheDocument()
    })

    it('legacy budgeted expense (no amount_from_* fields) + snapshot: falls back to expense.amount', async () => {
      // amount=80, no breakdown fields → fromBudgetTotal = 80.
      // snapshot: spent=80 (this is the only expense), estimated=200 → newSpent=0.
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
          budgetSnapshot={{ cumulatedSavings: 0, estimatedAmount: 200, spentAmount: 80 }}
          currentRemainingToLive={1000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
          onToggleApplied={vi.fn(async () => 'applied' as const)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      // Budget row : "0/200" (80 - 80 = 0 spent post-delete)
      expect(dlg.getByText('Budget')).toHaveClass('text-orange-600')
      expect(dlg.getByText(/0\s*€\/200\s*€/)).toBeInTheDocument()
    })

    it('exceptional expense shows RAV-only row in panel (no breakdown)', async () => {
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
          onToggleApplied={vi.fn(async () => 'applied' as const)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText('Reste à vivre')).toHaveClass('text-blue-600')
      // RAV after delete: 1000 + 25 = 1025
      expect(dlg.getByText(/1\s*025\s*€/)).toBeInTheDocument()
      // No other rows
      expect(dlg.queryByText('Budget')).not.toBeInTheDocument()
      expect(dlg.queryByText('Économies')).not.toBeInTheDocument()
    })
  })

  describe('income branch', () => {
    it('exceptional income shows post-delete RAV in panel (lower than before)', async () => {
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
          onToggleApplied={vi.fn(async () => 'applied' as const)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText('Reste à vivre')).toHaveClass('text-blue-600')
      // RAV after delete: 1000 - 150 = 850
      expect(dlg.getByText(/850\s*€/)).toBeInTheDocument()
    })

    it('regular income, cumul stays above estimated after delete: full delta on RAV', async () => {
      // cumulReal=2000, estimated=1500, amount=200 → after=1800, max(1800,1500)=1800
      // before=max(2000,1500)=2000. Delta = -200. newRav = 3000 - 200 = 2800.
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildIncome({ amount: 200 })}
          type="income"
          incomeSourceContext={{ cumulRealAmount: 2000, estimatedAmount: 1500 }}
          currentRemainingToLive={3000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
          onToggleApplied={vi.fn(async () => 'applied' as const)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      // Sprint 2026-05-22 / Delete-Header-And-Income-Concise : "Revenu lié à"
      // sourceLine droppée pour rester concis. Header "Après suppression :"
      // ajouté au-dessus du panel.
      expect(dlg.getByText('Après suppression :')).toBeInTheDocument()
      expect(dlg.queryByText(/Salaire Mai/)).not.toBeInTheDocument()

      expect(dlg.getByText('Reste à vivre')).toHaveClass('text-blue-600')
      expect(dlg.getByText(/2\s*800\s*€/)).toBeInTheDocument()
    })

    it('regular income, cumul descends below estimated after delete: partial delta', async () => {
      // cumulReal=1600, estimated=1500, amount=200 → after=1400, max(1400,1500)=1500
      // before=max(1600,1500)=1600. Delta = -100. newRav = 3000 - 100 = 2900.
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildIncome({ amount: 200 })}
          type="income"
          incomeSourceContext={{ cumulRealAmount: 1600, estimatedAmount: 1500 }}
          currentRemainingToLive={3000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
          onToggleApplied={vi.fn(async () => 'applied' as const)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.getByText('Reste à vivre')).toHaveClass('text-blue-600')
      expect(dlg.getByText(/2\s*900\s*€/)).toBeInTheDocument()
    })

    it('regular income, cumul already ≤ estimated: shows "ne sera pas affecté" without panel', async () => {
      // cumulReal=1400, estimated=1500, amount=200 → after=1200, max(1200,1500)=1500
      // before=max(1400,1500)=1500. Delta = 0. No RAV row, just text fallback.
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildIncome({ amount: 200 })}
          type="income"
          incomeSourceContext={{ cumulRealAmount: 1400, estimatedAmount: 1500 }}
          currentRemainingToLive={3000}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
          onToggleApplied={vi.fn(async () => 'applied' as const)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.queryByText(/Salaire Mai/)).not.toBeInTheDocument()
      expect(dlg.getByText('Après suppression :')).toBeInTheDocument()
      expect(dlg.getByText(/ne sera pas affecté/)).toBeInTheDocument()
      // Sprint 2026-05-22 / Delete-Header-And-Income-Concise : "reste à vivre"
      // (lowercase) colored in blue inline. Use queryByText with the lowercase
      // form to assert the colored span. Note : capital "Reste à vivre" (panel
      // EntityLabel) is absent since no panel renders here.
      expect(dlg.queryByText('Reste à vivre')).not.toBeInTheDocument()
      expect(dlg.getByText('reste à vivre')).toHaveClass('text-blue-600')
    })

    it('regular income without incomeSourceContext: fallback informative text, no panel', async () => {
      const user = userEvent.setup()
      render(
        <TransactionListItem
          transaction={buildIncome({ amount: 200 })}
          type="income"
          incomeSourceContext={null}
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
          onToggleApplied={vi.fn(async () => 'applied' as const)}
        />,
      )
      await openDeleteDialog(user)
      const dlg = inDialog()

      expect(dlg.queryByText(/Salaire Mai/)).not.toBeInTheDocument()
      expect(dlg.getByText('Après suppression :')).toBeInTheDocument()
      expect(dlg.getByText(/sera réajusté en conséquence/)).toBeInTheDocument()
      expect(dlg.getByText('reste à vivre')).toHaveClass('text-blue-600')
      // Compact mode drops the "Après opération" header, so we assert
      // absence of the Reste à vivre label as the panel-absence indicator.
      expect(dlg.queryByText('Reste à vivre')).not.toBeInTheDocument()
    })
  })
})

// Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23). Couvre le rendu
// applied/not + interactions long-press + dropdown entries + dropdown
// Supprimer disabled. Pattern miroir des tests delete-confirmation : on
// utilise userEvent pour clicks et fireEvent pour pointer events bas-niveau
// (userEvent ne simule pas pointerdown/up sustained avec timer).
describe('<TransactionListItem> apply-to-balance (long-press toggle)', () => {
  const expenseDefaults = buildExpense({ amount_from_piggy_bank: 0, amount_from_budget_savings: 0 })

  it('non-applied expense renders bg-white + aria-pressed=false', () => {
    const { container } = render(
      <TransactionListItem
        transaction={expenseDefaults}
        type="expense"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={vi.fn(async () => 'applied' as const)}
      />,
    )
    const root = container.querySelector('[role="button"]')
    expect(root).not.toBeNull()
    expect(root).toHaveAttribute('aria-pressed', 'false')
    expect(root?.className).toMatch(/bg-white/)
  })

  it('applied expense renders bg-red-50 + aria-pressed=true', () => {
    const { container } = render(
      <TransactionListItem
        transaction={buildExpense({ applied_to_balance_at: '2026-05-23T10:00:00Z' })}
        type="expense"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={vi.fn(async () => 'unapplied' as const)}
      />,
    )
    const root = container.querySelector('[role="button"]')
    expect(root).toHaveAttribute('aria-pressed', 'true')
    expect(root?.className).toMatch(/bg-red-50/)
  })

  it('applied income renders bg-green-50', () => {
    const { container } = render(
      <TransactionListItem
        transaction={buildIncome({ applied_to_balance_at: '2026-05-23T10:00:00Z' })}
        type="income"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={vi.fn(async () => 'unapplied' as const)}
      />,
    )
    const root = container.querySelector('[role="button"]')
    expect(root?.className).toMatch(/bg-green-50/)
  })

  it('dropdown shows "Appliquer au solde" when not applied + calls onToggleApplied(id, true)', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn(async () => 'applied' as const)
    render(
      <TransactionListItem
        transaction={expenseDefaults}
        type="expense"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={onToggle}
      />,
    )
    await user.click(screen.getByLabelText('Options'))
    const applyBtn = screen.getByRole('button', { name: 'Appliquer au solde' })
    await user.click(applyBtn)
    expect(onToggle).toHaveBeenCalledWith(expenseDefaults.id, true)
  })

  it('dropdown shows "Retirer du solde" when applied + calls onToggleApplied(id, false)', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn(async () => 'unapplied' as const)
    const applied = buildExpense({ applied_to_balance_at: '2026-05-23T10:00:00Z' })
    render(
      <TransactionListItem
        transaction={applied}
        type="expense"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={onToggle}
      />,
    )
    await user.click(screen.getByLabelText('Options'))
    const removeBtn = screen.getByRole('button', { name: 'Retirer du solde' })
    await user.click(removeBtn)
    expect(onToggle).toHaveBeenCalledWith(applied.id, false)
  })

  it('dropdown "Supprimer" is disabled when transaction is applied', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn(async () => true)
    render(
      <TransactionListItem
        transaction={buildExpense({ applied_to_balance_at: '2026-05-23T10:00:00Z' })}
        type="expense"
        onEdit={vi.fn()}
        onDelete={onDelete}
        onToggleApplied={vi.fn(async () => 'unapplied' as const)}
      />,
    )
    await user.click(screen.getByLabelText('Options'))
    const deleteBtn = screen.getByRole('button', { name: 'Supprimer' })
    expect(deleteBtn).toBeDisabled()
    // Clicking the disabled button should NOT invoke onDelete (and the dialog
    // should not open). userEvent.click respects pointer-events:none ; we
    // assert that the dialog is not rendered after the click attempt.
    await user.click(deleteBtn).catch(() => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })

  describe('long-press gesture', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('long-press 800ms on a non-applied expense fires onToggleApplied(id, true)', async () => {
      const onToggle = vi.fn(async () => 'applied' as const)
      const { container } = render(
        <TransactionListItem
          transaction={expenseDefaults}
          type="expense"
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
          onToggleApplied={onToggle}
        />,
      )
      const root = container.querySelector('[role="button"]') as HTMLElement
      expect(root).not.toBeNull()

      fireEvent.pointerDown(root, { pointerType: 'touch' })
      await act(async () => {
        vi.advanceTimersByTime(800)
      })
      expect(onToggle).toHaveBeenCalledWith(expenseDefaults.id, true)
    })

    it('release before 800ms cancels the long-press (no toggle)', async () => {
      const onToggle = vi.fn(async () => 'applied' as const)
      const { container } = render(
        <TransactionListItem
          transaction={expenseDefaults}
          type="expense"
          onEdit={vi.fn()}
          onDelete={vi.fn(async () => true)}
          onToggleApplied={onToggle}
        />,
      )
      const root = container.querySelector('[role="button"]') as HTMLElement

      fireEvent.pointerDown(root, { pointerType: 'touch' })
      await act(async () => {
        vi.advanceTimersByTime(400)
      })
      fireEvent.pointerUp(root, { pointerType: 'touch' })
      await act(async () => {
        vi.advanceTimersByTime(800)
      })
      expect(onToggle).not.toHaveBeenCalled()
    })
  })
})
