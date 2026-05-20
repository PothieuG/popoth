'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DRAWER_CONTENT_CLASSES } from '@/components/ui/drawer-content-classes'
import { MODAL_CONTENT_CLASSES } from '@/components/ui/modal-content-classes'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import CustomDropdown, { type DropdownOption } from '@/components/ui/CustomDropdown'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

/**
 * Wizard step for the nested transfer modal (Sprint Modal-Uniformize 2026-05-21).
 * - `'select-destination'`: choose Tirelire vs Autre budget (always first step)
 * - `'fields'`: amount input + (if Autre budget) destination dropdown
 *
 * Mirror of [AddTransactionModal](./AddTransactionModal.tsx)'s wizard pattern :
 * step 1 always selects a discrete option, step 2 collects the variable fields.
 * Form state preserved across step transitions ; back navigation resets the
 * destination selection so the dropdown doesn't show with stale data.
 */
type TransferWizardStep = 'select-destination' | 'fields'

interface BudgetSavings {
  id: string
  name: string
  estimated_amount: number
  cumulated_savings: number
  last_savings_update?: string
}

interface SavingsData {
  context: 'profile' | 'group'
  user_name: string
  budgets: BudgetSavings[]
  piggy_bank: number
  statistics: {
    total_budgets: number
    budgets_with_savings: number
    budgets_without_savings: number
    budgets_savings: number
    piggy_bank: number
    total_savings: number
  }
}

interface SavingsDistributionDrawerProps {
  isOpen: boolean
  onClose: () => void
  context?: 'profile' | 'group'
  onSavingsChange?: () => void
}

/**
 * Drawer de distribution des économies.
 * Permet de transférer les économies cumulées entre budgets estimés.
 * Interface similaire au MonthlyRecapStep2.
 *
 * Migrated to Radix Dialog (Sprint Zod-Rollout v8) with heavy className override
 * on `<DialogContent>` to preserve the bottom-up drawer feel : fullscreen sizing
 * + slide-from-bottom animation. The nested transfer modal (rendered when
 * `isTransferModalOpen && selectedFromBudget`) is also a Radix Dialog (centered
 * modal, not drawer) ; Radix natively supports nested dialogs via Portal
 * stacking (Tab cycle confined to topmost dialog, Esc closes topmost first).
 */
export default function SavingsDistributionDrawer({
  isOpen,
  onClose,
  context = 'profile',
  onSavingsChange,
}: SavingsDistributionDrawerProps) {
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
  const [transferWizardStep, setTransferWizardStep] =
    useState<TransferWizardStep>('select-destination')
  // Animation direction for the step transition (Sprint Modal-Polish 2026-05-21).
  const [stepAnimDir, setStepAnimDir] = useState<'forward' | 'backward'>('forward')
  const [selectedFromBudget, setSelectedFromBudget] = useState<BudgetSavings | null>(null)
  const [selectedToBudget, setSelectedToBudget] = useState<string>('')
  const [transferAmount, setTransferAmount] = useState<string>('')
  const [transferDestinationType, setTransferDestinationType] = useState<
    'piggy_bank' | 'budget' | null
  >(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [validationError, setValidationError] = useState<string>('')

  const {
    data: savingsData = null,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery<SavingsData>({
    queryKey: ['savings-data', context],
    enabled: isOpen,
    queryFn: async () => {
      const response = await fetch(`/api/savings/data?context=${context}`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la récupération des données')
      }
      return data as SavingsData
    },
  })
  const error = queryError instanceof Error ? queryError.message : null

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
  }

  // Convertir les budgets en options pour le dropdown
  const getTransferDestinationOptions = (): DropdownOption[] => {
    if (!savingsData) return []
    return savingsData.budgets
      .filter((budget) => budget.id !== selectedFromBudget?.id)
      .map((budget) => ({
        id: budget.id,
        name: budget.name,
        type: 'expense' as const,
        spentAmount: 0,
        estimatedAmount: budget.estimated_amount,
        economyAmount: budget.cumulated_savings || 0,
      }))
  }

  const handleTransferClick = (budget: BudgetSavings) => {
    setSelectedFromBudget(budget)
    setSelectedToBudget('')
    setTransferAmount('')
    setTransferDestinationType(null)
    setValidationError('')
    setStepAnimDir('forward')
    setTransferWizardStep('select-destination')
    setIsTransferModalOpen(true)
  }

  /**
   * Step 1: handle destination type selection. Sets the destination + navigates
   * to step 2. Mirror of [AddTransactionModal](./AddTransactionModal.tsx)'s
   * `handleSelectType` (Sprint Modal-Uniformize 2026-05-21).
   */
  const handleSelectTransferDestination = (type: 'piggy_bank' | 'budget') => {
    setTransferDestinationType(type)
    if (type === 'piggy_bank') {
      // Tirelire is a singleton destination — clear stale budget selection.
      setSelectedToBudget('')
    }
    setValidationError('')
    setStepAnimDir('forward')
    setTransferWizardStep('fields')
  }

  /**
   * Back navigation: returns to destination selection. Preserves amount typed
   * so the user doesn't lose data when switching destinations.
   */
  const handleTransferBack = () => {
    setStepAnimDir('backward')
    setTransferWizardStep('select-destination')
    // Reset destination selection — picking it again drives the next step.
    setTransferDestinationType(null)
    setSelectedToBudget('')
    setValidationError('')
  }

  const handleTransferSubmit = async () => {
    if (!selectedFromBudget || !transferAmount || !transferDestinationType) return
    if (transferDestinationType === 'budget' && !selectedToBudget) return
    if (computedValidationError) return

    const amount = parseFloat(transferAmount)

    try {
      setIsProcessing(true)

      const body =
        transferDestinationType === 'piggy_bank'
          ? {
              context,
              action: 'budget_to_piggy_bank',
              from_budget_id: selectedFromBudget.id,
              amount,
            }
          : {
              context,
              from_budget_id: selectedFromBudget.id,
              to_budget_id: selectedToBudget,
              amount,
            }

      const response = await fetch('/api/savings/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors du transfert')
      }

      // Fermer la modale et réinitialiser
      setIsTransferModalOpen(false)
      setTransferWizardStep('select-destination')
      setSelectedFromBudget(null)
      setSelectedToBudget('')
      setTransferAmount('')
      setTransferDestinationType(null)
      setValidationError('')

      // Rafraîchir les données
      await refetch()

      // Notifier le parent pour rafraîchir les données financières
      if (onSavingsChange) {
        onSavingsChange()
      }
    } catch (error) {
      // CRITICAL cleanup-attempt : POST /api/savings/transfer peut laisser DB
      // partiellement débitée si fail. Pas de toast, juste validationError state.
      logger.error('❌ [SavingsDrawer] Erreur lors du transfert:', error)
      setValidationError(error instanceof Error ? error.message : 'Erreur lors du transfert')
    } finally {
      setIsProcessing(false)
    }
  }

  // Validation en temps réel (derived state, no extra render)
  const computedValidationError = useMemo(() => {
    if (!selectedFromBudget || !transferAmount) return ''
    const numAmount = parseFloat(transferAmount)
    if (isNaN(numAmount) || numAmount <= 0) return 'Veuillez entrer un montant valide'
    if (numAmount > (selectedFromBudget.cumulated_savings || 0)) {
      return `Le montant ne peut pas dépasser ${formatCurrency(selectedFromBudget.cumulated_savings || 0)}`
    }
    return ''
  }, [transferAmount, selectedFromBudget])

  const budgetsWithSavings =
    savingsData?.budgets.filter((b) => (b.cumulated_savings || 0) > 0) || []
  const budgetsWithoutSavings =
    savingsData?.budgets.filter((b) => (b.cumulated_savings || 0) === 0) || []

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  const handleTransferModalOpenChange = (open: boolean) => {
    if (!open && !isProcessing) {
      setIsTransferModalOpen(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={DRAWER_CONTENT_CLASSES}>
        {/* Header - Sticky */}
        <div className="shrink-0 border-b border-gray-200 bg-purple-50/30 px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-600">
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
                    d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                  />
                </svg>
              </div>
              <div>
                <DialogTitle asChild>
                  <h2 className="text-xl font-bold text-gray-900">Répartition des Économies</h2>
                </DialogTitle>
                <p className="text-sm text-gray-600">Transférez vos économies entre budgets</p>
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

        {/* Content Area - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-purple-600"></div>
                <p className="text-gray-600">Chargement des économies...</p>
              </div>
            </div>
          ) : error ? (
            <div className="p-4">
              <Card className="border-red-200 bg-red-50 p-4">
                <div className="text-center">
                  <div className="mb-2 text-red-600">
                    <svg
                      className="mx-auto h-12 w-12"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z"
                      />
                    </svg>
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-red-900">Erreur</h3>
                  <p className="mb-4 text-red-700">{error}</p>
                  <Button
                    onClick={() => {
                      void refetch()
                    }}
                    className="bg-red-600 text-white hover:bg-red-700"
                  >
                    Réessayer
                  </Button>
                </div>
              </Card>
            </div>
          ) : savingsData ? (
            <div className="space-y-4 p-4">
              {/* Statistiques globales */}
              <Card className="border-purple-200 bg-purple-50 p-4">
                <div className="text-center">
                  <h3 className="mb-2 text-sm font-medium text-purple-900">Total des Économies</h3>
                  <p className="text-3xl font-bold text-purple-600">
                    {formatCurrency(savingsData.statistics.total_savings)}
                  </p>
                  <div className="mt-3 border-t border-purple-200 pt-3">
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-purple-700">Économies budgets:</span>
                      <span className="font-medium text-purple-900">
                        {formatCurrency(savingsData.statistics.budgets_savings)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-purple-700">Tirelire:</span>
                      <span className="font-medium text-purple-900">
                        {formatCurrency(savingsData.piggy_bank)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-purple-700">
                    {savingsData.statistics.budgets_with_savings} budget(s) avec économies
                  </p>
                </div>
              </Card>

              {/* Budgets avec économies */}
              {budgetsWithSavings.length > 0 && (
                <Card className="p-4">
                  <h3 className="mb-3 text-lg font-semibold text-gray-900">
                    Budgets avec économies ({budgetsWithSavings.length})
                  </h3>
                  <div className="space-y-3">
                    {budgetsWithSavings.map((budget) => (
                      <div
                        key={budget.id}
                        className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3"
                      >
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{budget.name}</h4>
                          <div className="mt-1 text-sm text-gray-600">
                            Budget: {formatCurrency(budget.estimated_amount)}
                          </div>
                          <div className="mt-1 text-lg font-bold text-green-600">
                            {formatCurrency(budget.cumulated_savings || 0)}&nbsp;d&apos;économies
                          </div>
                        </div>
                        <Button
                          onClick={() => handleTransferClick(budget)}
                          disabled={isLoading || isProcessing}
                          variant="outline"
                          size="sm"
                          className="ml-3 border-purple-500 text-purple-600 hover:bg-purple-50"
                        >
                          <svg
                            className="mr-1 h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                            />
                          </svg>
                          Transférer
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Budgets sans économies */}
              {budgetsWithoutSavings.length > 0 && (
                <Card className="p-4">
                  <h3 className="mb-3 text-lg font-semibold text-gray-900">
                    Autres budgets ({budgetsWithoutSavings.length})
                  </h3>
                  <div className="space-y-3">
                    {budgetsWithoutSavings.map((budget) => (
                      <div
                        key={budget.id}
                        className="flex items-center justify-between rounded-lg bg-gray-50 p-3"
                      >
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{budget.name}</h4>
                          <div className="mt-1 text-sm text-gray-600">
                            Budget: {formatCurrency(budget.estimated_amount)}
                          </div>
                          <div className="mt-1 text-sm text-gray-500">Aucune économie</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {savingsData.budgets.length === 0 && (
                <Card className="p-8">
                  <div className="text-center text-gray-500">
                    <svg
                      className="mx-auto mb-4 h-16 w-16 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                      />
                    </svg>
                    <p className="text-lg font-medium">Aucun budget configuré</p>
                    <p className="mt-2 text-sm">
                      Créez des budgets estimés pour commencer à épargner
                    </p>
                  </div>
                </Card>
              )}
            </div>
          ) : null}
        </div>
      </DialogContent>

      {/* Modal de transfert — nested Radix Dialog (centered modal, not drawer).
          2-step wizard mirror of AddTransactionModal (Sprint Modal-Uniformize 2026-05-21) :
          step 1 picks the destination (Tirelire | Autre budget), step 2 collects the
          amount + (for Autre budget) the destination dropdown. */}
      <Dialog open={isTransferModalOpen} onOpenChange={handleTransferModalOpenChange}>
        <DialogContent hideCloseButton className={MODAL_CONTENT_CLASSES}>
          {selectedFromBudget && (
            <>
              {/* Header — iOS-like: back button (top-left) + centered title + close */}
              <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3">
                {transferWizardStep === 'select-destination' ? (
                  <div className="h-9 w-9 shrink-0" />
                ) : (
                  <button
                    type="button"
                    onClick={handleTransferBack}
                    disabled={isProcessing}
                    aria-label="Retour à l'étape précédente"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                  </button>
                )}
                <DialogTitle asChild>
                  <h3 className="flex-1 text-center text-base font-semibold text-gray-900">
                    {transferWizardStep === 'select-destination'
                      ? 'Destination du transfert'
                      : 'Montant à transférer'}
                  </h3>
                </DialogTitle>
                <ModalCloseX
                  onClose={() => setIsTransferModalOpen(false)}
                  disabled={isProcessing}
                  variant="ghost"
                  className="h-9 w-9"
                />
              </div>

              {/* Step 1: choose destination */}
              {transferWizardStep === 'select-destination' && (
                <div
                  key="transfer-step-select-destination"
                  className={cn(
                    'min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-4',
                    'animate-in fade-in duration-200',
                    stepAnimDir === 'forward' ? 'slide-in-from-right-4' : 'slide-in-from-left-4',
                  )}
                >
                  {/* Budget source */}
                  <div className="rounded-xl bg-purple-50 p-3">
                    <p className="text-xs font-medium tracking-wide text-purple-500 uppercase">
                      Budget source
                    </p>
                    <p className="mt-1 text-sm font-semibold text-purple-900">
                      {selectedFromBudget.name}
                    </p>
                    <p className="text-sm font-medium text-purple-600">
                      {formatCurrency(selectedFromBudget.cumulated_savings || 0)} disponibles
                    </p>
                  </div>

                  <p className="text-sm text-gray-600">Choisissez la destination du transfert.</p>

                  <div className="flex flex-col space-y-3">
                    <button
                      type="button"
                      onClick={() => handleSelectTransferDestination('piggy_bank')}
                      className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 p-4 text-left transition-all hover:bg-purple-100 focus-visible:outline-2 focus-visible:outline-purple-500"
                    >
                      <div className="flex items-center space-x-3">
                        <svg
                          className="h-6 w-6 text-purple-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                          />
                        </svg>
                        <div>
                          <p className="font-medium text-purple-700">Tirelire</p>
                          <p className="text-xs text-purple-600">
                            Mettre de côté dans la tirelire commune
                          </p>
                        </div>
                      </div>
                      <svg
                        className="h-5 w-5 text-purple-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSelectTransferDestination('budget')}
                      className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-4 text-left transition-all hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-500"
                    >
                      <div className="flex items-center space-x-3">
                        <svg
                          className="h-6 w-6 text-blue-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                          />
                        </svg>
                        <div>
                          <p className="font-medium text-blue-700">Autre budget</p>
                          <p className="text-xs text-blue-600">
                            Renforcer un autre budget avec ces économies
                          </p>
                        </div>
                      </div>
                      <svg
                        className="h-5 w-5 text-blue-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: fields (amount + conditional destination dropdown) */}
              {transferWizardStep === 'fields' && (
                <>
                  <div
                    key="transfer-step-fields"
                    className={cn(
                      'min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-4',
                      'animate-in fade-in duration-200',
                      stepAnimDir === 'forward' ? 'slide-in-from-right-4' : 'slide-in-from-left-4',
                    )}
                  >
                    {/* Summary chip: source + destination */}
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3 text-xs">
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-700">
                        {selectedFromBudget.name}
                      </span>
                      <svg
                        className="h-3 w-3 text-gray-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M14 5l7 7m0 0l-7 7m7-7H3"
                        />
                      </svg>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 font-medium',
                          transferDestinationType === 'piggy_bank'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700',
                        )}
                      >
                        {transferDestinationType === 'piggy_bank' ? 'Tirelire' : 'Autre budget'}
                      </span>
                    </div>

                    {/* Montant */}
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        Montant à transférer
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={transferAmount}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === '' || /^\d*[.,]?\d*$/.test(v)) {
                            setTransferAmount(v.replace(',', '.'))
                          }
                        }}
                        placeholder="0.00"
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base outline-hidden focus:border-purple-500 focus:ring-2 focus:ring-purple-500"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Maximum: {formatCurrency(selectedFromBudget.cumulated_savings || 0)}
                      </p>
                    </div>

                    {/* Destination dropdown (only for budget) */}
                    {transferDestinationType === 'budget' && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-gray-700">
                          Budget de destination
                        </label>
                        <CustomDropdown
                          options={getTransferDestinationOptions()}
                          value={selectedToBudget}
                          onChange={setSelectedToBudget}
                          placeholder="Sélectionner un budget"
                          required
                        />
                      </div>
                    )}

                    {(computedValidationError || validationError) && (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                        <p className="text-sm font-medium text-red-600">
                          {computedValidationError || validationError}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Footer - sticky */}
                  <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-6 py-4">
                    <Button
                      variant="outline"
                      onClick={() => setIsTransferModalOpen(false)}
                      disabled={isProcessing}
                      className="rounded-xl"
                    >
                      Annuler
                    </Button>
                    <Button
                      onClick={handleTransferSubmit}
                      disabled={
                        !transferAmount ||
                        !transferDestinationType ||
                        (transferDestinationType === 'budget' && !selectedToBudget) ||
                        isProcessing ||
                        !!(computedValidationError || validationError)
                      }
                      className="rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isProcessing ? 'Transfert...' : 'Confirmer'}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
