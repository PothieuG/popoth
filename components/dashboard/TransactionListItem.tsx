'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import type { RealExpense } from '@/hooks/useRealExpenses'
import type { RealIncome } from '@/hooks/useRealIncomes'
import type { ProfileData } from '@/app/api/profile/route'
import DropdownMenu from '@/components/ui/DropdownMenu'
import ConfirmationDialog from '@/components/ui/ConfirmationDialog'
import UserAvatar from '@/components/ui/UserAvatar'

type Transaction = RealExpense | RealIncome

interface TransactionListItemProps {
  transaction: Transaction
  type: 'expense' | 'income'
  onEdit: (transaction: Transaction) => void
  onDelete: (transactionId: string) => Promise<boolean>
  context?: 'profile' | 'group'
  userProfile?: ProfileData | null
  /**
   * Pour un revenu régulier (estimated_income_id set + !is_exceptional), le
   * parent fournit le cumul des montants réels pour la même source + le
   * montant estimé de la source, afin que la modal de confirmation affiche
   * un delta RAV précis. Null/undefined pour les dépenses et revenus
   * exceptionnels (pas nécessaire dans ces branches).
   */
  incomeSourceContext?: { cumulRealAmount: number; estimatedAmount: number } | null
  /**
   * Reste à vivre courant — sert à afficher le solde post-suppression dans
   * la modal de confirmation. Null/undefined si non disponible (loading).
   */
  currentRemainingToLive?: number | null
  /**
   * Snapshot du budget destination — sert à afficher le solde post-suppression
   * et à calculer la portion RAV recréditée (déficit budgétaire absorbé).
   * Tous les montants sont au moment du décision (incluent cette dépense).
   * Null/undefined pour les revenus, dépenses exceptionnelles, ou budget supprimé.
   */
  budgetSnapshot?: {
    cumulatedSavings: number
    estimatedAmount: number
    spentAmount: number
  } | null
  /**
   * Montant actuel de la tirelire — sert à afficher le solde post-suppression
   * sur la ligne tirelire. Null/undefined si non disponible.
   */
  piggyBankAmount?: number | null
  className?: string
}

/**
 * Component for displaying individual transaction in the list
 * Shows transaction details with edit/delete actions via dropdown menu
 */
export default function TransactionListItem({
  transaction,
  type,
  onEdit,
  onDelete,
  context = 'profile',
  userProfile = null,
  incomeSourceContext = null,
  currentRemainingToLive = null,
  budgetSnapshot = null,
  piggyBankAmount = null,
  className,
}: TransactionListItemProps) {
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  /**
   * Format amount with euro symbol
   */
  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  /**
   * Format creation date with time for display
   */
  const formatDateWithTime = (dateString: string): string => {
    return new Date(dateString).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  /**
   * Get transaction category name (budget or income name, or "Exceptionnel")
   */
  const getCategoryName = (): string => {
    if (transaction.is_exceptional) {
      return 'Exceptionnel'
    }

    if (type === 'expense') {
      return (transaction as RealExpense).estimated_budget?.name || 'Budget supprimé'
    } else {
      return (transaction as RealIncome).estimated_income?.name || 'Revenu supprimé'
    }
  }

  /**
   * Get color for category text based on transaction type
   */
  const getCategoryTextColor = (): string => {
    if (transaction.is_exceptional) {
      return 'text-gray-600'
    } else {
      return 'text-blue-800'
    }
  }

  /**
   * Handle delete confirmation
   */
  const handleDeleteConfirm = async () => {
    setIsDeleting(true)
    try {
      const success = await onDelete(transaction.id)
      if (success) {
        setIsDeleteModalOpen(false)
      }
    } catch (error) {
      logger.error('Error deleting transaction:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  /**
   * Build the rich `details` ReactNode for the delete confirmation modal.
   * Layout: 3-column grid (label / amount / "→ new balance") per source line.
   *
   * 4 branches:
   *   - Budgeted expense: budget / savings / piggy / RAV lines (selon ce qui est > 0)
   *   - Exceptional expense: 1 RAV recovery line
   *   - Regular income (with context): RAV impact line via deficit math max-cap
   *   - Exceptional income: 1 RAV loss line
   *
   * RAV recovery formula (budgeted expense overflow case):
   *   spentAfter   = budgetSnapshot.spentAmount - amount_from_budget
   *   deficitBefore = max(0, spentAmount - estimated)
   *   deficitAfter  = max(0, spentAfter - estimated)
   *   ravRecovered  = deficitBefore - deficitAfter   (>= 0)
   *   budgetPortion = amount_from_budget - ravRecovered
   *
   * Returns undefined when no useful info is available.
   */
  const buildDeleteDetails = (): ReactNode | undefined => {
    if (type === 'expense') {
      return buildExpenseDeleteDetails()
    }
    return buildIncomeDeleteDetails()
  }

  const buildExpenseDeleteDetails = (): ReactNode | undefined => {
    const expense = transaction as RealExpense
    const ravBalance = currentRemainingToLive

    if (expense.is_exceptional) {
      const newRav = ravBalance != null ? ravBalance + expense.amount : null
      return (
        <div className="space-y-1 text-left">
          <p className="font-medium text-gray-700">Cette suppression recrédite :</p>
          {renderSourceRow({
            label: 'Reste à vivre',
            amount: expense.amount,
            amountColor: 'text-emerald-600',
            newBalanceText: newRav != null ? `→ ${formatAmountCompact(newRav)}` : null,
          })}
        </div>
      )
    }

    const piggyRecovered = expense.amount_from_piggy_bank ?? 0
    const savingsRecovered = expense.amount_from_budget_savings ?? 0
    const fromBudgetTotal = expense.amount_from_budget ?? expense.amount
    const budgetName = expense.estimated_budget?.name

    // Split fromBudget into "budget pool refill" + "RAV deficit recovery".
    let ravRecovered = 0
    let budgetPortion = fromBudgetTotal
    let newAvailableInBudget: number | null = null
    if (budgetSnapshot) {
      const { spentAmount, estimatedAmount } = budgetSnapshot
      const spentAfter = spentAmount - fromBudgetTotal
      const deficitBefore = Math.max(0, spentAmount - estimatedAmount)
      const deficitAfter = Math.max(0, spentAfter - estimatedAmount)
      ravRecovered = deficitBefore - deficitAfter
      budgetPortion = fromBudgetTotal - ravRecovered
      newAvailableInBudget = Math.max(0, estimatedAmount - spentAfter)
    }

    const hasAnyLine =
      budgetPortion > 0 || savingsRecovered > 0 || piggyRecovered > 0 || ravRecovered > 0
    if (!hasAnyLine) return undefined

    const newSavings =
      budgetSnapshot != null ? budgetSnapshot.cumulatedSavings + savingsRecovered : null
    const newPiggy = piggyBankAmount != null ? piggyBankAmount + piggyRecovered : null
    const newRav = ravBalance != null ? ravBalance + ravRecovered : null

    return (
      <div className="space-y-1 text-left">
        <p className="font-medium text-gray-700">Cette suppression recrédite :</p>
        {budgetPortion > 0 &&
          renderSourceRow({
            label: budgetName ? `Budget « ${budgetName} »` : 'Budget',
            amount: budgetPortion,
            amountColor: 'text-blue-600',
            newBalanceText:
              newAvailableInBudget != null && budgetSnapshot
                ? `→ ${formatAmountCompact(newAvailableInBudget)}/${formatAmountCompact(budgetSnapshot.estimatedAmount)}`
                : null,
          })}
        {savingsRecovered > 0 &&
          renderSourceRow({
            label: budgetName ? `Économies « ${budgetName} »` : 'Économies',
            amount: savingsRecovered,
            amountColor: 'text-emerald-600',
            newBalanceText: newSavings != null ? `→ ${formatAmountCompact(newSavings)}` : null,
          })}
        {piggyRecovered > 0 &&
          renderSourceRow({
            label: 'Tirelire',
            amount: piggyRecovered,
            amountColor: 'text-purple-600',
            newBalanceText: newPiggy != null ? `→ ${formatAmountCompact(newPiggy)}` : null,
          })}
        {ravRecovered > 0 &&
          renderSourceRow({
            label: 'Reste à vivre',
            amount: ravRecovered,
            amountColor: 'text-emerald-600',
            newBalanceText: newRav != null ? `→ ${formatAmountCompact(newRav)}` : null,
          })}
      </div>
    )
  }

  const buildIncomeDeleteDetails = (): ReactNode | undefined => {
    const income = transaction as RealIncome
    const ravBalance = currentRemainingToLive

    if (income.is_exceptional) {
      const newRav = ravBalance != null ? ravBalance - income.amount : null
      return (
        <div className="space-y-1 text-left">
          <p className="font-medium text-gray-700">Cette suppression diminue :</p>
          {renderSourceRow({
            label: 'Reste à vivre',
            amount: -income.amount,
            amountColor: 'text-red-600',
            newBalanceText: newRav != null ? `→ ${formatAmountCompact(newRav)}` : null,
          })}
        </div>
      )
    }

    const sourceName = income.estimated_income?.name
    const sourceLine = sourceName ? (
      <p>
        Revenu lié à <span className="font-semibold">« {sourceName} »</span>.
      </p>
    ) : null

    if (incomeSourceContext) {
      const { cumulRealAmount, estimatedAmount } = incomeSourceContext
      const contribBefore = Math.max(cumulRealAmount, estimatedAmount)
      const contribAfter = Math.max(cumulRealAmount - income.amount, estimatedAmount)
      const ravDelta = contribAfter - contribBefore // ≤ 0
      const newRav = ravBalance != null ? ravBalance + ravDelta : null

      if (ravDelta < 0) {
        return (
          <div className="space-y-1 text-left">
            {sourceLine}
            <p className="font-medium text-gray-700">Impact :</p>
            {renderSourceRow({
              label: 'Reste à vivre',
              amount: ravDelta,
              amountColor: 'text-red-600',
              newBalanceText: newRav != null ? `→ ${formatAmountCompact(newRav)}` : null,
            })}
          </div>
        )
      }
      return (
        <div className="space-y-1 text-left">
          {sourceLine}
          <p className="text-gray-600">
            Votre reste à vivre ne sera pas affecté (le revenu estimé tient déjà la base).
          </p>
        </div>
      )
    }

    return (
      <p>
        {sourceLine}
        Votre reste à vivre sera réajusté en conséquence.
      </p>
    )
  }

  /**
   * Render one source row inside the delete-details grid. The grid uses a
   * 3-column layout (label truncates / amount / new-balance suffix) so all
   * rows align visually across the breakdown.
   */
  const renderSourceRow = ({
    label,
    amount,
    amountColor,
    newBalanceText,
  }: {
    label: string
    amount: number
    amountColor: string
    newBalanceText: string | null
  }): ReactNode => (
    <div className="flex items-baseline gap-2">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn('shrink-0 font-semibold', amountColor)}>{formatAmount(amount)}</span>
      {newBalanceText && <span className="shrink-0 text-xs text-gray-500">{newBalanceText}</span>}
    </div>
  )

  /**
   * Compact formatter for the "→ new balance" suffix — omits the trailing
   * ",00" when amount is whole-euro, to keep the line on a single row at
   * 375px viewport. Always includes the € symbol. Manual strip of ",00" is
   * needed because some Intl ICU builds (Node/jsdom) ignore
   * `minimumFractionDigits: 0` for currency style.
   */
  const formatAmountCompact = (amount: number): string => {
    const formatted = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
    // Strip decimal suffix for whole amounts. Regex tolerates locale variants
    // (comma/period decimal separator + U+0020/U+00A0/U+202F currency spacing).
    if (Math.round(amount) === amount) {
      return formatted.replace(/[,.]\d{2}(\s*€)/, '$1')
    }
    return formatted
  }

  /**
   * Get dropdown menu items
   */
  const getDropdownItems = () => [
    {
      label: 'Modifier',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
      ),
      onClick: () => onEdit(transaction),
    },
    {
      label: 'Supprimer',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      ),
      onClick: () => setIsDeleteModalOpen(true),
      variant: 'danger' as const,
    },
  ]

  return (
    <>
      <div
        className={cn(
          'rounded-lg border border-gray-200 bg-white p-4 shadow-md transition-all duration-200',
          'hover:border-gray-300 hover:shadow-lg',
          className,
        )}
      >
        <div className="flex items-center justify-between">
          {/* Transaction Details */}
          <div className="flex min-w-0 flex-1 items-center space-x-2">
            {/* Avatar for group transactions */}
            {context === 'group' && (
              <div className="shrink-0">
                <UserAvatar profile={userProfile} size="sm" />
              </div>
            )}

            {/* 3-line layout */}
            <div className="min-w-0 flex-1 space-y-0.5">
              {/* Line 1: Amount - Description with breakdown badges */}
              <div className="flex items-baseline space-x-1.5">
                <span
                  className={cn(
                    'text-lg font-bold',
                    type === 'expense' ? 'text-red-600' : 'text-green-600',
                  )}
                >
                  {type === 'expense' ? '-' : '+'}
                  {formatAmount(transaction.amount)}
                </span>

                {/* Breakdown badges for expenses with smart allocation */}
                {type === 'expense' &&
                  (transaction as RealExpense).amount_from_piggy_bank !== undefined && (
                    <div className="flex items-center gap-1">
                      {(transaction as RealExpense).amount_from_piggy_bank! > 0 && (
                        <span className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                          🪙 {formatAmount((transaction as RealExpense).amount_from_piggy_bank!)}
                        </span>
                      )}
                      {(transaction as RealExpense).amount_from_budget_savings! > 0 && (
                        <span className="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                          💰{' '}
                          {formatAmount((transaction as RealExpense).amount_from_budget_savings!)}
                        </span>
                      )}
                    </div>
                  )}

                <span className="flex-1 truncate text-sm font-bold text-gray-900">
                  - {transaction.description}
                </span>
              </div>

              {/* Line 2: Category name with color */}
              <p className={cn('truncate text-sm font-medium', getCategoryTextColor())}>
                {getCategoryName()}
              </p>

              {/* Line 3: Date with time (very small) */}
              <p className="text-xs text-gray-500">{formatDateWithTime(transaction.created_at)}</p>
            </div>
          </div>

          {/* Actions dropdown - Bigger and centered */}
          <div className="ml-1.5 flex min-h-full shrink-0 items-center">
            <DropdownMenu
              items={getDropdownItems()}
              buttonClassName="p-3 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center h-full"
              buttonContent={
                <svg className="h-6 w-6 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                </svg>
              }
            />
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <ConfirmationDialog
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteConfirm}
        title={`Supprimer ${type === 'expense' ? 'cette dépense' : 'ce revenu'}`}
        message={`Êtes-vous sûr de vouloir supprimer "${transaction.description}" d'un montant de ${formatAmount(transaction.amount)} ? Cette action ne peut pas être annulée.`}
        details={buildDeleteDetails()}
        confirmText="Supprimer"
        loading={isDeleting}
        variant="danger"
      />
    </>
  )
}
