'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useRealExpenses } from '@/hooks/useRealExpenses'
import { useRealIncomes } from '@/hooks/useRealIncomes'
import TransactionListItem from './TransactionListItem'

interface TransactionTabsComponentProps {
  context?: 'profile' | 'group'
  onEditTransaction?: (transaction: any, type: 'expense' | 'income') => void
  className?: string
}

type TabType = 'expenses' | 'incomes'

/**
 * Component with tabs for displaying expenses and income transactions
 * Shows scrollable lists of real transactions with edit/delete functionality
 */
export default function TransactionTabsComponent({
  context,
  onEditTransaction,
  className
}: TransactionTabsComponentProps) {
  const [activeTab, setActiveTab] = useState<TabType>('expenses')

  // Hooks for managing transactions
  const {
    expenses,
    loading: expensesLoading,
    error: expensesError,
    deleteExpense
  } = useRealExpenses(context)

  const {
    incomes,
    loading: incomesLoading,
    error: incomesError,
    deleteIncome
  } = useRealIncomes(context)

  /**
   * Handle edit transaction action
   */
  const handleEditTransaction = (transaction: any, type: 'expense' | 'income') => {
    if (onEditTransaction) {
      onEditTransaction(transaction, type)
    }
  }

  /**
   * Get tab button styling
   */
  const getTabButtonClass = (tabType: TabType): string => {
    const baseClass = 'flex-1 py-4 px-6 text-sm font-medium text-center rounded-lg transition-all duration-200'

    if (activeTab === tabType) {
      return cn(
        baseClass,
        tabType === 'expenses'
          ? 'bg-red-50 text-red-700 border border-red-200'
          : 'bg-green-50 text-green-700 border border-green-200'
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
        <p className="text-sm text-gray-600">Chargement des transactions...</p>
      </div>
    </div>
  )

  /**
   * Render error state
   */
  const renderError = (error: string) => (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
      <div className="flex items-center space-x-2">
        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <div>
          <p className="text-red-800 font-medium">Erreur lors du chargement</p>
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      </div>
    </div>
  )

  /**
   * Render empty state
   */
  const renderEmptyState = (type: 'expenses' | 'incomes') => (
    <div className="text-center py-8">
      <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
        {type === 'expenses' ? (
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
          </svg>
        ) : (
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
          </svg>
        )}
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-1">
        {type === 'expenses' ? 'Aucune dépense' : 'Aucun revenu'}
      </h3>
      <p className="text-gray-600 text-sm">
        {type === 'expenses'
          ? 'Commencez par ajouter vos première dépenses'
          : 'Commencez par ajouter vos premiers revenus'
        }
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
              onEdit={(transaction) => handleEditTransaction(transaction, 'expense')}
              onDelete={deleteExpense}
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
              onEdit={(transaction) => handleEditTransaction(transaction, 'income')}
              onDelete={deleteIncome}
            />
          ))}
        </div>
      )
    }
  }

  return (
    <div className={cn('bg-white rounded-xl border border-gray-200 shadow-md flex flex-col', className)}>
      {/* Tab Navigation */}
      <div className="p-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex space-x-2 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('expenses')}
            className={getTabButtonClass('expenses')}
          >
            <div className="flex items-center justify-center space-x-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
              </svg>
              <span className="font-medium">Dépenses</span>
              {expenses.length > 0 && (
                <span className="bg-red-200 text-red-800 text-xs font-medium px-2 py-0.5 rounded-full">
                  {expenses.length}
                </span>
              )}
            </div>
          </button>

          <button
            onClick={() => setActiveTab('incomes')}
            className={getTabButtonClass('incomes')}
          >
            <div className="flex items-center justify-center space-x-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 11l5-5m0 0l5 5m-5-5v12" />
              </svg>
              <span className="font-medium">Revenus</span>
              {incomes.length > 0 && (
                <span className="bg-green-200 text-green-800 text-xs font-medium px-2 py-0.5 rounded-full">
                  {incomes.length}
                </span>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Tab Content - Scrollable */}
      <div className="p-3 flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto pb-2">
          {renderTransactionsList()}
        </div>
      </div>
    </div>
  )
}