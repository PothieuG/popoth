'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RecapData, BudgetStat } from '@/hooks/useMonthlyRecap'

interface MonthlyRecapStep2Props {
  recapData: RecapData
  onNext: () => void
  onPrevious: () => void
  onTransfer: (fromBudgetId: string, toBudgetId: string, amount: number) => Promise<any>
  onAutoBalance: () => Promise<any>
  isLoading?: boolean
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
  onPrevious,
  onTransfer,
  onAutoBalance,
  isLoading = false
}: MonthlyRecapStep2Props) {
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
  const [selectedFromBudget, setSelectedFromBudget] = useState<BudgetStat | null>(null)
  const [selectedToBudget, setSelectedToBudget] = useState<string>('')
  const [transferAmount, setTransferAmount] = useState<string>('')
  const [isProcessing, setIsProcessing] = useState(false)

  const monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ]

  const currentMonthName = monthNames[recapData.month - 1]
  const budgetsWithSurplus = recapData.budget_stats.filter(budget => budget.surplus > 0)
  const budgetsWithDeficit = recapData.budget_stats.filter(budget => budget.deficit > 0)
  const generalRatio = recapData.total_surplus - recapData.total_deficit

  const handleTransferClick = (budget: BudgetStat) => {
    setSelectedFromBudget(budget)
    setSelectedToBudget('')
    setTransferAmount('')
    setIsTransferModalOpen(true)
  }

  const handleTransferSubmit = async () => {
    if (!selectedFromBudget || !selectedToBudget || !transferAmount) return

    const amount = parseFloat(transferAmount)
    if (isNaN(amount) || amount <= 0) {
      alert('Veuillez entrer un montant valide')
      return
    }

    if (amount > selectedFromBudget.surplus) {
      alert(`Le montant ne peut pas dépasser ${selectedFromBudget.surplus}€`)
      return
    }

    setIsProcessing(true)
    try {
      const result = await onTransfer(selectedFromBudget.id, selectedToBudget, amount)
      if (result) {
        setIsTransferModalOpen(false)
        setSelectedFromBudget(null)
        setSelectedToBudget('')
        setTransferAmount('')
      }
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
        <Card className="p-4 bg-white">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Ratio général de vos budgets</h2>
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
          <Card className="p-4 bg-green-50 border border-green-200">
            <div className="text-center">
              <h4 className="font-medium text-green-900">Total Économies</h4>
              <p className="text-xl font-bold text-green-600 mt-1">
                {formatCurrency(recapData.total_surplus)}
              </p>
              <p className="text-xs text-green-700 mt-1">
                {budgetsWithSurplus.length} budget(s) excédentaire(s)
              </p>
            </div>
          </Card>

          <Card className="p-4 bg-red-50 border border-red-200">
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
          <Button
            onClick={onPrevious}
            variant="outline"
            disabled={isLoading}
            className="px-6 py-2"
          >
            Précédent
          </Button>
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

      {/* Modal de transfert */}
      <Dialog open={isTransferModalOpen} onOpenChange={setIsTransferModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transférer des économies</DialogTitle>
          </DialogHeader>

          {selectedFromBudget && (
            <div className="space-y-4">
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
                <select
                  value={selectedToBudget}
                  onChange={(e) => setSelectedToBudget(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Sélectionner un budget</option>
                  {recapData.budget_stats
                    .filter(budget => budget.id !== selectedFromBudget.id)
                    .map((budget) => (
                      <option key={budget.id} value={budget.id}>
                        {budget.name}
                        {budget.deficit > 0 && ` (${formatCurrency(budget.deficit)} de déficit)`}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Montant à transférer
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={selectedFromBudget.surplus}
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Maximum: {formatCurrency(selectedFromBudget.surplus)}
                </p>
              </div>

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
                  disabled={!selectedToBudget || !transferAmount || isProcessing}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {isProcessing ? 'Transfert...' : 'Confirmer'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}