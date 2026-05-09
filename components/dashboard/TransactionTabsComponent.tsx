'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useRealExpenses, type RealExpense } from '@/hooks/useRealExpenses'
import { useRealIncomes, type RealIncome } from '@/hooks/useRealIncomes'
import type { ProfileData } from '@/app/api/profile/route'
import TransactionListItem from './TransactionListItem'

type EditableTransaction = RealExpense | RealIncome

interface TransactionTabsComponentProps {
  context?: 'profile' | 'group'
  userProfile?: ProfileData | null
  onEditTransaction?: (transaction: EditableTransaction, type: 'expense' | 'income') => void
  onTransactionDeleted?: () => void
  className?: string
}

type TabType = 'expenses' | 'incomes'

/**
 * Component with tabs for displaying expenses and income transactions
 * Shows scrollable lists of real transactions with edit/delete functionality
 */
export default function TransactionTabsComponent({
  context,
  userProfile,
  onEditTransaction,
  onTransactionDeleted,
  className,
}: TransactionTabsComponentProps) {
  const [activeTab, setActiveTab] = useState<TabType>('expenses')

  // Hooks for managing transactions
  const {
    expenses,
    loading: expensesLoading,
    error: expensesError,
    deleteExpense,
  } = useRealExpenses(context)

  const {
    incomes,
    loading: incomesLoading,
    error: incomesError,
    deleteIncome,
  } = useRealIncomes(context)

  /**
   * Handle delete expense with callback
   */
  const handleDeleteExpense = async (expenseId: string): Promise<boolean> => {
    console.log('🗑️ [TransactionTabs] Starting expense deletion:', expenseId)
    const success = await deleteExpense(expenseId)

    if (success) {
      console.log('✅ [TransactionTabs] Expense deleted successfully, triggering financial refresh')
      if (onTransactionDeleted) {
        // Use setTimeout to avoid immediate re-render during deletion
        setTimeout(() => {
          console.log('🔄 [TransactionTabs] Executing financial data refresh callback')
          onTransactionDeleted()
        }, 100)
      }
    } else {
      console.log('❌ [TransactionTabs] Expense deletion failed')
    }

    return success
  }

  /**
   * Handle delete income with callback
   */
  const handleDeleteIncome = async (incomeId: string): Promise<boolean> => {
    console.log('🗑️ [TransactionTabs] Starting income deletion:', incomeId)
    const success = await deleteIncome(incomeId)

    if (success) {
      console.log('✅ [TransactionTabs] Income deleted successfully, triggering financial refresh')
      if (onTransactionDeleted) {
        // Use setTimeout to avoid immediate re-render during deletion
        setTimeout(() => {
          console.log('🔄 [TransactionTabs] Executing financial data refresh callback')
          onTransactionDeleted()
        }, 100)
      }
    } else {
      console.log('❌ [TransactionTabs] Income deletion failed')
    }

    return success
  }

  /**
   * Handle edit transaction action
   */
  const handleEditTransaction = (transaction: EditableTransaction, type: 'expense' | 'income') => {
    if (onEditTransaction) {
      onEditTransaction(transaction, type)
    }
  }

  /**
   * Get tab button styling
   */
  const getTabButtonClass = (tabType: TabType): string => {
    const baseClass =
      'flex-1 py-4 px-6 text-sm font-medium text-center rounded-lg transition-all duration-200'

    if (activeTab === tabType) {
      return cn(
        baseClass,
        tabType === 'expenses'
          ? 'bg-red-50 text-red-700 border border-red-200'
          : 'bg-green-50 text-green-700 border border-green-200',
      )
    }

    return cn(baseClass, 'text-gray-600 hover:text-gray-800 hover:bg-gray-50')
  }

  /**
   * Render loading state
   */
  const renderLoading = () => (
    <div className="flex items-center justify-center py-8">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
        <p className="text-sm text-gray-600">Chargement des transactions...</p>
      </div>
    </div>
  )

  /**
   * Render error state
   */
  const renderError = (error: string) => (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-center space-x-2">
        <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
        <div>
          <p className="font-medium text-red-800">Erreur lors du chargement</p>
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    </div>
  )

  /**
   * Render empty state
   */
  const renderEmptyState = (type: 'expenses' | 'incomes') => (
    <div className="py-8 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        {type === 'expenses' ? (
          <svg
            className="h-8 w-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
            />
          </svg>
        ) : (
          <svg
            className="h-8 w-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
            />
          </svg>
        )}
      </div>
      <h3 className="mb-1 text-lg font-medium text-gray-900">
        {type === 'expenses' ? 'Aucune dépense' : 'Aucun revenu'}
      </h3>
      <p className="text-sm text-gray-600">
        {type === 'expenses'
          ? 'Commencez par ajouter vos première dépenses'
          : 'Commencez par ajouter vos premiers revenus'}
      </p>
    </div>
  )

  /**
   * Render transactions list
   */
  const renderTransactionsList = () => {
    if (activeTab === 'expenses') {
      if (expensesLoading) return renderLoading()
      if (expensesError) return renderError(expensesError)
      if (expenses.length === 0) return renderEmptyState('expenses')

      return (
        <div className="space-y-2">
          {expenses.map((expense) => (
            <TransactionListItem
              key={expense.id}
              transaction={expense}
              type="expense"
              context={context}
              userProfile={userProfile}
              onEdit={(transaction) => handleEditTransaction(transaction, 'expense')}
              onDelete={handleDeleteExpense}
            />
          ))}
        </div>
      )
    } else {
      if (incomesLoading) return renderLoading()
      if (incomesError) return renderError(incomesError)
      if (incomes.length === 0) return renderEmptyState('incomes')

      return (
        <div className="space-y-2">
          {incomes.map((income) => (
            <TransactionListItem
              key={income.id}
              transaction={income}
              type="income"
              context={context}
              userProfile={userProfile}
              onEdit={(transaction) => handleEditTransaction(transaction, 'income')}
              onDelete={handleDeleteIncome}
            />
          ))}
        </div>
      )
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-gray-200 bg-white shadow-md',
        className,
      )}
    >
      {/* Tab Navigation */}
      <div className="flex-shrink-0 border-b border-gray-200 p-3">
        <div className="flex space-x-2 rounded-lg bg-gray-50/100 p-1">
          <button
            onClick={() => setActiveTab('expenses')}
            className={getTabButtonClass('expenses')}
          >
            <div className="flex items-center justify-center space-x-2">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"
                />
              </svg>
              <span className="font-medium">Dépenses</span>
              {expenses.length > 0 && (
                <span className="rounded-full bg-red-200 px-2 py-0.5 text-xs font-medium text-red-800">
                  {expenses.length}
                </span>
              )}
            </div>
          </button>

          <button onClick={() => setActiveTab('incomes')} className={getTabButtonClass('incomes')}>
            <div className="flex items-center justify-center space-x-2">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M7 11l5-5m0 0l5 5m-5-5v12"
                />
              </svg>
              <span className="font-medium">Revenus</span>
              {incomes.length > 0 && (
                <span className="rounded-full bg-green-200 px-2 py-0.5 text-xs font-medium text-green-800">
                  {incomes.length}
                </span>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Tab Content - Scrollable */}
      <div className="flex-1 overflow-hidden p-3">
        <div className="h-full overflow-y-auto pb-2">{renderTransactionsList()}</div>
      </div>
    </div>
  )
}
