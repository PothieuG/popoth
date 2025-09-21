'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { RecapData } from '@/hooks/useMonthlyRecap'

interface MonthlyRecapStep1Props {
  recapData: RecapData
  onNext: () => void
  onRemainingToLiveChoice: (choice: { action: 'carry_forward' | 'deduct_from_budget', budget_id?: string, final_amount: number }) => void
  isLoading?: boolean
}

/**
 * Étape 1: Récap du reste à vivre
 * - Si positif: option de report au mois prochain
 * - Si négatif: choix d'un budget estimé pour amputer la différence
 */
export default function MonthlyRecapStep1({
  recapData,
  onNext,
  onRemainingToLiveChoice,
  isLoading = false
}: MonthlyRecapStep1Props) {
  const [selectedChoice, setSelectedChoice] = useState<'carry_forward' | 'deduct_from_budget' | null>(null)
  const [selectedBudgetId, setSelectedBudgetId] = useState<string>('')

  const currentRemainingToLive = recapData.current_remaining_to_live
  const isPositive = currentRemainingToLive >= 0
  const monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ]

  const currentMonthName = monthNames[recapData.month - 1]
  const budgetsWithSurplus = recapData.budget_stats.filter(budget => budget.surplus > 0)

  const handleNext = () => {
    if (selectedChoice === 'carry_forward') {
      onRemainingToLiveChoice({
        action: 'carry_forward',
        final_amount: currentRemainingToLive
      })
    } else if (selectedChoice === 'deduct_from_budget' && selectedBudgetId) {
      onRemainingToLiveChoice({
        action: 'deduct_from_budget',
        budget_id: selectedBudgetId,
        final_amount: 0 // Le reste à vivre sera remis à 0€
      })
    }
    onNext()
  }

  const canProceed = selectedChoice === 'carry_forward' ||
                    (selectedChoice === 'deduct_from_budget' && selectedBudgetId)

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">Récapitulatif {currentMonthName} {recapData.year}</h1>
          <p className="text-sm text-gray-600 mt-1">Étape 1 sur 3 - Gestion du reste à vivre</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 space-y-6">
        {/* Reste à vivre actuel */}
        <Card className="p-6 bg-white">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Votre reste à vivre actuel</h2>
            <div className={`text-3xl font-bold mb-4 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
              {isPositive ? '+' : ''}{currentRemainingToLive.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
            </div>
            <p className="text-sm text-gray-600">
              {isPositive
                ? 'Félicitations ! Vous avez un excédent ce mois-ci.'
                : 'Votre reste à vivre est négatif, vous devez choisir un budget pour compenser.'
              }
            </p>
          </div>
        </Card>

        {/* Options de gestion */}
        {isPositive ? (
          /* Reste à vivre positif - Option de report */
          <Card className="p-6 bg-white">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Que souhaitez-vous faire ?</h3>

            <div className="space-y-3">
              <button
                onClick={() => setSelectedChoice('carry_forward')}
                className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                  selectedChoice === 'carry_forward'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start space-x-3">
                  <div className={`w-4 h-4 rounded-full border-2 mt-1 ${
                    selectedChoice === 'carry_forward'
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-gray-300'
                  }`} />
                  <div>
                    <h4 className="font-medium text-gray-900">Reporter au mois prochain</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      Vos {currentRemainingToLive.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                      seront reportés comme solde de départ pour le mois prochain.
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </Card>
        ) : (
          /* Reste à vivre négatif - Choix du budget à amputer */
          <Card className="p-6 bg-white">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Choisissez un budget estimé pour compenser le déficit
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Vous devez choisir un budget estimé qui sera amputé de {Math.abs(currentRemainingToLive).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
              pour ramener votre reste à vivre à 0€.
            </p>

            {budgetsWithSurplus.length === 0 ? (
              <div className="space-y-4">
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-700 text-sm">
                    ⚠️ Aucun budget avec des économies disponibles.
                  </p>
                </div>

                <button
                  onClick={() => setSelectedChoice('carry_forward')}
                  className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                    selectedChoice === 'carry_forward'
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <div className={`w-4 h-4 rounded-full border-2 mt-1 ${
                      selectedChoice === 'carry_forward'
                        ? 'border-orange-500 bg-orange-500'
                        : 'border-gray-300'
                    }`} />
                    <div>
                      <h4 className="font-medium text-gray-900">Continuer avec le déficit</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        Votre reste à vivre restera à {currentRemainingToLive.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}.
                        Vous pourrez gérer ce déficit dans l'étape suivante en transférant des économies entre budgets.
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={() => setSelectedChoice('deduct_from_budget')}
                  className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                    selectedChoice === 'deduct_from_budget'
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <div className={`w-4 h-4 rounded-full border-2 mt-1 ${
                      selectedChoice === 'deduct_from_budget'
                        ? 'border-red-500 bg-red-500'
                        : 'border-gray-300'
                    }`} />
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900">Amputer un budget estimé</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        Sélectionnez un budget qui sera réduit pour compenser le déficit.
                      </p>

                      {selectedChoice === 'deduct_from_budget' && (
                        <div className="mt-3 space-y-2">
                          {budgetsWithSurplus.map((budget) => (
                            <button
                              key={budget.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedBudgetId(budget.id)
                              }}
                              className={`w-full p-3 rounded-md border text-left transition-colors ${
                                selectedBudgetId === budget.id
                                  ? 'border-red-400 bg-red-100'
                                  : 'border-gray-200 hover:border-gray-300 bg-white'
                              }`}
                            >
                              <div className="flex justify-between items-center">
                                <span className="font-medium text-gray-900">{budget.name}</span>
                                <span className="text-sm text-green-600">
                                  {budget.surplus.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} d'économies
                                </span>
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                Budget: {budget.estimated_amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} /
                                Dépensé: {budget.spent_amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              </div>
            )}
          </Card>
        )}

        {/* Informations complémentaires */}
        <Card className="p-4 bg-blue-50 border border-blue-200">
          <div className="flex items-start space-x-2">
            <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="text-sm font-medium text-blue-900">Information importante</h4>
              <p className="text-xs text-blue-700 mt-1">
                Cette étape est obligatoire et ne peut pas être ignorée. Une fois validée,
                vous passerez à l'étape de gestion des économies entre vos budgets.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Footer avec navigation */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-500">
            Étape 1 sur 3
          </div>
          <Button
            onClick={handleNext}
            disabled={!canProceed || isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2"
          >
            {isLoading ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                <span>Traitement...</span>
              </div>
            ) : (
              'Continuer'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}