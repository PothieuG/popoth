'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RecapData, BudgetStat } from '@/hooks/useMonthlyRecap'
import CustomDropdown, { type DropdownOption } from '@/components/ui/CustomDropdown'

interface MonthlyRecapStep2Props {
  recapData: RecapData
  onNext: () => void
  onTransfer: (fromBudgetId: string, toBudgetId: string, amount: number) => Promise<any>
  onAutoBalance: () => Promise<any>
  isLoading?: boolean
  isRefreshing?: boolean
}

/**
 * Étape 2: Affichage et gestion des économies/déficits entre budgets
 * - Liste des budgets avec leurs excédents/déficits
 * - Possibilité de transfert manuel entre budgets
 * - Répartition automatique des excédents
 */
export default function MonthlyRecapStep2({
  recapData,
  onNext,
  onTransfer,
  onAutoBalance,
  isLoading = false,
  isRefreshing = false
}: MonthlyRecapStep2Props) {
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
  const [selectedFromBudget, setSelectedFromBudget] = useState<BudgetStat | null>(null)
  const [selectedToBudget, setSelectedToBudget] = useState<string>('')
  const [transferAmount, setTransferAmount] = useState<string>('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [validationError, setValidationError] = useState<string>('')

  const monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ]

  const currentMonthName = monthNames[recapData.month - 1]
  const budgetsWithSurplus = recapData.budget_stats.filter(budget => budget.surplus > 0)
  const budgetsWithDeficit = recapData.budget_stats.filter(budget => budget.deficit > 0)

  // Recalculer les totaux à partir des budget_stats actuels (peut avoir changé après équilibrage)
  const currentTotalSurplus = recapData.budget_stats.reduce((sum, b) => sum + (b.surplus || 0), 0)
  const currentTotalDeficit = recapData.budget_stats.reduce((sum, b) => sum + (b.deficit || 0), 0)
  const generalRatio = currentTotalSurplus - currentTotalDeficit

  // Reset modal state when recapData changes (after successful transfers)
  useEffect(() => {
    console.log('🎯 [Component] Données dans MonthlyRecapStep2:', {
      totalSurplus: currentTotalSurplus,
      totalDeficit: currentTotalDeficit,
      budgets: recapData.budget_stats.map(b => `${b.name}: ${b.spent_amount}€/${b.estimated_amount}€`)
    })

    // Reset modal state when data changes to prevent stale states
    if (isTransferModalOpen) {
      console.log('🔄 [Component] Data updated, resetting modal state')
      setSelectedToBudget('')
      setTransferAmount('')
      setValidationError('')
    }
  }, [recapData, isTransferModalOpen])

  // Helper function to convert budget stats to dropdown options for transfer mode
  const getTransferDestinationOptions = (): DropdownOption[] => {
    return recapData.budget_stats
      .filter(budget => budget.id !== selectedFromBudget?.id)
      .map(budget => ({
        id: budget.id,
        name: budget.name,
        type: 'expense' as const,
        spentAmount: budget.spent_amount,
        estimatedAmount: budget.estimated_amount,
        economyAmount: budget.surplus > 0 ? budget.surplus : budget.deficit > 0 ? -budget.deficit : 0
      }))
  }

  // Helper function to convert budget stats to dropdown options for recovery mode
  const getRecoverySourceOptions = (): DropdownOption[] => {
    return recapData.budget_stats
      .filter(budget => budget.id !== selectedFromBudget?.id && budget.surplus > 0)
      .map(budget => ({
        id: budget.id,
        name: budget.name,
        type: 'expense' as const,
        spentAmount: budget.spent_amount,
        estimatedAmount: budget.estimated_amount,
        economyAmount: budget.surplus
      }))
  }

  const handleTransferClick = (budget: BudgetStat) => {
    setSelectedFromBudget(budget)
    setSelectedToBudget('')
    setTransferAmount('')
    setValidationError('')
    setIsTransferModalOpen(true)
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
        alert(`Le montant ne peut pas dépasser ${formatCurrency(availableSurplus)} de surplus disponible`)
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

    setIsProcessing(true)
    try {
      let result
      if (selectedFromBudget.surplus > 0) {
        // Mode transfert: de selectedFromBudget vers selectedToBudget
        console.log('🔄 [Frontend] Transfer:', selectedFromBudget.id, '→', selectedToBudget, `${amount}€`)
        result = await onTransfer(selectedFromBudget.id, selectedToBudget, amount)
      } else {
        // Mode récupération: de selectedToBudget vers selectedFromBudget
        console.log('🔄 [Frontend] Recovery:', selectedToBudget, '→', selectedFromBudget.id, `${amount}€`)
        result = await onTransfer(selectedToBudget, selectedFromBudget.id, amount)
      }

      if (result) {
        console.log('✅ [Frontend] Transfert réussi')
        // Close modal immediately without waiting for data refresh
        setIsTransferModalOpen(false)
        setSelectedFromBudget(null)
        setSelectedToBudget('')
        setTransferAmount('')
        // Data will be updated automatically by the hook's refreshRecapData call
      } else {
        console.log('❌ [Frontend] Transfert échoué')
        alert('Erreur lors du transfert. Veuillez réessayer.')
      }
    } catch (error) {
      console.error('❌ [Frontend] Erreur lors du transfert:', error)
      alert('Erreur lors du transfert. Veuillez réessayer.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleAutoBalance = async () => {
    setIsProcessing(true)
    try {
      await onAutoBalance()
    } finally {
      setIsProcessing(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
  }

  // Validation en temps réel du montant de transfert
  const validateTransferAmount = (amount: string): { isValid: boolean; error: string } => {
    if (!selectedFromBudget || !amount) {
      return { isValid: false, error: '' }
    }

    const numAmount = parseFloat(amount)

    if (isNaN(numAmount) || numAmount <= 0) {
      return { isValid: false, error: 'Veuillez entrer un montant valide' }
    }

    if (selectedFromBudget.surplus > 0) {
      // Mode transfert: vérifier que le montant ne dépasse pas le surplus disponible
      const availableSurplus = selectedFromBudget.estimated_amount - selectedFromBudget.spent_amount
      if (numAmount > availableSurplus) {
        return {
          isValid: false,
          error: `Le montant ne peut pas dépasser ${formatCurrency(availableSurplus)} de surplus disponible`
        }
      }
    } else {
      // Mode récupération: vérifier que le montant ne dépasse pas le déficit
      const currentDeficit = selectedFromBudget.spent_amount - selectedFromBudget.estimated_amount
      if (numAmount > currentDeficit) {
        return {
          isValid: false,
          error: `Le montant ne peut pas dépasser ${formatCurrency(currentDeficit)} de déficit à combler`
        }
      }

      // Vérifier aussi que le budget source (selectedToBudget) a assez de surplus
      if (selectedToBudget) {
        const sourceBudget = recapData.budget_stats.find(b => b.id === selectedToBudget)
        if (sourceBudget && numAmount > sourceBudget.surplus) {
          return {
            isValid: false,
            error: `Le budget source n'a que ${formatCurrency(sourceBudget.surplus)} de surplus disponible`
          }
        }
      }
    }

    return { isValid: true, error: '' }
  }

  // Hook pour valider en temps réel quand les champs changent
  useEffect(() => {
    const validation = validateTransferAmount(transferAmount)
    setValidationError(validation.error)
  }, [transferAmount, selectedFromBudget, selectedToBudget, recapData])

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">Récapitulatif {currentMonthName} {recapData.year}</h1>
          <p className="text-sm text-gray-600 mt-1">Étape 2 sur 3 - Gestion des économies</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 space-y-6 overflow-y-auto">
        {/* Ratio général */}
        <Card className={`p-4 bg-white ${isRefreshing ? 'opacity-75' : ''} transition-opacity duration-200`}>
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <h2 className="text-lg font-semibold text-gray-900">Ratio général de vos budgets</h2>
              {isRefreshing && (
                <div className="ml-2 w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              )}
            </div>
            <div className={`text-2xl font-bold mb-2 ${
              generalRatio > 0 ? 'text-green-600' : generalRatio < 0 ? 'text-red-600' : 'text-blue-600'
            }`}>
              {generalRatio > 0 ? '+' : ''}{formatCurrency(generalRatio)}
            </div>
            <p className="text-sm text-gray-600">
              {generalRatio > 0
                ? 'Excédent général - Vous avez bien géré vos budgets !'
                : generalRatio < 0
                ? 'Déficit général - Certains budgets ont été dépassés'
                : 'Budgets équilibrés - Vos prévisions étaient parfaites !'
              }
            </p>
          </div>
        </Card>

        {/* Bouton de répartition automatique */}
        {budgetsWithSurplus.length > 0 && budgetsWithDeficit.length > 0 && (
          <Card className="p-4 bg-orange-50 border border-orange-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-orange-900">Répartition automatique</h3>
                <p className="text-sm text-orange-700 mt-1">
                  Répartir les excédents dans les budgets déficitaires de manière équilibrée
                </p>
              </div>
              <Button
                onClick={handleAutoBalance}
                disabled={isProcessing || isLoading}
                className="bg-orange-500 hover:bg-orange-600 text-white"
              >
                {isProcessing ? 'Traitement...' : 'Auto-répartition'}
              </Button>
            </div>
          </Card>
        )}

         {/* Résumé des totaux */}
        <div className="grid grid-cols-2 gap-4">
          <Card className={`p-4 bg-green-50 border border-green-200 ${isRefreshing ? 'opacity-75' : ''} transition-opacity duration-200`}>
            <div className="text-center">
              <h4 className="font-medium text-green-900">Total Économies</h4>
              <p className="text-xl font-bold text-green-600 mt-1">
                {formatCurrency(currentTotalSurplus)}
              </p>
              <p className="text-xs text-green-700 mt-1">
                {budgetsWithSurplus.length} budget(s) excédentaire(s)
              </p>
            </div>
          </Card>

          <Card className={`p-4 bg-red-50 border border-red-200 ${isRefreshing ? 'opacity-75' : ''} transition-opacity duration-200`}>
            <div className="text-center">
              <h4 className="font-medium text-red-900">Total Déficits</h4>
              <p className="text-xl font-bold text-red-600 mt-1">
                {formatCurrency(recapData.total_deficit)}
              </p>
              <p className="text-xs text-red-700 mt-1">
                {budgetsWithDeficit.length} budget(s) déficitaire(s)
              </p>
            </div>
          </Card>
        </div>

        {/* Liste des budgets */}
        <Card className="p-4 bg-white">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Détail par budget</h3>

          <div className="space-y-3">
            {recapData.budget_stats.map((budget) => (
              <div
                key={budget.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex-1">
                  <h4 className="font-medium text-gray-900">{budget.name}</h4>
                  <div className="text-sm text-gray-600 mt-1">
                    <div>Budgété: {formatCurrency(budget.estimated_amount)}</div>
                    <div>Dépensé: {formatCurrency(budget.spent_amount)}</div>
                  </div>
                  <div className={`text-sm font-medium mt-1 ${getBudgetStatusColor(budget)}`}>
                    {getBudgetStatusText(budget)}
                  </div>
                  {budget.cumulated_savings > 0 && (
                    <div className="text-sm text-purple-600 mt-1">
                      +{formatCurrency(budget.cumulated_savings)} d'économies
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
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
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
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7h16m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    Récupérer
                  </Button>
                )}
              </div>
            ))}
          </div>

          {recapData.budget_stats.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <p>Aucun budget estimé configuré</p>
            </div>
          )}
        </Card>

       
      </div>

      {/* Footer avec navigation */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-500">
            Étape 2 sur 3
          </div>
          <Button
            onClick={onNext}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2"
          >
            Continuer
          </Button>
        </div>
      </div>

      {/* Modal de transfert/récupération */}
      <Dialog open={isTransferModalOpen} onOpenChange={setIsTransferModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedFromBudget?.surplus > 0 ? 'Transférer des économies' : 'Récupérer des fonds'}
            </DialogTitle>
          </DialogHeader>

          {selectedFromBudget && (
            <div className="space-y-4">
              {selectedFromBudget.surplus > 0 ? (
                // Mode transfert (budget avec surplus)
                <>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <h4 className="font-medium text-green-900">Budget source</h4>
                    <p className="text-sm text-green-700">{selectedFromBudget.name}</p>
                    <p className="text-sm text-green-600 font-medium">
                      {formatCurrency(selectedFromBudget.surplus)} disponibles
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
                      max={selectedFromBudget.estimated_amount - selectedFromBudget.spent_amount}
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Maximum: {formatCurrency(selectedFromBudget.estimated_amount - selectedFromBudget.spent_amount)}
                    </p>
                  </div>
                </>
              ) : (
                // Mode récupération (budget avec déficit)
                <>
                  <div className="p-3 bg-red-50 rounded-lg">
                    <h4 className="font-medium text-red-900">Budget en déficit</h4>
                    <p className="text-sm text-red-700">{selectedFromBudget.name}</p>
                    <p className="text-sm text-red-600 font-medium">
                      {formatCurrency(selectedFromBudget.deficit)} de déficit
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Montant à récupérer
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={selectedFromBudget.spent_amount - selectedFromBudget.estimated_amount}
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Maximum: {formatCurrency(selectedFromBudget.spent_amount - selectedFromBudget.estimated_amount)}
                    </p>
                  </div>
                </>
              )}

              {/* Message d'erreur de validation */}
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
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {isProcessing ?
                    (selectedFromBudget.surplus > 0 ? 'Transfert...' : 'Récupération...') :
                    (selectedFromBudget.surplus > 0 ? 'Confirmer' : 'Récupérer')
                  }
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}