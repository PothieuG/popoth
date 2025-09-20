'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { RealExpense } from '@/hooks/useRealExpenses'
import { RealIncome } from '@/hooks/useRealIncomes'
import { ProfileData } from '@/app/api/profile/route'
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
  className
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
      minimumFractionDigits: 2
    }).format(amount)
  }

  /**
   * Format date to French locale with time
   */
  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  /**
   * Format creation date with time for display
   */
  const formatDateWithTime = (dateString: string): string => {
    return new Date(dateString).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  /**
   * Get the date field based on transaction type
   */
  const getTransactionDate = (): string => {
    if (type === 'expense') {
      return (transaction as RealExpense).expense_date
    } else {
      return (transaction as RealIncome).entry_date
    }
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
      console.error('Error deleting transaction:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  /**
   * Get dropdown menu items
   */
  const getDropdownItems = () => [
    {
      label: 'Modifier',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
      onClick: () => onEdit(transaction)
    },
    {
      label: 'Supprimer',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      onClick: () => setIsDeleteModalOpen(true),
      variant: 'danger' as const
    }
  ]

  return (
    <>
      <div className={cn(
        'p-4 bg-white rounded-lg border border-gray-200 shadow-md transition-all duration-200',
        'hover:shadow-lg hover:border-gray-300',
        className
      )}>
        <div className="flex items-center justify-between">
          {/* Transaction Details */}
          <div className="flex items-center space-x-3 flex-1 min-w-0">
            {/* Avatar for group transactions */}
            {context === 'group' && (
              <div className="flex-shrink-0">
                <UserAvatar
                  profile={userProfile}
                  size="sm"
                />
              </div>
            )}

            {/* 3-line layout */}
            <div className="flex-1 min-w-0 space-y-0.5">
              {/* Line 1: Amount - Description */}
              <div className="flex items-baseline space-x-2">
                <span className={cn(
                  'text-lg font-bold',
                  type === 'expense' ? 'text-red-600' : 'text-green-600'
                )}>
                  {type === 'expense' ? '-' : '+'}{formatAmount(transaction.amount)}
                </span>
                <span className="text-sm font-bold text-gray-900 truncate flex-1">
                  - {transaction.description}
                </span>
              </div>

              {/* Line 2: Category name with color */}
              <p className={cn(
                'text-sm font-medium truncate',
                getCategoryTextColor()
              )}>
                {getCategoryName()}
              </p>

              {/* Line 3: Date with time (very small) */}
              <p className="text-xs text-gray-500">
                {formatDateWithTime(transaction.created_at)}
              </p>
            </div>
          </div>

          {/* Actions dropdown - Bigger and centered */}
          <div className="flex-shrink-0 ml-2 flex items-center min-h-full">
            <DropdownMenu
              items={getDropdownItems()}
              buttonClassName="p-3 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center h-full"
              buttonContent={
                <svg className="w-6 h-6 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
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
        confirmText="Supprimer"
        isLoading={isDeleting}
        variant="danger"
      />
    </>
  )
}