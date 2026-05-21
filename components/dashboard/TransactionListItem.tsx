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

/**
 * Sprint Group-Transaction-Creator-Avatar (2026-05-22) : pour le contexte
 * groupe, l'avatar de chaque ligne reflète le créateur réel de la transaction
 * (via `transaction.created_by` injecté par le JOIN profiles côté API), pas
 * l'utilisateur connecté. On reconstitue un `ProfileData` partiel à partir
 * des 3 champs lus par `<UserAvatar>` (first_name/last_name/avatar_url) +
 * defaults inertes pour le reste de la shape — UserAvatar n'utilise que ces
 * 3 champs. Pour les lignes legacy sans created_by (avant la migration), on
 * retourne `null` → UserAvatar affiche son placeholder natif `??`.
 */
function toCreatorProfile(
  createdBy: NonNullable<RealExpense['created_by'] | RealIncome['created_by']> | null | undefined,
): ProfileData | null {
  if (!createdBy) return null
  return {
    id: createdBy.id,
    first_name: createdBy.first_name ?? '',
    last_name: createdBy.last_name ?? '',
    salary: 0,
    group_id: null,
    group_name: null,
    avatar_url: createdBy.avatar_url,
    created_at: null,
    updated_at: null,
  }
}
import {
  AfterOperationPanel,
  BalanceRow,
  BudgetRecapRow,
  EntityLabel,
} from '@/components/dashboard/recap-rows'

type Transaction = RealExpense | RealIncome

interface TransactionListItemProps {
  transaction: Transaction
  type: 'expense' | 'income'
  onEdit: (transaction: Transaction) => void
  onDelete: (transactionId: string) => Promise<boolean>
  context?: 'profile' | 'group'
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
  incomeSourceContext = null,
  currentRemainingToLive = null,
  budgetSnapshot = null,
  piggyBankAmount = null,
  className,
}: TransactionListItemProps) {
  const creatorProfile = toCreatorProfile(transaction.created_by)
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
   * Get color for category text based on transaction type.
   * Sprint 2026-05-22 / Transaction-Line-Color-Refresh : la couleur de la
   * catégorie discrimine la nature de la transaction. Blue-700 pour les
   * transactions normales (budget ou source de revenu). Yellow-700 (gold
   * doux, pas flashy) pour les exceptionnelles — réutilise la teinte
   * "warning text" déjà installée dans le panel "Contribution non calculée"
   * pour rester dans la charte. La description reste en `text-gray-900`
   * comme ancre primaire (lisibilité mobile, hiérarchie visuelle).
   */
  const getCategoryTextColor = (): string => {
    if (transaction.is_exceptional) {
      return 'text-yellow-700'
    } else {
      return 'text-blue-700'
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
   * Construit le ReactNode `details` pour la modal de confirmation suppression.
   * Sprint 2026-05-22 / Delete-Header-And-Income-Concise :
   *   - "Après suppression :" header obligatoire au-dessus de chaque branche
   *     (panel ou texte fallback) pour clarifier ce que représente l'encart.
   *   - Income branches : drop le "Revenu lié à 'xxx'" line (concis), color
   *     "Reste à vivre" en blue dans les phrases fallback.
   *
   * 4 branches selon le type de transaction (cf. Sprint Recap-Reuse-Delete-
   * Confirmation 2026-05-21 pour le panel partagé avec ExpenseBreakdownPreview) :
   *   - Budgeted expense : balances post-delete dans `<AfterOperationPanel compact>`.
   *   - Exceptional expense : 1 ligne RAV post-delete dans le panel.
   *   - Regular income (avec contexte cumul) : 1 ligne RAV post-delete si
   *     ravDelta < 0 dans le panel, sinon phrase texte "RAV pas affecté".
   *   - Exceptional income : 1 ligne RAV post-delete dans le panel.
   *
   * Returns undefined quand aucun contexte (`budgetSnapshot` / `currentRav`)
   * n'est dispo pour calculer l'état post-delete.
   */
  const buildDeleteDetails = (): ReactNode | undefined => {
    const inner = type === 'expense' ? buildExpenseDeleteDetails() : buildIncomeDeleteDetails()
    if (inner == null) return undefined
    return (
      <div className="space-y-1.5 text-left">
        <p className="text-sm font-medium text-gray-700">Après suppression :</p>
        {inner}
      </div>
    )
  }

  const buildExpenseDeleteDetails = (): ReactNode | undefined => {
    const expense = transaction as RealExpense
    const ravBalance = currentRemainingToLive

    if (expense.is_exceptional) {
      if (ravBalance == null) return undefined
      const newRav = ravBalance + expense.amount
      return (
        <AfterOperationPanel compact>
          <BalanceRow label={<EntityLabel type="rav" />} amount={newRav} />
        </AfterOperationPanel>
      )
    }

    const piggyRecovered = expense.amount_from_piggy_bank ?? 0
    const savingsRecovered = expense.amount_from_budget_savings ?? 0
    const fromBudgetTotal = expense.amount_from_budget ?? expense.amount
    const budgetName = expense.estimated_budget?.name

    if (!budgetSnapshot) return undefined

    const { spentAmount, estimatedAmount, cumulatedSavings } = budgetSnapshot
    const newSpent = spentAmount - fromBudgetTotal
    const deficitBefore = Math.max(0, spentAmount - estimatedAmount)
    const deficitAfter = Math.max(0, newSpent - estimatedAmount)
    const ravRecovered = deficitBefore - deficitAfter
    const newSavings = cumulatedSavings + savingsRecovered
    const newPiggy = piggyBankAmount != null ? piggyBankAmount + piggyRecovered : null
    const newRav = ravBalance != null ? ravBalance + ravRecovered : null

    return (
      <AfterOperationPanel compact>
        {piggyRecovered > 0 && newPiggy != null && (
          <BalanceRow label={<EntityLabel type="piggy" />} amount={newPiggy} />
        )}
        {savingsRecovered > 0 && (
          <BalanceRow label={<EntityLabel type="savings" />} amount={newSavings} />
        )}
        {budgetName && (
          <BudgetRecapRow budgetName={budgetName} spent={newSpent} estimated={estimatedAmount} />
        )}
        {ravRecovered !== 0 && newRav != null && (
          <BalanceRow label={<EntityLabel type="rav" />} amount={newRav} />
        )}
      </AfterOperationPanel>
    )
  }

  const buildIncomeDeleteDetails = (): ReactNode | undefined => {
    const income = transaction as RealIncome
    const ravBalance = currentRemainingToLive

    if (income.is_exceptional) {
      if (ravBalance == null) return undefined
      const newRav = ravBalance - income.amount
      return (
        <AfterOperationPanel compact>
          <BalanceRow label={<EntityLabel type="rav" />} amount={newRav} />
        </AfterOperationPanel>
      )
    }

    if (incomeSourceContext) {
      const { cumulRealAmount, estimatedAmount } = incomeSourceContext
      const contribBefore = Math.max(cumulRealAmount, estimatedAmount)
      const contribAfter = Math.max(cumulRealAmount - income.amount, estimatedAmount)
      const ravDelta = contribAfter - contribBefore // ≤ 0
      const newRav = ravBalance != null ? ravBalance + ravDelta : null

      if (ravDelta < 0 && newRav != null) {
        return (
          <AfterOperationPanel compact>
            <BalanceRow label={<EntityLabel type="rav" />} amount={newRav} />
          </AfterOperationPanel>
        )
      }
      return (
        <p className="text-gray-600">
          Votre <span className="font-medium text-blue-600">reste à vivre</span> ne sera pas affecté
          (le revenu estimé tient déjà la base).
        </p>
      )
    }

    return (
      <p>
        Votre <span className="font-medium text-blue-600">reste à vivre</span> sera réajusté en
        conséquence.
      </p>
    )
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
          <div className="flex min-w-0 flex-1 items-center space-x-3">
            {/* Avatar of the transaction creator (group context only) */}
            {context === 'group' && (
              <div className="shrink-0">
                <UserAvatar profile={creatorProfile} size="sm" />
              </div>
            )}

            {/* 3-line layout */}
            <div className="min-w-0 flex-1 space-y-0.5">
              {/* Line 1: Amount with breakdown badges */}
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
              </div>

              {/* Line 2: Description — Category name (with em-dash separator) */}
              <p className="truncate text-sm">
                <span className="font-semibold text-gray-900">{transaction.description}</span>
                <span className="mx-1.5 text-gray-400">—</span>
                <span className={cn('font-medium', getCategoryTextColor())}>
                  {getCategoryName()}
                </span>
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
