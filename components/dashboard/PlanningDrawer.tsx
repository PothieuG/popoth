'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import AddBudgetDialog from './AddBudgetDialog'
import AddIncomeDialog from './AddIncomeDialog'
import EditBudgetDialog from './EditBudgetDialog'
import EditIncomeDialog from './EditIncomeDialog'
import DropdownMenu from '../ui/DropdownMenu'
import ConfirmationDialog from '../ui/ConfirmationDialog'
import BudgetProgressIndicator from './BudgetProgressIndicator'
import IncomeProgressIndicator from './IncomeProgressIndicator'
import { useBudgets } from '@/hooks/useBudgets'
import { useIncomes } from '@/hooks/useIncomes'
import { useBudgetProgress } from '@/hooks/useBudgetProgress'
import { useIncomeProgress } from '@/hooks/useIncomeProgress'

interface PlanningDrawerProps {
  isOpen: boolean
  onClose: () => void
  onPlanningChange?: () => Promise<void>
  context?: 'profile' | 'group'
}

type TabType = 'budgets' | 'revenus'

/**
 * Drawer de planification financière qui s'ouvre du bas vers le haut
 * Contient deux tabs : budgets estimés et revenus estimés
 */
export default function PlanningDrawer({ isOpen, onClose, onPlanningChange, context }: PlanningDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('budgets')
  const [isAddBudgetOpen, setIsAddBudgetOpen] = useState(false)
  const [isAddIncomeOpen, setIsAddIncomeOpen] = useState(false)

  // États pour l'édition
  const [isEditBudgetOpen, setIsEditBudgetOpen] = useState(false)
  const [isEditIncomeOpen, setIsEditIncomeOpen] = useState(false)
  const [editingBudget, setEditingBudget] = useState<any>(null)
  const [editingIncome, setEditingIncome] = useState<any>(null)

  // États pour la confirmation de suppression
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [deletingItem, setDeletingItem] = useState<{ id: string; name: string; type: 'budget' | 'income' } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // États pour la popup d'information des budgets/revenus entamés
  const [isStartedItemInfoOpen, setIsStartedItemInfoOpen] = useState(false)
  const [startedItemInfo, setStartedItemInfo] = useState<{ name: string; type: 'budget' | 'income' } | null>(null)
  
  // Hooks pour la gestion des données
  const {
    budgets,
    loading: budgetsLoading,
    error: budgetsError,
    addBudget,
    updateBudget,
    deleteBudget,
    refreshBudgets,
    totalBudgets
  } = useBudgets(context)

  const {
    incomes,
    loading: incomesLoading,
    error: incomesError,
    addIncome,
    updateIncome,
    deleteIncome,
    refreshIncomes,
    totalIncomes
  } = useIncomes(context)

  // Hooks pour les calculs de progression
  const {
    budgetProgresses,
    loading: budgetProgressLoading,
    refreshProgress: refreshBudgetProgress
  } = useBudgetProgress(budgets, context)

  const {
    incomeProgresses,
    loading: incomeProgressLoading,
    refreshProgress: refreshIncomeProgress
  } = useIncomeProgress(incomes, context)

  // Refresh des données quand le drawer s'ouvre
  useEffect(() => {
    if (isOpen) {
      refreshBudgets()
      refreshIncomes()
      refreshBudgetProgress()
      refreshIncomeProgress()
    }
  }, [isOpen, refreshBudgets, refreshIncomes, refreshBudgetProgress, refreshIncomeProgress])

  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2
    }).format(amount)
  }

  /**
   * Gestion de l'ajout d'un nouveau budget
   */
  const handleAddBudget = async (budgetData: { name: string; estimatedAmount: number }) => {
    const success = await addBudget(budgetData)
    if (success) {
      // Le dialog se ferme automatiquement dans AddBudgetDialog
      setIsAddBudgetOpen(false)

      // Rafraîchir les progressions des budgets
      await refreshBudgetProgress()

      // Rafraîchir les données financières du dashboard
      if (onPlanningChange) {
        await onPlanningChange()
      }
    }
    // En cas d'erreur, le hook gère déjà l'état d'erreur
  }

  /**
   * Gestion de l'ajout d'un nouveau revenu
   */
  const handleAddIncome = async (incomeData: { name: string; estimatedAmount: number }) => {
    const success = await addIncome(incomeData)
    if (success) {
      // Le dialog se ferme automatiquement dans AddIncomeDialog
      setIsAddIncomeOpen(false)

      // Rafraîchir les progressions des revenus
      await refreshIncomeProgress()

      // Rafraîchir les données financières du dashboard
      if (onPlanningChange) {
        await onPlanningChange()
      }
    }
    // En cas d'erreur, le hook gère déjà l'état d'erreur
  }

  /**
   * Gestion de l'édition d'un budget
   */
  const handleEditBudget = (budget: any) => {
    // Vérifier si le budget est entamé
    if (isBudgetStarted(budget.id)) {
      handleStartedItemAction(budget, 'budget')
      return
    }

    setEditingBudget(budget)
    setIsEditBudgetOpen(true)
  }

  /**
   * Gestion de l'édition d'un revenu
   */
  const handleEditIncome = (income: any) => {
    // Vérifier si le revenu est entamé
    if (isIncomeStarted(income.id)) {
      handleStartedItemAction(income, 'income')
      return
    }

    setEditingIncome(income)
    setIsEditIncomeOpen(true)
  }

  /**
   * Gestion de la sauvegarde d'un budget édité
   */
  const handleSaveEditedBudget = async (budgetData: { name: string; estimatedAmount: number }) => {
    if (!editingBudget) return false
    const success = await updateBudget(editingBudget.id, budgetData)
    if (success) {
      setIsEditBudgetOpen(false)
      setEditingBudget(null)

      // Rafraîchir les progressions des budgets
      await refreshBudgetProgress()

      // Rafraîchir les données financières du dashboard
      if (onPlanningChange) {
        await onPlanningChange()
      }
    }
    return success
  }

  /**
   * Gestion de la sauvegarde d'un revenu édité
   */
  const handleSaveEditedIncome = async (incomeData: { name: string; estimatedAmount: number }) => {
    if (!editingIncome) return false
    const success = await updateIncome(editingIncome.id, incomeData)
    if (success) {
      setIsEditIncomeOpen(false)
      setEditingIncome(null)

      // Rafraîchir les progressions des revenus
      await refreshIncomeProgress()

      // Rafraîchir les données financières du dashboard
      if (onPlanningChange) {
        await onPlanningChange()
      }
    }
    return success
  }

  /**
   * Vérifie si un budget est "entamé" (a des dépenses associées)
   */
  const isBudgetStarted = (budgetId: string): boolean => {
    const progress = budgetProgresses.find(p => p.budgetId === budgetId)
    return progress ? progress.spentAmount > 0 : false
  }

  /**
   * Vérifie si un revenu est "entamé" (a des entrées associées)
   */
  const isIncomeStarted = (incomeId: string): boolean => {
    const progress = incomeProgresses.find(p => p.incomeId === incomeId)
    return progress ? progress.receivedAmount > 0 : false
  }

  /**
   * Gestion des actions sur les items entamés
   */
  const handleStartedItemAction = (item: { name: string }, type: 'budget' | 'income') => {
    setStartedItemInfo({ name: item.name, type })
    setIsStartedItemInfoOpen(true)
  }

  /**
   * Demande de confirmation de suppression
   */
  const handleRequestDelete = (item: { id: string; name: string }, type: 'budget' | 'income') => {
    // Vérifier si l'item est entamé
    const isStarted = type === 'budget' ? isBudgetStarted(item.id) : isIncomeStarted(item.id)

    if (isStarted) {
      handleStartedItemAction(item, type)
      return
    }

    setDeletingItem({ id: item.id, name: item.name, type })
    setIsDeleteConfirmOpen(true)
  }

  /**
   * Confirmation de la suppression
   */
  const handleConfirmDelete = async () => {
    if (!deletingItem) return

    setIsDeleting(true)
    let success = false

    if (deletingItem.type === 'budget') {
      success = await deleteBudget(deletingItem.id)
    } else {
      success = await deleteIncome(deletingItem.id)
    }

    if (success) {
      setIsDeleteConfirmOpen(false)
      setDeletingItem(null)

      // Rafraîchir les progressions selon le type
      if (deletingItem.type === 'budget') {
        await refreshBudgetProgress()
      } else {
        await refreshIncomeProgress()
      }

      // Rafraîchir les données financières du dashboard
      if (onPlanningChange) {
        await onPlanningChange()
      }
    }
    setIsDeleting(false)
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

        {/* Header avec background color léger */}
        <div className="px-4 py-3 border-b border-gray-200 bg-blue-50/80">
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
          {/* Error Messages */}
          {(budgetsError || incomesError) && (
            <div className="p-4">
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-red-800 text-sm font-medium">
                  {budgetsError || incomesError}
                </p>
              </div>
            </div>
          )}

          {/* Budgets Tab Content */}
          {activeTab === 'budgets' && (
            <div className="p-4 space-y-4">
              {budgetsLoading && (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Budgets Estimés</h3>
                <button 
                  onClick={() => setIsAddBudgetOpen(true)}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors"
                >
                  Ajouter un budget
                </button>
              </div>

              {/* Total discret */}
              <div className="px-3 py-2 bg-orange-50/50 rounded-lg border border-orange-100">
                <p className="text-sm text-orange-700">
                  Total estimé: <span className="font-medium">{formatAmount(totalBudgets)}</span> (sans les économies)
                </p>
              </div>
              
              {/* Budgets List or Empty State */}
              {!budgetsLoading && budgets.length === 0 ? (
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
                  <button 
                    onClick={() => setIsAddBudgetOpen(true)}
                    className="px-6 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors"
                  >
                    Créer votre premier budget
                  </button>
                </div>
              ) : (!budgetsLoading && !budgetProgressLoading) ? (
                <div className="space-y-3">
                  {budgets.map((budget) => {
                    const progress = budgetProgresses.find(p => p.budgetId === budget.id)
                    if (!progress) return null

                    return (
                      <div key={budget.id} className="p-3 border border-gray-200 rounded-xl shadow-md">
                        <div className="flex justify-between items-center">
                          {/* Indicateur de progression intégré */}
                          <div className="flex-1">
                            <BudgetProgressIndicator progress={progress} />
                          </div>

                          {/* Menu dropdown */}
                          <div className="ml-2">
                            <DropdownMenu
                              items={[
                                {
                                  label: 'Modifier',
                                  icon: (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                  ),
                                  onClick: () => handleEditBudget(budget),
                                  disabled: isBudgetStarted(budget.id)
                                },
                                {
                                  label: 'Supprimer',
                                  icon: (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  ),
                                  onClick: () => handleRequestDelete(budget, 'budget'),
                                  variant: 'danger' as const,
                                  disabled: isBudgetStarted(budget.id)
                                }
                              ]}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )}

          {/* Revenus Tab Content */}
          {activeTab === 'revenus' && (
            <div className="p-4 space-y-4">
              {incomesLoading && (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Revenus Estimés</h3>
                <button 
                  onClick={() => setIsAddIncomeOpen(true)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                >
                  Ajouter un revenu
                </button>
              </div>

              {/* Total discret */}
              <div className="px-3 py-2 bg-green-50/50 rounded-lg border border-green-100">
                <p className="text-sm text-green-700">
                  Total estimé: <span className="font-medium">{formatAmount(totalIncomes)}</span> (sans les économies)
                </p>
              </div>
              
              {/* Incomes List or Empty State */}
              {!incomesLoading && incomes.length === 0 ? (
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
                  <button 
                    onClick={() => setIsAddIncomeOpen(true)}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                  >
                    Ajouter votre premier revenu
                  </button>
                </div>
              ) : (!incomesLoading && !incomeProgressLoading) ? (
                <div className="space-y-3">
                  {incomes.map((income) => {
                    const progress = incomeProgresses.find(p => p.incomeId === income.id)
                    if (!progress) return null

                    return (
                      <div key={income.id} className="p-3 border border-gray-200 rounded-xl shadow-md">
                        <div className="flex justify-between items-center">
                          {/* Indicateur de progression intégré */}
                          <div className="flex-1">
                            <IncomeProgressIndicator progress={progress} />
                          </div>

                          {/* Menu dropdown */}
                          <div className="ml-2">
                            <DropdownMenu
                              items={[
                                {
                                  label: 'Modifier',
                                  icon: (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                  ),
                                  onClick: () => handleEditIncome(income),
                                  disabled: isIncomeStarted(income.id)
                                },
                                {
                                  label: 'Supprimer',
                                  icon: (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  ),
                                  onClick: () => handleRequestDelete(income, 'income'),
                                  variant: 'danger' as const,
                                  disabled: isIncomeStarted(income.id)
                                }
                              ]}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Bottom Summary - Always visible */}
        <div className="px-4 py-3 bg-gray-100/80 border-t border-gray-200">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-gray-600">Différence estimée</span>
            <span className={cn(
              "text-lg font-bold",
              totalIncomes - totalBudgets > 0 ? "text-green-700" : 
              totalIncomes - totalBudgets < 0 ? "text-red-700" : "text-gray-900"
            )}>
              {formatAmount(totalIncomes - totalBudgets)}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Revenus - Budgets</p>
        </div>

        {/* Add Budget Dialog */}
        <AddBudgetDialog
          isOpen={isAddBudgetOpen}
          onClose={() => setIsAddBudgetOpen(false)}
          onSave={handleAddBudget}
          currentBudgetsTotal={totalBudgets}
          totalEstimatedIncome={totalIncomes}
        />

        {/* Add Income Dialog */}
        <AddIncomeDialog
          isOpen={isAddIncomeOpen}
          onClose={() => setIsAddIncomeOpen(false)}
          onSave={handleAddIncome}
          currentIncomesTotal={totalIncomes}
        />

        {/* Edit Budget Dialog */}
        <EditBudgetDialog
          isOpen={isEditBudgetOpen}
          onClose={() => setIsEditBudgetOpen(false)}
          onSave={handleSaveEditedBudget}
          budget={editingBudget}
          currentBudgetsTotal={totalBudgets}
          totalEstimatedIncome={totalIncomes}
        />

        {/* Edit Income Dialog */}
        <EditIncomeDialog
          isOpen={isEditIncomeOpen}
          onClose={() => setIsEditIncomeOpen(false)}
          onSave={handleSaveEditedIncome}
          income={editingIncome}
          currentIncomesTotal={totalIncomes}
        />

        {/* Confirmation Dialog */}
        <ConfirmationDialog
          isOpen={isDeleteConfirmOpen}
          onClose={() => {
            setIsDeleteConfirmOpen(false)
            setDeletingItem(null)
          }}
          onConfirm={handleConfirmDelete}
          title="Confirmer la suppression"
          message={`Êtes-vous sûr de vouloir supprimer "${deletingItem?.name}" ? Cette action est irréversible.`}
          confirmText="Supprimer"
          cancelText="Annuler"
          variant="danger"
          loading={isDeleting}
        />

        {/* Information Dialog for Started Items */}
        <ConfirmationDialog
          isOpen={isStartedItemInfoOpen}
          onClose={() => {
            setIsStartedItemInfoOpen(false)
            setStartedItemInfo(null)
          }}
          onConfirm={() => {
            setIsStartedItemInfoOpen(false)
            setStartedItemInfo(null)
          }}
          title={`${startedItemInfo?.type === 'budget' ? 'Budget' : 'Revenu'} en cours d'utilisation`}
          message={`Le ${startedItemInfo?.type === 'budget' ? 'budget' : 'revenu'} "${startedItemInfo?.name}" ne peut pas être modifié ou supprimé car il est déjà en cours d'utilisation ce mois-ci. Vous pourrez le modifier le mois prochain.`}
          confirmText="Compris"
          cancelText={null}
          variant="info"
          loading={false}
        />
      </div>
    </>
  )
}