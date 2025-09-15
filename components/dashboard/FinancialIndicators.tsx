'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import PlanningDrawer from './PlanningDrawer'
import SavingsDrawer from './SavingsDrawer'

interface FinancialIndicatorsProps {
  availableBalance: number
  remainingToLive: number
  totalSavings: number
  className?: string
  onPlanningChange?: () => Promise<void>
  context?: 'profile' | 'group'
}

/**
 * Component displaying two main financial indicators on the dashboard:
 * - Available Balance (visible money in bank account)
 * - Remaining to Live (money left after budget and exceptional expenses)
 */
export default function FinancialIndicators({
  availableBalance,
  remainingToLive,
  totalSavings,
  className,
  onPlanningChange,
  context
}: FinancialIndicatorsProps) {
  const [isPlanningOpen, setIsPlanningOpen] = useState(false)
  const [isSavingsOpen, setIsSavingsOpen] = useState(false)
  
  /**
   * Get color class based on amount value
   * Positive: green, Negative: red, Zero: gray
   */
  const getAmountColorClass = (amount: number): string => {
    if (amount > 0) return 'text-green-600'
    if (amount < 0) return 'text-red-600'
    return 'text-gray-500'
  }

  /**
   * Get background color class based on amount value
   * Positive: subtle green, Negative: subtle red, Zero: subtle gray with thicker borders
   */
  const getBackgroundColorClass = (amount: number): string => {
    if (amount > 0) return 'bg-green-50/50 border-green-300 border-2'
    if (amount < 0) return 'bg-red-50/50 border-red-300 border-2'
    return 'bg-gray-50/50 border-gray-300 border-2'
  }

  /**
   * Format amount to display with euro symbol and proper decimals
   */
  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2
    }).format(amount)
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Main Financial Indicators */}
      <div className="grid grid-cols-2 gap-3">
        {/* Available Balance Card */}
      <div className={cn(
        'p-2 rounded-xl shadow-sm transition-all duration-200',
        getBackgroundColorClass(availableBalance)
      )}>
        <div className="flex flex-col items-center text-center space-y-1">
          {/* Bank Account Icon */}
          <div className="flex-shrink-0">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center',
              availableBalance > 0 ? 'bg-green-600' : availableBalance < 0 ? 'bg-red-600' : 'bg-gray-500'
            )}>
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
          </div>
          
          {/* Content */}
          <div className="w-full min-w-0">
            <p className="text-xs font-medium text-gray-600 mb-1">
              Solde Disponible
            </p>
            <p className={cn(
              'text-lg font-bold truncate',
              getAmountColorClass(availableBalance)
            )}>
              {formatAmount(availableBalance)}
            </p>
          </div>
        </div>
      </div>

      {/* Remaining to Live Card */}
      <div className={cn(
        'p-2 rounded-xl shadow-sm transition-all duration-200',
        getBackgroundColorClass(remainingToLive)
      )}>
        <div className="flex flex-col items-center text-center space-y-1">
          {/* Calculator/Budget Icon */}
          <div className="flex-shrink-0">
            <div className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center',
              remainingToLive > 0 ? 'bg-green-600' : remainingToLive < 0 ? 'bg-red-600' : 'bg-gray-500'
            )}>
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
          
          {/* Content */}
          <div className="w-full min-w-0">
            <p className="text-xs font-medium text-gray-600 mb-1">
              Reste à Vivre
            </p>
            <p className={cn(
              'text-lg font-bold truncate',
              getAmountColorClass(remainingToLive)
            )}>
              {formatAmount(remainingToLive)}
            </p>
          </div>
        </div>
      </div>
      </div>

      {/* Total Savings Card */}
      <button
        onClick={() => setIsSavingsOpen(true)}
        className="w-full p-2 rounded-xl bg-gradient-to-r from-purple-50 to-purple-100 border border-purple-200 shadow-sm transition-all duration-200 cursor-pointer hover:from-purple-100 hover:to-purple-150"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* Information Icon */}
            <div className="flex-shrink-0">
              <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            
            {/* Content */}
            <div>
              <p className="text-sm font-medium text-purple-800">
                Montant total de vos économies: {formatAmount(totalSavings)}
              </p>
            </div>
          </div>
        </div>
      </button>

      {/* Planning Button Card */}
      <button 
        onClick={() => setIsPlanningOpen(true)}
        className="w-full p-2 rounded-xl bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 shadow-sm transition-all duration-200 cursor-pointer hover:from-blue-100 hover:to-blue-150"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* Planning Icon */}
            <div className="flex-shrink-0">
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
            </div>
            
            {/* Content */}
            <div>
              <p className="text-sm font-medium text-blue-800">
                Planification des revenus et budgets
              </p>
            </div>
          </div>
        </div>
      </button>

      {/* Planning Drawer */}
      <PlanningDrawer
        isOpen={isPlanningOpen}
        onClose={() => setIsPlanningOpen(false)}
        onPlanningChange={onPlanningChange}
        context={context}
      />

      {/* Savings Drawer */}
      <SavingsDrawer
        isOpen={isSavingsOpen}
        onClose={() => setIsSavingsOpen(false)}
      />
    </div>
  )
}