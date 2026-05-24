'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DRAWER_CONTENT_CLASSES } from '@/components/ui/drawer-content-classes'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { Skeleton } from '@/components/ui/skeleton'
import DropdownMenu from '../ui/DropdownMenu'
import BudgetProgressIndicator from './BudgetProgressIndicator'
import IncomeProgressIndicator from './IncomeProgressIndicator'

const AddBudgetDialog = dynamic(() => import('./AddBudgetDialog'), { ssr: false })
const AddIncomeDialog = dynamic(() => import('./AddIncomeDialog'), { ssr: false })
const EditBudgetDialog = dynamic(() => import('./EditBudgetDialog'), { ssr: false })
const EditIncomeDialog = dynamic(() => import('./EditIncomeDialog'), { ssr: false })
const ConfirmationDialog = dynamic(() => import('../ui/ConfirmationDialog'), { ssr: false })
import { useBudgets, type EstimatedBudget } from '@/hooks/useBudgets'
import { useIncomes, type EstimatedIncome } from '@/hooks/useIncomes'
import { useBudgetProgress } from '@/hooks/useBudgetProgress'
import { useIncomeProgress } from '@/hooks/useIncomeProgress'
import { usePeriodParam } from '@/hooks/usePeriodParam'
import type { ReadOnlyIncome } from '@/lib/finance'

interface PlanningDrawerProps {
  isOpen: boolean
  onClose: () => void
  onPlanningChange?: () => Promise<void>
  context?: 'profile' | 'group'
  /**
   * Sprint 16 Monthly Recap V3 — lignes virtuelles read-only à afficher en
   * tête de la liste des revenus estimés (salaire en perso, contribution
   * groupe en groupe). Source de vérité backend (`FinancialData.meta`),
   * forward via `<FinancialIndicators>`. Présentation-only : aucun bouton
   * Modifier/Supprimer, juste cadre + label + montant + cadenas.
   */
  readOnlyIncomes?: ReadOnlyIncome[]
}

type TabType = 'budgets' | 'revenus'

/**
 * Drawer de planification financière qui s'ouvre du bas vers le haut.
 * Contient deux tabs : budgets estimés et revenus estimés.
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) with heavy className override
 * on `<DialogContent>` to preserve the bottom-up drawer feel : fullscreen sizing,
 * border-less + radius-less + shadow-less, slide-from-bottom animation via
 * `data-[state=open]:slide-in-from-bottom`. Native focus trap + Esc-to-close +
 * return-focus + role=dialog + aria-modal acquis.
 *
 * Lazy-loaded child modals (Add/Edit Budget/Income, ConfirmationDialog) are
 * themselves Radix Dialog instances ; Radix supports nested dialogs natively
 * via portal stacking (Tab cycle confined to the topmost dialog, Esc closes
 * the topmost first).
 */
export default function PlanningDrawer({
  isOpen,
  onClose,
  onPlanningChange,
  context,
  readOnlyIncomes = [],
}: PlanningDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('budgets')
  const [isAddBudgetOpen, setIsAddBudgetOpen] = useState(false)
  const [isAddIncomeOpen, setIsAddIncomeOpen] = useState(false)

  // États pour l'édition
  const [isEditBudgetOpen, setIsEditBudgetOpen] = useState(false)
  const [isEditIncomeOpen, setIsEditIncomeOpen] = useState(false)
  const [editingBudget, setEditingBudget] = useState<EstimatedBudget | null>(null)
  const [editingIncome, setEditingIncome] = useState<EstimatedIncome | null>(null)

  // États pour la confirmation de suppression
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [deletingItem, setDeletingItem] = useState<{
    id: string
    name: string
    type: 'budget' | 'income'
    cumulatedSavings: number
    /**
     * Estimated amount du budget ou du revenu — sert à afficher l'impact sur
     * le total estimé dans la modal de confirmation suppression (Sprint
     * 2026-05-22 / Delete-Header-And-Income-Concise). 0 si non disponible.
     */
    estimatedAmount: number
  } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Snackbar transient post-suppression (Pattern §8 ✅) — affiché quand
  // les économies d'un budget supprimé sont transférées vers la tirelire.
  const [transferSnackbar, setTransferSnackbar] = useState<{ amount: number } | null>(null)

  // États pour la popup d'information des budgets/revenus entamés
  const [isStartedItemInfoOpen, setIsStartedItemInfoOpen] = useState(false)
  const [startedItemInfo, setStartedItemInfo] = useState<{
    name: string
    type: 'budget' | 'income'
  } | null>(null)

  // Hooks pour la gestion des données
  const {
    budgets,
    loading: budgetsLoading,
    isFetching: budgetsFetching,
    error: budgetsError,
    addBudget,
    updateBudget,
    deleteBudget,
    refreshBudgets,
    totalBudgets,
  } = useBudgets(context)

  const {
    incomes,
    loading: incomesLoading,
    isFetching: incomesFetching,
    error: incomesError,
    addIncome,
    updateIncome,
    deleteIncome,
    refreshIncomes,
    totalIncomes,
  } = useIncomes(context)

  // Sprint P1 — lit la période depuis l'URL ?period= pour filtrer les progress
  // bars budget. Hérité automatiquement du dashboard (PeriodSelector).
  const { period } = usePeriodParam()

  // Hooks pour les calculs de progression
  const {
    budgetProgresses,
    loading: budgetProgressLoading,
    isFetching: budgetProgressFetching,
    refreshProgress: refreshBudgetProgress,
  } = useBudgetProgress(budgets, context, period)

  const {
    incomeProgresses,
    loading: incomeProgressLoading,
    isFetching: incomeProgressFetching,
    refreshProgress: refreshIncomeProgress,
  } = useIncomeProgress(incomes, context)

  // Skeleton remplace la liste pendant tout fetch (initial ou refetch
  // post-mutation/switch context). Inclut le fetch des expenses/incomes qui
  // alimentent les progress bars — sinon la liste serait visible avec des
  // pourcentages stale.
  const isBudgetsBusy =
    budgetsLoading || budgetsFetching || budgetProgressLoading || budgetProgressFetching
  const isIncomesBusy =
    incomesLoading || incomesFetching || incomeProgressLoading || incomeProgressFetching

  const renderSkeletonRows = (count = 3) => (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  )

  // Sprint 16 V3 — les lignes virtuelles read-only (salaire perso /
  // contribution groupe) sont injectées via la prop `readOnlyIncomes` (source
  // backend `FinancialData.meta`). Le total affiché est purement présentationnel :
  // il somme les revenus réels + les virtuelles pour rester cohérent avec
  // les lignes visibles. Aucun impact sur `totalEstimatedIncome` côté backend.
  const readOnlyIncomesTotal = readOnlyIncomes.reduce((sum, r) => sum + r.amount, 0)
  const totalIncomesWithReadOnly = totalIncomes + readOnlyIncomesTotal

  // Refresh des données quand le drawer s'ouvre
  useEffect(() => {
    if (isOpen) {
      refreshBudgets()
      refreshIncomes()
      refreshBudgetProgress()
      refreshIncomeProgress()
    }
  }, [isOpen, refreshBudgets, refreshIncomes, refreshBudgetProgress, refreshIncomeProgress])

  // Auto-dismiss snackbar after 3s (Pattern §8 ✅ feedback transient).
  useEffect(() => {
    if (!transferSnackbar) return
    const timer = setTimeout(() => setTransferSnackbar(null), 3000)
    return () => clearTimeout(timer)
  }, [transferSnackbar])

  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
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
  const handleEditBudget = (budget: EstimatedBudget) => {
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
  const handleEditIncome = (income: EstimatedIncome) => {
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
    const progress = budgetProgresses.find((p) => p.budgetId === budgetId)
    return progress ? progress.spentAmount > 0 : false
  }

  /**
   * Vérifie si un revenu est "entamé" (a des entrées associées)
   */
  const isIncomeStarted = (incomeId: string): boolean => {
    const progress = incomeProgresses.find((p) => p.incomeId === incomeId)
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
  const handleRequestDelete = (
    item: { id: string; name: string; cumulated_savings?: number; estimated_amount?: number },
    type: 'budget' | 'income',
  ) => {
    // Vérifier si l'item est entamé
    const isStarted = type === 'budget' ? isBudgetStarted(item.id) : isIncomeStarted(item.id)

    if (isStarted) {
      handleStartedItemAction(item, type)
      return
    }

    setDeletingItem({
      id: item.id,
      name: item.name,
      type,
      cumulatedSavings: type === 'budget' ? (item.cumulated_savings ?? 0) : 0,
      estimatedAmount: item.estimated_amount ?? 0,
    })
    setIsDeleteConfirmOpen(true)
  }

  /**
   * Confirmation de la suppression
   */
  const handleConfirmDelete = async () => {
    if (!deletingItem) return

    setIsDeleting(true)
    let success = false
    let transferredAmount = 0

    if (deletingItem.type === 'budget') {
      const result = await deleteBudget(deletingItem.id)
      success = result.success
      transferredAmount = result.transferredAmount ?? 0
    } else {
      success = await deleteIncome(deletingItem.id)
    }

    if (success) {
      setIsDeleteConfirmOpen(false)
      setDeletingItem(null)

      // Snackbar transient si économies transférées (Pattern §8 ✅).
      if (transferredAmount > 0) {
        setTransferSnackbar({ amount: transferredAmount })
      }

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

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={DRAWER_CONTENT_CLASSES}>
        {/* Header - Sticky (harmonisé avec SavingsDistributionDrawer, couleur bleue) */}
        <div className="shrink-0 border-b border-gray-200 bg-blue-50/30 px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600">
                <svg
                  className="h-5 w-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                  />
                </svg>
              </div>
              <div>
                <DialogTitle asChild>
                  <h2 className="text-xl font-bold text-gray-900">Planification Financière</h2>
                </DialogTitle>
                <p className="text-sm text-gray-600">Gérez vos budgets et revenus</p>
              </div>
            </div>
            <ModalCloseX
              onClose={onClose}
              variant="circle"
              className="h-10 w-10"
              svgClassName="h-5 w-5 text-gray-600"
            />
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="border-b border-gray-200 px-4 py-2">
          <div className="flex rounded-lg bg-gray-100 p-1">
            <button
              onClick={() => setActiveTab('budgets')}
              className={cn(
                'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all duration-200',
                activeTab === 'budgets'
                  ? 'bg-white text-orange-700 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900',
              )}
            >
              <div className="flex items-center justify-center space-x-1.5">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                <span>Budgets</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('revenus')}
              className={cn(
                'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all duration-200',
                activeTab === 'revenus'
                  ? 'bg-white text-green-700 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900',
              )}
            >
              <div className="flex items-center justify-center space-x-1.5">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
                <span>Revenus</span>
              </div>
            </button>
          </div>
        </div>

        {/* Content Area - Scrollable */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Error Messages */}
          {(budgetsError || incomesError) && (
            <div className="p-4">
              <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-medium text-red-800">{budgetsError || incomesError}</p>
              </div>
            </div>
          )}

          {/* Budgets Tab Content */}
          {activeTab === 'budgets' && (
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Budgets Estimés</h3>
                <button
                  onClick={() => setIsAddBudgetOpen(true)}
                  className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700"
                >
                  Ajouter un budget
                </button>
              </div>

              {/* Total discret */}
              <div className="rounded-lg border border-orange-100 bg-orange-50/50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-1 text-sm text-orange-700">
                  <span>Total estimé:</span>
                  {isBudgetsBusy ? (
                    <Skeleton className="h-3 w-14" />
                  ) : (
                    <span className="font-medium">{formatAmount(totalBudgets)}</span>
                  )}
                  <span>(sans les économies)</span>
                </div>
              </div>

              {/* Budgets List or Empty State */}
              {isBudgetsBusy ? (
                renderSkeletonRows()
              ) : budgets.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100">
                    <svg
                      className="h-8 w-8 text-orange-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <h4 className="mb-1.5 text-lg font-medium text-gray-900">
                    Aucun budget configuré
                  </h4>
                  <p className="mb-3 text-sm text-gray-600">
                    Commencez par ajouter vos catégories de dépenses mensuelles
                  </p>
                  <button
                    onClick={() => setIsAddBudgetOpen(true)}
                    className="rounded-lg bg-orange-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700"
                  >
                    Créer votre premier budget
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {budgets.map((budget) => {
                    const progress = budgetProgresses.find((p) => p.budgetId === budget.id)
                    if (!progress) return null

                    return (
                      <div
                        key={budget.id}
                        className="rounded-xl border border-gray-200 p-3 shadow-md"
                      >
                        <div className="flex items-center justify-between">
                          {/* Indicateur de progression intégré */}
                          <div className="flex-1">
                            <BudgetProgressIndicator progress={progress} />
                          </div>

                          {/* Menu dropdown */}
                          <div className="ml-1.5">
                            <DropdownMenu
                              items={[
                                {
                                  label: 'Modifier',
                                  icon: (
                                    <svg
                                      className="h-4 w-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="2"
                                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                      />
                                    </svg>
                                  ),
                                  onClick: () => handleEditBudget(budget),
                                  disabled: isBudgetStarted(budget.id),
                                },
                                {
                                  label: 'Supprimer',
                                  icon: (
                                    <svg
                                      className="h-4 w-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="2"
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                      />
                                    </svg>
                                  ),
                                  onClick: () => handleRequestDelete(budget, 'budget'),
                                  variant: 'danger' as const,
                                  disabled: isBudgetStarted(budget.id),
                                },
                              ]}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Revenus Tab Content */}
          {activeTab === 'revenus' && (
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Revenus Estimés</h3>
                <button
                  onClick={() => setIsAddIncomeOpen(true)}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                >
                  Ajouter un revenu
                </button>
              </div>

              {/* Total discret */}
              <div className="rounded-lg border border-green-100 bg-green-50/50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-1 text-sm text-green-700">
                  <span>Total estimé:</span>
                  {isIncomesBusy ? (
                    <Skeleton className="h-3 w-14" />
                  ) : (
                    <span className="font-medium">{formatAmount(totalIncomesWithReadOnly)}</span>
                  )}
                  <span>(sans les économies)</span>
                </div>
              </div>

              {/* Incomes List or Empty State */}
              {isIncomesBusy ? (
                renderSkeletonRows()
              ) : incomes.length === 0 && readOnlyIncomes.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                    <svg
                      className="h-8 w-8 text-green-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                      />
                    </svg>
                  </div>
                  <h4 className="mb-1.5 text-lg font-medium text-gray-900">
                    Aucun revenu configuré
                  </h4>
                  <p className="mb-3 text-sm text-gray-600">
                    Ajoutez vos sources de revenus mensuels récurrents
                  </p>
                  <button
                    onClick={() => setIsAddIncomeOpen(true)}
                    className="rounded-lg bg-green-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                  >
                    Ajouter votre premier revenu
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Sprint 16 V3 — lignes virtuelles read-only en tête (salaire
                     en perso, contribution groupe en groupe). Cadre vert clair
                     + badge "Profil"/"Groupe" + cadenas. Aucune action possible. */}
                  {readOnlyIncomes.map((row, idx) => (
                    <div
                      key={`readonly-${row.kind}-${idx}`}
                      className="rounded-xl border border-green-200 bg-green-50/30 p-3 shadow-md"
                      data-testid={`readonly-income-${row.kind}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-gray-900">{row.label}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                              <svg
                                className="h-3 w-3"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                aria-label="Lecture seule"
                                role="img"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="2"
                                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                                />
                              </svg>
                              {row.kind === 'salary' ? 'Profil' : 'Groupe'}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-medium text-green-700">
                            {formatAmount(row.amount)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {incomes.map((income) => {
                    const progress = incomeProgresses.find((p) => p.incomeId === income.id)
                    if (!progress) return null

                    return (
                      <div
                        key={income.id}
                        className="rounded-xl border border-gray-200 p-3 shadow-md"
                      >
                        <div className="flex items-center justify-between">
                          {/* Indicateur de progression intégré */}
                          <div className="flex-1">
                            <IncomeProgressIndicator progress={progress} />
                          </div>

                          {/* Menu dropdown */}
                          <div className="ml-1.5">
                            <DropdownMenu
                              items={[
                                {
                                  label: 'Modifier',
                                  icon: (
                                    <svg
                                      className="h-4 w-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="2"
                                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                      />
                                    </svg>
                                  ),
                                  onClick: () => handleEditIncome(income),
                                  disabled: isIncomeStarted(income.id),
                                },
                                {
                                  label: 'Supprimer',
                                  icon: (
                                    <svg
                                      className="h-4 w-4"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="2"
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                      />
                                    </svg>
                                  ),
                                  onClick: () => handleRequestDelete(income, 'income'),
                                  variant: 'danger' as const,
                                  disabled: isIncomeStarted(income.id),
                                },
                              ]}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Summary - Always visible */}
        <div className="border-t border-gray-200 bg-gray-100/80 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">
              Différence estimée (sans les économies)
            </span>
            <span
              className={cn(
                'text-lg font-bold',
                totalIncomesWithReadOnly - totalBudgets > 0
                  ? 'text-green-700'
                  : totalIncomesWithReadOnly - totalBudgets < 0
                    ? 'text-red-700'
                    : 'text-gray-900',
              )}
            >
              {formatAmount(totalIncomesWithReadOnly - totalBudgets)}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">Revenus - Budgets</p>
        </div>

        {/* Add Budget Dialog */}
        <AddBudgetDialog
          isOpen={isAddBudgetOpen}
          onClose={() => setIsAddBudgetOpen(false)}
          onSave={handleAddBudget}
          currentBudgetsTotal={totalBudgets}
          totalEstimatedIncome={totalIncomesWithReadOnly}
        />

        {/* Add Income Dialog */}
        <AddIncomeDialog
          isOpen={isAddIncomeOpen}
          onClose={() => setIsAddIncomeOpen(false)}
          onSave={handleAddIncome}
          currentIncomesTotal={totalIncomesWithReadOnly}
        />

        {/* Edit Budget Dialog — conditional render + key on editingBudget.id
           remounts the dialog cleanly when the user switches targets,
           so lazy useState init re-runs from the new budget data. */}
        {isEditBudgetOpen && editingBudget && (
          <EditBudgetDialog
            key={editingBudget.id}
            onClose={() => setIsEditBudgetOpen(false)}
            onSave={handleSaveEditedBudget}
            budget={editingBudget}
            currentBudgetsTotal={totalBudgets}
            totalEstimatedIncome={totalIncomesWithReadOnly}
          />
        )}

        {/* Edit Income Dialog — same pattern as Edit Budget */}
        {isEditIncomeOpen && editingIncome && (
          <EditIncomeDialog
            key={editingIncome.id}
            onClose={() => setIsEditIncomeOpen(false)}
            onSave={handleSaveEditedIncome}
            income={editingIncome}
            currentIncomesTotal={totalIncomesWithReadOnly}
          />
        )}

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
          details={(() => {
            if (!deletingItem) return undefined

            // Income with estimated amount → show new total estimated income.
            // Sprint 2026-05-22 / Delete-Header-And-Income-Concise.
            if (deletingItem.type === 'income' && deletingItem.estimatedAmount > 0) {
              const newTotal = totalIncomesWithReadOnly - deletingItem.estimatedAmount
              return (
                <div className="space-y-1.5 text-left">
                  <p className="text-sm font-medium text-gray-700">Après suppression :</p>
                  <p>
                    Vos revenus estimés passeront de{' '}
                    <span className="font-semibold text-green-600">
                      {formatAmount(totalIncomesWithReadOnly)}
                    </span>{' '}
                    à <span className="font-semibold text-green-600">{formatAmount(newTotal)}</span>
                    .
                  </p>
                </div>
              )
            }

            // Budget with savings to transfer → existing phrase + header.
            if (deletingItem.type === 'budget' && deletingItem.cumulatedSavings > 0) {
              return (
                <div className="space-y-1.5 text-left">
                  <p className="text-sm font-medium text-gray-700">Après suppression :</p>
                  <p>
                    <span className="font-semibold text-purple-600">
                      {formatAmount(deletingItem.cumulatedSavings)}
                    </span>{' '}
                    d&apos;économies sera transféré dans la tirelire.
                  </p>
                </div>
              )
            }

            return undefined
          })()}
          confirmText={
            deletingItem?.type === 'budget' && deletingItem.cumulatedSavings > 0
              ? 'Supprimer et transférer'
              : 'Supprimer'
          }
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
          cancelText={undefined}
          variant="info"
          loading={false}
        />

        {/* Snackbar post-suppression — économies transférées dans la tirelire
           (Pattern §8 ✅ feedback transient). Auto-dismiss via useEffect 3s. */}
        {transferSnackbar && (
          <div
            role="status"
            aria-live="polite"
            className="animate-in slide-in-from-bottom-4 fixed bottom-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg bg-purple-600 px-4 py-3 text-center text-sm font-medium text-white shadow-lg"
          >
            {formatAmount(transferSnackbar.amount)} transféré dans la tirelire
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
