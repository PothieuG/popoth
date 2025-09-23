'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { RecapData } from '@/hooks/useMonthlyRecap'

interface MonthlyRecapStep3Props {
  recapData: RecapData
  onComplete: () => Promise<any>
  remainingToLiveChoice: {
    action: 'carry_forward' | 'deduct_from_budget'
    budget_id?: string
    final_amount: number
  }
  isLoading?: boolean
}

/**
 * Étape 3: Récapitulatif final
 * - Résumé de toutes les actions effectuées
 * - Validation finale et reset des revenus estimés
 */
export default function MonthlyRecapStep3({
  recapData,
  onComplete,
  remainingToLiveChoice,
  isLoading = false
}: MonthlyRecapStep3Props) {
  const [isCompleting, setIsCompleting] = useState(false)

  const monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ]

  const currentMonthName = monthNames[recapData.month - 1]
  const nextMonth = recapData.month === 12 ? 1 : recapData.month + 1
  const nextYear = recapData.month === 12 ? recapData.year + 1 : recapData.year
  const nextMonthName = monthNames[nextMonth - 1]

  const budgetUsedForRemainingToLive = remainingToLiveChoice.budget_id
    ? recapData.budget_stats.find(b => b.id === remainingToLiveChoice.budget_id)
    : null

  // Recalculer les totaux à partir des budget_stats actuels (peut avoir changé après équilibrage)
  const currentTotalSurplus = recapData.budget_stats.reduce((sum, b) => sum + (b.surplus || 0), 0)
  const currentTotalDeficit = recapData.budget_stats.reduce((sum, b) => sum + (b.deficit || 0), 0)

  const estimatedIncomes = recapData.budget_stats.reduce((sum, budget) => sum + budget.estimated_amount, 0)

  const handleComplete = async () => {
    setIsCompleting(true)
    try {
      await onComplete()
    } finally {
      setIsCompleting(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">Récapitulatif {currentMonthName} {recapData.year}</h1>
          <p className="text-sm text-gray-600 mt-1">Étape 3 sur 3 - Validation finale</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 space-y-6 overflow-y-auto">
        {/* Récap du reste à vivre */}
        <Card className="p-6 bg-white">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            <svg className="w-5 h-5 inline mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Gestion du reste à vivre
          </h2>

          <div className="bg-gray-50 rounded-lg p-6 text-center">
            <h4 className="font-medium text-gray-700 mb-2">Reste à vivre final</h4>
            <p className={`text-3xl font-bold ${
              remainingToLiveChoice.final_amount > 0
                ? 'text-green-600'
                : remainingToLiveChoice.final_amount === 0
                  ? 'text-gray-600'
                  : 'text-red-600'
            }`}>
              {remainingToLiveChoice.final_amount > 0 ? '+' : ''}
              {formatCurrency(remainingToLiveChoice.final_amount)}
            </p>
          </div>

          <div className="mt-4 p-3 bg-blue-50 rounded-md">
            <h4 className="font-medium text-blue-900">Action effectuée:</h4>
            <p className="text-blue-700 mt-1">
              {remainingToLiveChoice.action === 'carry_forward' ? (
                <>
                  ✅ Votre reste à vivre de {formatCurrency(recapData.current_remaining_to_live)}
                  sera reporté comme solde de départ pour {nextMonthName} {nextYear}.
                </>
              ) : (
                <>
                  ✅ Le déficit de {formatCurrency(Math.abs(recapData.current_remaining_to_live))}
                  a été compensé par le budget "{budgetUsedForRemainingToLive?.name}".
                  Votre reste à vivre est maintenant à 0€.
                </>
              )}
            </p>
          </div>
        </Card>

        {/* Récap des budgets et économies */}
        <Card className="p-6 bg-white">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            <svg className="w-5 h-5 inline mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v4" />
            </svg>
            Résumé des budgets estimés
          </h2>

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
                  <div className={`text-sm font-medium mt-1 ${
                    budget.surplus > 0
                      ? 'text-green-600'
                      : budget.deficit > 0
                        ? 'text-red-600'
                        : 'text-blue-600'
                  }`}>
                    {budget.surplus > 0 && `+${formatCurrency(budget.surplus)} économisés`}
                    {budget.deficit > 0 && `-${formatCurrency(budget.deficit)} de dépassement`}
                    {budget.surplus === 0 && budget.deficit === 0 && 'Budget respecté'}
                  </div>
                  {(budget.cumulated_savings || 0) > 0 && (
                    <div className="text-sm text-purple-600 mt-1">
                      +{formatCurrency(budget.cumulated_savings || 0)} d'économies
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="p-3 bg-green-50 rounded-lg text-center">
              <h4 className="font-medium text-green-900">Total Économies</h4>
              <p className="text-lg font-bold text-green-600">
                {formatCurrency(currentTotalSurplus)}
              </p>
            </div>
            <div className="p-3 bg-red-50 rounded-lg text-center">
              <h4 className="font-medium text-red-900">Total Déficits</h4>
              <p className="text-lg font-bold text-red-600">
                {formatCurrency(currentTotalDeficit)}
              </p>
            </div>
          </div>
        </Card>

        {/* Reset des revenus estimés */}
        <Card className="p-6 bg-purple-50 border border-purple-200">
          <h2 className="text-lg font-semibold text-purple-900 mb-4">
            <svg className="w-5 h-5 inline mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reset des revenus estimés
          </h2>

          <div className="bg-purple-100 rounded-lg p-4">
            <p className="text-purple-700 mb-3">
              Une fois ce récapitulatif validé, tous vos revenus estimés seront remis à 0€
              pour commencer le nouveau mois avec une ardoise vierge.
            </p>
            <div className="text-sm text-purple-600">
              <p>⚠️ Cette action est irréversible</p>
              <p>✅ Vos budgets estimés seront conservés</p>
              <p>✅ L'historique de vos transactions sera préservé</p>
            </div>
          </div>
        </Card>

        {/* Message d'encouragement */}
        <Card className="p-4 bg-blue-50 border border-blue-200">
          <div className="text-center">
            <h3 className="font-semibold text-blue-900 mb-2">
              Félicitations ! 🎉
            </h3>
            <p className="text-blue-700 text-sm">
              Vous avez terminé votre récapitulatif mensuel pour {currentMonthName} {recapData.year}.
              Vos finances sont maintenant prêtes pour {nextMonthName} {nextYear} !
            </p>
          </div>
        </Card>
      </div>

      {/* Footer avec navigation */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-500">
            Étape 3 sur 3
          </div>
          <Button
            onClick={handleComplete}
            disabled={isLoading || isCompleting}
            className="bg-green-600 hover:bg-green-700 text-white px-6 py-2"
          >
            {isCompleting ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                <span>Finalisation...</span>
              </div>
            ) : (
              'Finaliser le récap'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}