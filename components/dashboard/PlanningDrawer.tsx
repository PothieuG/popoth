'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface PlanningDrawerProps {
  isOpen: boolean
  onClose: () => void
}

type TabType = 'budgets' | 'revenus'

/**
 * Drawer de planification financière qui s'ouvre du bas vers le haut
 * Contient deux tabs : budgets estimés et revenus estimés
 */
export default function PlanningDrawer({ isOpen, onClose }: PlanningDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('budgets')

  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2
    }).format(amount)
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div className={cn(
        'fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out',
        isOpen ? 'translate-y-0' : 'translate-y-full'
      )}>
        {/* Drag Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1 bg-gray-300 rounded-full"></div>
        </div>

        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Planification Financière</h2>
                <p className="text-sm text-gray-600">Gérez vos budgets et revenus</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="px-4 py-2 border-b border-gray-200">
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('budgets')}
              className={cn(
                'flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all duration-200',
                activeTab === 'budgets' 
                  ? 'bg-white text-orange-700 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <div className="flex items-center justify-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span>Budgets</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('revenus')}
              className={cn(
                'flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all duration-200',
                activeTab === 'revenus' 
                  ? 'bg-white text-green-700 shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <div className="flex items-center justify-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span>Revenus</span>
              </div>
            </button>
          </div>
        </div>

        {/* Content Area - Full height minus header and tabs */}
        <div className="h-[calc(100vh-200px)] overflow-y-auto">
          {/* Budgets Tab Content */}
          {activeTab === 'budgets' && (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Budgets Estimés</h3>
                <button className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors">
                  Ajouter un budget
                </button>
              </div>
              
              {/* Empty State */}
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto bg-orange-100 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <h4 className="text-lg font-medium text-gray-900 mb-2">Aucun budget configuré</h4>
                <p className="text-sm text-gray-600 mb-4">
                  Commencez par ajouter vos catégories de dépenses mensuelles
                </p>
                <button className="px-6 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors">
                  Créer votre premier budget
                </button>
              </div>
              
              {/* Summary */}
              <div className="mt-8 p-4 bg-orange-50 rounded-xl border border-orange-200">
                <h4 className="font-semibold text-orange-900 mb-2">Total des budgets estimés</h4>
                <p className="text-2xl font-bold text-orange-700">{formatAmount(0)}</p>
              </div>
            </div>
          )}

          {/* Revenus Tab Content */}
          {activeTab === 'revenus' && (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Revenus Estimés</h3>
                <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                  Ajouter un revenu
                </button>
              </div>
              
              {/* Empty State */}
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <h4 className="text-lg font-medium text-gray-900 mb-2">Aucun revenu configuré</h4>
                <p className="text-sm text-gray-600 mb-4">
                  Ajoutez vos sources de revenus mensuels récurrents
                </p>
                <button className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                  Ajouter votre premier revenu
                </button>
              </div>
              
              {/* Summary */}
              <div className="mt-8 p-4 bg-green-50 rounded-xl border border-green-200">
                <h4 className="font-semibold text-green-900 mb-2">Total des revenus estimés</h4>
                <p className="text-2xl font-bold text-green-700">{formatAmount(0)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Summary - Always visible */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-gray-600">Différence estimée</span>
            <span className="text-lg font-bold text-gray-900">{formatAmount(0)}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Revenus - Budgets</p>
        </div>
      </div>
    </>
  )
}