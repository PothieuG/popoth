'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import CustomDropdown, { type DropdownOption } from '@/components/ui/CustomDropdown'

interface BudgetStat {
  id: string
  name: string
  estimated_amount: number
  spent_amount: number
  difference: number
  surplus: number
  deficit: number
  cumulated_savings: number
}

interface DepenseExceptionnelle {
  id: string
  amount: number
  description: string
  date: string
}

interface DetailAutres {
  depenses_exceptionnelles: {
    total: number
    items: DepenseExceptionnelle[]
  }
  ecart_revenus: number
  autres_non_identifies: number
}

interface Step2Data {
  current_remaining_to_live: number
  budgetary_remaining_to_live: number
  piggy_bank: number
  budget_stats: BudgetStat[]
  month: number
  year: number
  total_surplus: number
  total_deficit: number
  // Nouveau: détail des déficits
  deficit_global: number
  deficit_budgets: number
  deficit_autres: number
  detail_autres: DetailAutres
  context: string
  user_name: string
}

interface MonthlyRecapStep2Props {
  context: 'profile' | 'group'
  onNext: () => void
  onTransfer: (fromBudgetId: string, toBudgetId: string, amount: number) => Promise<unknown>
  onAutoBalance: () => Promise<unknown>
}

/**
 * Étape 2: Affichage et gestion des économies/déficits entre budgets - VERSION STATELESS SANS CACHE
 * - Récupère toutes les données en temps réel depuis l'API step2-data
 * - Liste des budgets avec leurs excédents/déficits
 * - Possibilité de transfert manuel entre budgets
 * - Répartition automatique des excédents
 */
export default function MonthlyRecapStep2({
  context,
  onNext,
  onTransfer,
  onAutoBalance,
}: MonthlyRecapStep2Props) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
  const [selectedFromBudget, setSelectedFromBudget] = useState<BudgetStat | null>(null)
  const [selectedToBudget, setSelectedToBudget] = useState<string>('')
  const [transferAmount, setTransferAmount] = useState<string>('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [validationError, setValidationError] = useState<string>('')

  const monthNames = [
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre',
  ]

  /**
   * Récupère les données live depuis l'API step2-data
   */
  const {
    data: step2Data = null,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery<Step2Data>({
    queryKey: ['step2-data', context],
    queryFn: async () => {
      const response = await fetch(`/api/monthly-recap/step2-data?context=${context}`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la récupération des données')
      }
      return data as Step2Data
    },
  })
  const error = queryError instanceof Error ? queryError.message : null

  // Calculer les variables dérivées seulement si on a des données
  const currentMonthName = step2Data ? monthNames[step2Data.month - 1] : ''
  const budgetsWithSurplus = step2Data
    ? step2Data.budget_stats.filter((budget) => budget.surplus > 0)
    : []
  const budgetsWithDeficit = step2Data
    ? step2Data.budget_stats.filter((budget) => budget.deficit > 0)
    : []

  // Recalculer les totaux à partir des budget_stats actuels (peut avoir changé après équilibrage)
  const currentTotalSavings = step2Data
    ? step2Data.budget_stats.reduce((sum, b) => sum + (b.cumulated_savings || 0), 0)
    : 0
  const currentTotalSurplus = step2Data
    ? step2Data.budget_stats.reduce((sum, b) => sum + (b.surplus || 0), 0)
    : 0

  // Helper function to convert budget stats to dropdown options for transfer mode
  const getTransferDestinationOptions = (): DropdownOption[] => {
    if (!step2Data) return []
    return step2Data.budget_stats
      .filter((budget) => budget.id !== selectedFromBudget?.id)
      .map((budget) => ({
        id: budget.id,
        name: budget.name,
        type: 'expense' as const,
        spentAmount: budget.spent_amount,
        estimatedAmount: budget.estimated_amount,
        economyAmount:
          budget.surplus > 0 ? budget.surplus : budget.deficit > 0 ? -budget.deficit : 0,
      }))
  }

  // Helper function to convert budget stats to dropdown options for recovery mode
  const getRecoverySourceOptions = (): DropdownOption[] => {
    if (!step2Data) return []
    return step2Data.budget_stats
      .filter((budget) => budget.id !== selectedFromBudget?.id && budget.surplus > 0)
      .map((budget) => ({
        id: budget.id,
        name: budget.name,
        type: 'expense' as const,
        spentAmount: budget.spent_amount,
        estimatedAmount: budget.estimated_amount,
        economyAmount: budget.surplus,
      }))
  }

  const handleTransferClick = (budget: BudgetStat) => {
    setSelectedFromBudget(budget)
    setSelectedToBudget('')
    setTransferAmount('')
    setValidationError('')
    setIsTransferModalOpen(true)
  }

  const handleTransfer = async (fromBudgetId: string, toBudgetId: string, amount: number) => {
    try {
      setIsProcessing(true)
      await onTransfer(fromBudgetId, toBudgetId, amount)

      // Fermer la modale et réinitialiser
      setIsTransferModalOpen(false)
      setSelectedFromBudget(null)
      setSelectedToBudget('')
      setTransferAmount('')
      setValidationError('')

      // Rafraîchir les données
      await refetch()
    } catch {
      setValidationError('Erreur lors du transfert. Veuillez réessayer.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleAutoBalance = async () => {
    try {
      setIsProcessing(true)
      await onAutoBalance()

      // Rafraîchir les données après équilibrage automatique
      await refetch()
    } catch {
      // l'erreur est exposée via state queryError du useQuery (refetch côté hook)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRecoverClick = (budget: BudgetStat) => {
    setSelectedFromBudget(budget)
    setSelectedToBudget('')
    setTransferAmount('')
    setValidationError('')
    setIsTransferModalOpen(true)
  }

  const handleTransferSubmit = async () => {
    if (!selectedFromBudget || !selectedToBudget || !transferAmount) return

    const amount = parseFloat(transferAmount)
    if (isNaN(amount) || amount <= 0) {
      alert('Veuillez entrer un montant valide')
      return
    }

    // Validation différente selon le mode (transfert ou récupération)
    if (selectedFromBudget.surplus > 0) {
      // Mode transfert: vérifier que le montant ne dépasse pas le surplus disponible
      const availableSurplus = selectedFromBudget.estimated_amount - selectedFromBudget.spent_amount
      if (amount > availableSurplus) {
        alert(
          `Le montant ne peut pas dépasser ${formatCurrency(availableSurplus)} de surplus disponible`,
        )
        return
      }
    } else {
      // Mode récupération: vérifier que le montant ne dépasse pas le déficit
      const currentDeficit = selectedFromBudget.spent_amount - selectedFromBudget.estimated_amount
      if (amount > currentDeficit) {
        alert(`Le montant ne peut pas dépasser ${formatCurrency(currentDeficit)} de déficit`)
        return
      }
    }

    // Appeler notre fonction locale qui gère tout
    if (selectedFromBudget.surplus > 0) {
      // Mode transfert: de selectedFromBudget vers selectedToBudget
      await handleTransfer(selectedFromBudget.id, selectedToBudget, amount)
    } else {
      // Mode récupération: de selectedToBudget vers selectedFromBudget
      await handleTransfer(selectedToBudget, selectedFromBudget.id, amount)
    }
  }

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
  }

  // Validation en temps réel (derived state, no extra render)
  const computedValidationError = useMemo(() => {
    if (!selectedFromBudget || !transferAmount) return ''
    const numAmount = parseFloat(transferAmount)
    if (isNaN(numAmount) || numAmount <= 0) return 'Veuillez entrer un montant valide'
    if (selectedFromBudget.surplus > 0) {
      const availableSurplus = selectedFromBudget.estimated_amount - selectedFromBudget.spent_amount
      if (numAmount > availableSurplus) {
        return `Le montant ne peut pas dépasser ${formatCurrency(availableSurplus)} de surplus disponible`
      }
    } else {
      const currentDeficit = selectedFromBudget.spent_amount - selectedFromBudget.estimated_amount
      if (numAmount > currentDeficit) {
        return `Le montant ne peut pas dépasser ${formatCurrency(currentDeficit)} de déficit à combler`
      }
      if (selectedToBudget && step2Data) {
        const sourceBudget = step2Data.budget_stats.find((b) => b.id === selectedToBudget)
        if (sourceBudget && numAmount > sourceBudget.surplus) {
          return `Le budget source n'a que ${formatCurrency(sourceBudget.surplus)} de surplus disponible`
        }
      }
    }
    return ''
  }, [transferAmount, selectedFromBudget, selectedToBudget, step2Data])

  const getBudgetStatusColor = (budget: BudgetStat) => {
    if (budget.surplus > 0) return 'text-green-600'
    if (budget.deficit > 0) return 'text-red-600'
    return 'text-blue-600'
  }

  const getBudgetStatusText = (budget: BudgetStat) => {
    if (budget.surplus > 0) return `+${formatCurrency(budget.surplus)} d'économie`
    if (budget.deficit > 0) return `-${formatCurrency(budget.deficit)} de déficit`
    return 'Budget respecté'
  }

  // État de chargement
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-blue-600"></div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">Récupération des données</h2>
          <p className="text-gray-600">Calcul de vos budgets...</p>
        </div>
      </div>
    )
  }

  // État d'erreur
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-red-50 to-red-100 p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-6 text-center shadow-lg">
          <div className="mb-4 text-red-600">
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
          <h2 className="mb-2 text-lg font-semibold text-gray-900">Erreur</h2>
          <p className="mb-4 text-gray-600">{error}</p>
          <Button
            onClick={() => {
              void refetch()
            }}
            className="w-full bg-red-600 text-white hover:bg-red-700"
          >
            Réessayer
          </Button>
        </div>
      </div>
    )
  }

  // Pas de données
  if (!step2Data) {
    return null
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">
            Récapitulatif {currentMonthName} {step2Data.year}
          </h1>
          <p className="mt-1 text-sm text-gray-600">Étape 2 sur 2 - Gestion des économies</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {/* Bouton de répartition automatique */}
        {budgetsWithSurplus.length > 0 && budgetsWithDeficit.length > 0 && (
          <Card className="border border-orange-200 bg-orange-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-orange-900">Répartition automatique</h3>
                <p className="mt-1 text-sm text-orange-700">
                  Répartir les excédents dans les budgets déficitaires de manière équilibrée
                </p>
              </div>
              <Button
                onClick={handleAutoBalance}
                disabled={isProcessing || isLoading}
                className="bg-orange-500 text-white hover:bg-orange-600"
              >
                {isProcessing ? 'Traitement...' : 'Auto-répartition'}
              </Button>
            </div>
          </Card>
        )}

        {/* Résumé des totaux */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="border border-purple-200 bg-purple-50 p-3">
            <div className="text-center">
              <h4 className="text-sm font-medium text-purple-900">Économies</h4>
              <p className="mt-1 text-lg font-bold text-purple-600">
                {formatCurrency(currentTotalSavings)}
              </p>
              <p className="mt-1 text-xs text-purple-700">Cumulées</p>
            </div>
          </Card>

          <Card className="border border-green-200 bg-green-50 p-3">
            <div className="text-center">
              <h4 className="text-sm font-medium text-green-900">Surplus</h4>
              <p className="mt-1 text-lg font-bold text-green-600">
                {formatCurrency(currentTotalSurplus)}
              </p>
              <p className="mt-1 text-xs text-green-700">{budgetsWithSurplus.length} budget(s)</p>
            </div>
          </Card>

          <Card className="border border-red-200 bg-red-50 p-3">
            <div className="text-center">
              <h4 className="text-sm font-medium text-red-900">Déficit Global</h4>
              <p className="mt-1 text-lg font-bold text-red-600">
                {formatCurrency(step2Data.deficit_global || 0)}
              </p>
              {(step2Data.deficit_global || 0) > 0 && (
                <div className="mt-1 space-y-0.5 text-xs text-red-700">
                  <p>Budgets: {formatCurrency(step2Data.deficit_budgets || 0)}</p>
                  {(step2Data.deficit_autres || 0) > 0 && (
                    <p>Autres: {formatCurrency(step2Data.deficit_autres || 0)}</p>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Tirelire (Revenus exceptionnels) */}
          {step2Data.piggy_bank > 0 && (
            <Card className="border border-yellow-200 bg-yellow-50 p-3">
              <div className="text-center">
                <h4 className="text-sm font-medium text-yellow-900">Tirelire 🐷</h4>
                <p className="mt-1 text-lg font-bold text-yellow-600">
                  {formatCurrency(step2Data.piggy_bank)}
                </p>
                <p className="mt-1 text-xs text-yellow-700">Revenus exceptionnels</p>
              </div>
            </Card>
          )}
        </div>

        {/* Liste des budgets */}
        <Card className="bg-white p-4">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Détail par budget</h3>

          <div className="space-y-3">
            {step2Data.budget_stats.map((budget) => (
              <div
                key={budget.id}
                className="flex items-center justify-between rounded-lg bg-gray-50 p-3"
              >
                <div className="flex-1">
                  <h4 className="font-medium text-gray-900">{budget.name}</h4>
                  <div className="mt-1 text-sm text-gray-600">
                    <div>Budgété: {formatCurrency(budget.estimated_amount)}</div>
                    <div>Dépensé: {formatCurrency(budget.spent_amount)}</div>
                  </div>
                  <div className={`mt-1 text-sm font-medium ${getBudgetStatusColor(budget)}`}>
                    {getBudgetStatusText(budget)}
                  </div>
                  {budget.cumulated_savings > 0 && (
                    <div className="mt-1 text-sm text-purple-600">
                      +{formatCurrency(budget.cumulated_savings)} d&apos;économies
                    </div>
                  )}
                </div>

                {budget.surplus > 0 && (
                  <Button
                    onClick={() => handleTransferClick(budget)}
                    disabled={isLoading || isProcessing}
                    variant="outline"
                    size="sm"
                    className="ml-3"
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
                )}

                {budget.deficit > 0 && (
                  <Button
                    onClick={() => handleRecoverClick(budget)}
                    disabled={isLoading || isProcessing}
                    variant="outline"
                    size="sm"
                    className="ml-3"
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
                        d="M4 7h16m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                      />
                    </svg>
                    Récupérer
                  </Button>
                )}
              </div>
            ))}
          </div>

          {step2Data.budget_stats.length === 0 && (
            <div className="py-8 text-center text-gray-500">
              <p>Aucun budget estimé configuré</p>
            </div>
          )}
        </Card>

        {/* Détail des déficits "Autres" (si présents) */}
        {(step2Data.deficit_autres || 0) > 0 && step2Data.detail_autres && (
          <Card className="border border-orange-200 bg-orange-50 p-4">
            <h3 className="mb-4 text-lg font-semibold text-orange-900">
              Détail des déficits hors budgets
            </h3>
            <p className="mb-4 text-sm text-orange-700">
              Total: {formatCurrency(step2Data.deficit_autres)}
            </p>

            <div className="space-y-3">
              {/* Dépenses exceptionnelles */}
              {step2Data.detail_autres.depenses_exceptionnelles.total > 0 && (
                <div className="rounded-lg border border-orange-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="font-medium text-orange-800">Dépenses exceptionnelles</h4>
                    <span className="text-sm font-bold text-orange-600">
                      {formatCurrency(step2Data.detail_autres.depenses_exceptionnelles.total)}
                    </span>
                  </div>
                  {step2Data.detail_autres.depenses_exceptionnelles.items.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-gray-600">
                      {step2Data.detail_autres.depenses_exceptionnelles.items.map((item) => (
                        <li key={item.id} className="flex justify-between">
                          <span>{item.description || 'Dépense sans budget'}</span>
                          <span className="font-medium">{formatCurrency(item.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Écart de revenus */}
              {step2Data.detail_autres.ecart_revenus > 0 && (
                <div className="rounded-lg border border-orange-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-orange-800">Écart de revenus</h4>
                    <span className="text-sm font-bold text-orange-600">
                      {formatCurrency(step2Data.detail_autres.ecart_revenus)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Revenus réels inférieurs aux revenus estimés
                  </p>
                </div>
              )}

              {/* Autres non identifiés */}
              {step2Data.detail_autres.autres_non_identifies > 0 && (
                <div className="rounded-lg border border-orange-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-orange-800">Autres écarts</h4>
                    <span className="text-sm font-bold text-orange-600">
                      {formatCurrency(step2Data.detail_autres.autres_non_identifies)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Écarts divers (arrondis, ajustements...)
                  </p>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Footer avec navigation */}
      <div className="border-t border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">Étape 2 sur 2</div>
          <Button
            onClick={async () => {
              setIsSubmitting(true)
              try {
                await onNext()
              } catch {
                // l'erreur est gérée par MonthlyRecapFlow.handleCompleteFromStep2
              } finally {
                setIsSubmitting(false)
              }
            }}
            disabled={isLoading || isSubmitting}
            className="bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  ></path>
                </svg>
                Finalisation...
              </span>
            ) : (
              'Terminer le récapitulatif'
            )}
          </Button>
        </div>
      </div>

      {/* Modal de transfert/récupération */}
      <Dialog open={isTransferModalOpen} onOpenChange={setIsTransferModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {(selectedFromBudget?.surplus ?? 0) > 0
                ? 'Transférer des économies'
                : 'Récupérer des fonds'}
            </DialogTitle>
          </DialogHeader>

          {selectedFromBudget && (
            <div className="space-y-4">
              {selectedFromBudget.surplus > 0 ? (
                // Mode transfert (budget avec surplus)
                <>
                  <div className="rounded-lg bg-green-50 p-3">
                    <h4 className="font-medium text-green-900">Budget source</h4>
                    <p className="text-sm text-green-700">{selectedFromBudget.name}</p>
                    <p className="text-sm font-medium text-green-600">
                      {formatCurrency(selectedFromBudget.surplus)} disponibles
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
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

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
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
                      className="w-full rounded-md border border-gray-300 p-2 focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Maximum:{' '}
                      {formatCurrency(
                        selectedFromBudget.estimated_amount - selectedFromBudget.spent_amount,
                      )}
                    </p>
                  </div>
                </>
              ) : (
                // Mode récupération (budget avec déficit)
                <>
                  <div className="rounded-lg bg-red-50 p-3">
                    <h4 className="font-medium text-red-900">Budget en déficit</h4>
                    <p className="text-sm text-red-700">{selectedFromBudget.name}</p>
                    <p className="text-sm font-medium text-red-600">
                      {formatCurrency(selectedFromBudget.deficit)} de déficit
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      Budget source (avec surplus)
                    </label>
                    <CustomDropdown
                      options={getRecoverySourceOptions()}
                      value={selectedToBudget}
                      onChange={setSelectedToBudget}
                      placeholder="Sélectionner un budget avec surplus"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      Montant à récupérer
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
                      className="w-full rounded-md border border-gray-300 p-2 focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Maximum:{' '}
                      {formatCurrency(
                        selectedFromBudget.spent_amount - selectedFromBudget.estimated_amount,
                      )}
                    </p>
                  </div>
                </>
              )}

              {/* Message d'erreur de validation */}
              {(computedValidationError || validationError) && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-medium text-red-600">
                    ⚠️ {computedValidationError || validationError}
                  </p>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setIsTransferModalOpen(false)}
                  disabled={isProcessing}
                >
                  Annuler
                </Button>
                <Button
                  onClick={handleTransferSubmit}
                  disabled={
                    !selectedToBudget ||
                    !transferAmount ||
                    isProcessing ||
                    !!(computedValidationError || validationError)
                  }
                  className={`text-white ${
                    !selectedToBudget ||
                    !transferAmount ||
                    isProcessing ||
                    !!(computedValidationError || validationError)
                      ? 'cursor-not-allowed bg-gray-400'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {isProcessing
                    ? selectedFromBudget.surplus > 0
                      ? 'Transfert...'
                      : 'Récupération...'
                    : selectedFromBudget.surplus > 0
                      ? 'Confirmer'
                      : 'Récupérer'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
