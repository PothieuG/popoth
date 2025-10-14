'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import CustomDropdown, { type DropdownOption } from '@/components/ui/CustomDropdown'
import { cn } from '@/lib/utils'

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
 * Drawer de distribution des économies
 * Permet de transférer les économies cumulées entre budgets estimés
 * Interface similaire au MonthlyRecapStep2
 */
export default function SavingsDistributionDrawer({
  isOpen,
  onClose,
  context = 'profile',
  onSavingsChange
}: SavingsDistributionDrawerProps) {
  const [savingsData, setSavingsData] = useState<SavingsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
  const [selectedFromBudget, setSelectedFromBudget] = useState<BudgetSavings | null>(null)
  const [selectedToBudget, setSelectedToBudget] = useState<string>('')
  const [transferAmount, setTransferAmount] = useState<string>('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [validationError, setValidationError] = useState<string>('')

  /**
   * Récupère les données des économies depuis l'API
   */
  const fetchSavingsData = async () => {
    try {
      setIsLoading(true)
      setError(null)

      console.log('🔄 [SavingsDrawer] Récupération des données des économies')

      const response = await fetch(`/api/savings/data?context=${context}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la récupération des données')
      }

      console.log(``)
      console.log(`💰💰💰 ========================================================`)
      console.log(`💰💰💰 [SAVINGS DRAWER] DONNÉES REÇUES`)
      console.log(`💰💰💰 ========================================================`)
      console.log(`💰 Total économies: ${data.statistics.total_savings}€`)
      console.log(`💰 Budgets avec économies: ${data.statistics.budgets_with_savings}`)
      console.log(`💰 Total budgets: ${data.statistics.total_budgets}`)
      console.log(`💰💰💰 ========================================================`)
      console.log(``)

      setSavingsData(data)

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      console.error('❌ [SavingsDrawer] Erreur:', err)
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // Récupérer les données quand le drawer s'ouvre
  useEffect(() => {
    if (isOpen) {
      fetchSavingsData()
    }
  }, [isOpen, context])

  // Reset modal state when data changes
  useEffect(() => {
    if (savingsData && isTransferModalOpen) {
      setSelectedToBudget('')
      setTransferAmount('')
      setValidationError('')
    }
  }, [savingsData, isTransferModalOpen])

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
  }

  // Convertir les budgets en options pour le dropdown
  const getTransferDestinationOptions = (): DropdownOption[] => {
    if (!savingsData) return []
    return savingsData.budgets
      .filter(budget => budget.id !== selectedFromBudget?.id)
      .map(budget => ({
        id: budget.id,
        name: budget.name,
        type: 'expense' as const,
        spentAmount: 0,
        estimatedAmount: budget.estimated_amount,
        economyAmount: budget.cumulated_savings || 0
      }))
  }

  const handleTransferClick = (budget: BudgetSavings) => {
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
      setValidationError('Veuillez entrer un montant valide')
      return
    }

    if (amount > (selectedFromBudget.cumulated_savings || 0)) {
      setValidationError(`Le montant ne peut pas dépasser ${formatCurrency(selectedFromBudget.cumulated_savings || 0)}`)
      return
    }

    try {
      setIsProcessing(true)
      console.log('🔄 [SavingsDrawer] Transfert:', selectedFromBudget.id, '→', selectedToBudget, `${amount}€`)

      const response = await fetch('/api/savings/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context,
          from_budget_id: selectedFromBudget.id,
          to_budget_id: selectedToBudget,
          amount
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors du transfert')
      }

      console.log('✅ [SavingsDrawer] Transfert réussi')

      // Fermer la modale et réinitialiser
      setIsTransferModalOpen(false)
      setSelectedFromBudget(null)
      setSelectedToBudget('')
      setTransferAmount('')
      setValidationError('')

      // Rafraîchir les données
      await fetchSavingsData()

      // Notifier le parent pour rafraîchir les données financières
      if (onSavingsChange) {
        onSavingsChange()
      }

    } catch (error) {
      console.error('❌ [SavingsDrawer] Erreur lors du transfert:', error)
      setValidationError(error instanceof Error ? error.message : 'Erreur lors du transfert')
    } finally {
      setIsProcessing(false)
    }
  }

  // Validation en temps réel
  const validateTransferAmount = (amount: string): { isValid: boolean; error: string } => {
    if (!selectedFromBudget || !amount) {
      return { isValid: false, error: '' }
    }

    const numAmount = parseFloat(amount)

    if (isNaN(numAmount) || numAmount <= 0) {
      return { isValid: false, error: 'Veuillez entrer un montant valide' }
    }

    if (numAmount > (selectedFromBudget.cumulated_savings || 0)) {
      return {
        isValid: false,
        error: `Le montant ne peut pas dépasser ${formatCurrency(selectedFromBudget.cumulated_savings || 0)}`
      }
    }

    return { isValid: true, error: '' }
  }

  // Hook pour valider en temps réel
  useEffect(() => {
    const validation = validateTransferAmount(transferAmount)
    setValidationError(validation.error)
  }, [transferAmount, selectedFromBudget])

  const budgetsWithSavings = savingsData?.budgets.filter(b => (b.cumulated_savings || 0) > 0) || []
  const budgetsWithoutSavings = savingsData?.budgets.filter(b => (b.cumulated_savings || 0) === 0) || []

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      {/* Drawer - Full screen */}
      <div className={cn(
        'fixed inset-0 z-50 bg-white transition-transform duration-300 ease-out flex flex-col',
        isOpen ? 'translate-y-0' : 'translate-y-full'
      )}>
        {/* Header - Sticky */}
        <div className="flex-shrink-0 px-4 py-4 border-b border-gray-200 bg-purple-50/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Répartition des Économies</h2>
                <p className="text-sm text-gray-600">Transférez vos économies entre budgets</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content Area - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Chargement des économies...</p>
              </div>
            </div>
          ) : error ? (
            <div className="p-4">
              <Card className="p-4 bg-red-50 border-red-200">
                <div className="text-center">
                  <div className="text-red-600 mb-2">
                    <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-red-900 mb-2">Erreur</h3>
                  <p className="text-red-700 mb-4">{error}</p>
                  <Button
                    onClick={fetchSavingsData}
                    className="bg-red-600 text-white hover:bg-red-700"
                  >
                    Réessayer
                  </Button>
                </div>
              </Card>
            </div>
          ) : savingsData ? (
            <div className="p-4 space-y-4">
              {/* Statistiques globales */}
              <Card className="p-4 bg-purple-50 border-purple-200">
                <div className="text-center">
                  <h3 className="text-sm font-medium text-purple-900 mb-2">Total des Économies</h3>
                  <p className="text-3xl font-bold text-purple-600">
                    {formatCurrency(savingsData.statistics.total_savings)}
                  </p>
                  <div className="mt-3 pt-3 border-t border-purple-200">
                    <div className="flex justify-between items-center text-sm mb-1">
                      <span className="text-purple-700">Économies budgets:</span>
                      <span className="font-medium text-purple-900">
                        {formatCurrency(savingsData.statistics.budgets_savings)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-purple-700">Tirelire:</span>
                      <span className="font-medium text-purple-900">
                        {formatCurrency(savingsData.piggy_bank)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-purple-700 mt-3">
                    {savingsData.statistics.budgets_with_savings} budget(s) avec économies
                  </p>
                </div>
              </Card>

              {/* Budgets avec économies */}
              {budgetsWithSavings.length > 0 && (
                <Card className="p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    Budgets avec économies ({budgetsWithSavings.length})
                  </h3>
                  <div className="space-y-3">
                    {budgetsWithSavings.map((budget) => (
                      <div
                        key={budget.id}
                        className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200"
                      >
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{budget.name}</h4>
                          <div className="text-sm text-gray-600 mt-1">
                            Budget: {formatCurrency(budget.estimated_amount)}
                          </div>
                          <div className="text-lg font-bold text-green-600 mt-1">
                            {formatCurrency(budget.cumulated_savings || 0)} d'économies
                          </div>
                        </div>
                        <Button
                          onClick={() => handleTransferClick(budget)}
                          disabled={isLoading || isProcessing}
                          variant="outline"
                          size="sm"
                          className="ml-3 border-purple-500 text-purple-600 hover:bg-purple-50"
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
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
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    Autres budgets ({budgetsWithoutSavings.length})
                  </h3>
                  <div className="space-y-3">
                    {budgetsWithoutSavings.map((budget) => (
                      <div
                        key={budget.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{budget.name}</h4>
                          <div className="text-sm text-gray-600 mt-1">
                            Budget: {formatCurrency(budget.estimated_amount)}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            Aucune économie
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {savingsData.budgets.length === 0 && (
                <Card className="p-8">
                  <div className="text-center text-gray-500">
                    <svg className="w-16 h-16 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p className="text-lg font-medium">Aucun budget configuré</p>
                    <p className="text-sm mt-2">Créez des budgets estimés pour commencer à épargner</p>
                  </div>
                </Card>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Modal de transfert */}
      <Dialog open={isTransferModalOpen} onOpenChange={setIsTransferModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transférer des économies</DialogTitle>
          </DialogHeader>

          {selectedFromBudget && (
            <div className="space-y-4">
              <div className="p-3 bg-purple-50 rounded-lg">
                <h4 className="font-medium text-purple-900">Budget source</h4>
                <p className="text-sm text-purple-700">{selectedFromBudget.name}</p>
                <p className="text-sm text-purple-600 font-medium">
                  {formatCurrency(selectedFromBudget.cumulated_savings || 0)} disponibles
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Montant à transférer
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={selectedFromBudget.cumulated_savings || 0}
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Maximum: {formatCurrency(selectedFromBudget.cumulated_savings || 0)}
                </p>
              </div>

              {validationError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600 font-medium">⚠️ {validationError}</p>
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
                  disabled={!selectedToBudget || !transferAmount || isProcessing || !!validationError}
                  className={`text-white ${
                    !selectedToBudget || !transferAmount || isProcessing || !!validationError
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                >
                  {isProcessing ? 'Transfert...' : 'Confirmer'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
