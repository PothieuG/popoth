'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { RecapData } from '@/hooks/useMonthlyRecap'

interface MonthlyRecapStep1Props {
  recapData: RecapData
  onNext: () => void
  onBalanceRemainingToLive: () => Promise<any>
  isLoading?: boolean
  isProcessing?: boolean
}

/**
 * Étape 1: Récap du reste à vivre
 * - Si positif/nul: affichage du report automatique
 * - Si négatif: liste des budgets avec excédents et bouton d'équilibrage automatique
 */
export default function MonthlyRecapStep1({
  recapData,
  onNext,
  onBalanceRemainingToLive,
  isLoading = false,
  isProcessing = false
}: MonthlyRecapStep1Props) {
  const currentRemainingToLive = recapData.current_remaining_to_live
  const isPositive = currentRemainingToLive >= 0
  const monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ]

  const currentMonthName = monthNames[recapData.month - 1]

  // Budgets avec excédents (dépensé < estimé)
  const budgetsWithSurplus = recapData.budget_stats.filter(budget => budget.surplus > 0)

  // Budgets avec économies
  const budgetsWithSavings = recapData.budget_stats.filter(budget => (budget.cumulated_savings || 0) > 0)

  // Calcul du total disponible pour équilibrage
  const totalSurplus = budgetsWithSurplus.reduce((sum, b) => sum + b.surplus, 0)
  const totalSavings = budgetsWithSavings.reduce((sum, b) => sum + (b.cumulated_savings || 0), 0)
  const totalAvailable = totalSurplus + totalSavings

  // Debug detaillé de toutes les données
  useEffect(() => {
    console.log('🎯 [STEP 1 NEW] === ANALYSE NOUVELLE LOGIQUE ===')
    console.log('🎯 [STEP 1 NEW] RecapData:', recapData)
    console.log('')

    console.log('💰 [STEP 1 NEW] RESTE À VIVRE:')
    console.log(`💰 [STEP 1 NEW] - Montant: ${currentRemainingToLive}€`)
    console.log(`💰 [STEP 1 NEW] - Statut: ${isPositive ? 'POSITIF/NUL ✅' : 'NÉGATIF ❌'}`)
    console.log('')

    console.log('📊 [STEP 1 NEW] ANALYSE BUDGETS:')
    console.log(`📊 [STEP 1 NEW] - Budgets avec surplus: ${budgetsWithSurplus.length}`)
    console.log(`📊 [STEP 1 NEW] - Budgets avec économies: ${budgetsWithSavings.length}`)
    console.log(`📊 [STEP 1 NEW] - Total surplus: ${totalSurplus}€`)
    console.log(`📊 [STEP 1 NEW] - Total économies: ${totalSavings}€`)
    console.log(`📊 [STEP 1 NEW] - Total disponible: ${totalAvailable}€`)
    console.log('')

    if (!isPositive) {
      const deficit = Math.abs(currentRemainingToLive)
      console.log(`📉 [STEP 1 NEW] Déficit à équilibrer: ${deficit}€`)
      console.log(`💡 [STEP 1 NEW] Peut équilibrer: ${totalAvailable >= deficit ? 'OUI ✅' : 'PARTIELLEMENT ⚠️'}`)
    }

    console.log('🎯 [STEP 1 NEW] === FIN ANALYSE ===')
  }, [recapData, currentRemainingToLive, isPositive, budgetsWithSurplus, budgetsWithSavings, totalSurplus, totalSavings, totalAvailable])

  const handleBalanceClick = async () => {
    try {
      await onBalanceRemainingToLive()
    } catch (error) {
      console.error('❌ [STEP 1] Erreur lors de l\'équilibrage:', error)
      alert('Erreur lors de l\'équilibrage automatique. Veuillez réessayer.')
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
              {isPositive ? '+' : ''}{formatCurrency(currentRemainingToLive)}
            </div>
            <p className="text-sm text-gray-600">
              {isPositive
                ? 'Félicitations ! Vous avez un excédent ce mois-ci.'
                : 'Votre reste à vivre est négatif, vous pouvez l\'équilibrer automatiquement.'
              }
            </p>
          </div>
        </Card>

        {/* Reste à vivre positif ou nul - Report automatique */}
        {isPositive ? (
          <Card className="p-6 bg-green-50 border border-green-200">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-green-900 mb-2">
                Reste à vivre reporté automatiquement
              </h3>
              <p className="text-green-700 mb-4">
                Votre reste à vivre de {formatCurrency(currentRemainingToLive)} sera automatiquement
                reporté comme solde de départ pour le mois prochain.
              </p>
              <div className="inline-flex items-center px-3 py-1 bg-green-200 text-green-800 text-sm font-medium rounded-full">
                ✅ Aucune action nécessaire
              </div>
            </div>
          </Card>
        ) : (
          /* Reste à vivre négatif - Équilibrage automatique */
          <>
            {/* Affichage des budgets avec excédents et économies */}
            {(budgetsWithSurplus.length > 0 || budgetsWithSavings.length > 0) && (
              <Card className="p-4 bg-white">
                <h3 className="font-medium text-gray-900 mb-4">
                  💰 Budgets disponibles pour équilibrage
                </h3>

                <div className="space-y-3">
                  {/* Budgets avec excédents */}
                  {budgetsWithSurplus.map(budget => (
                    <div key={`surplus-${budget.id}`} className="flex justify-between items-center p-3 bg-green-50 rounded-lg border border-green-200">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{budget.name}</h4>
                        <div className="text-sm text-gray-600 mt-1">
                          <div>Budget: {formatCurrency(budget.estimated_amount)} / Dépensé: {formatCurrency(budget.spent_amount)}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-green-600">
                          +{formatCurrency(budget.surplus)} excédent
                        </div>
                        {(budget.cumulated_savings || 0) > 0 && (
                          <div className="text-xs text-purple-600">
                            +{formatCurrency(budget.cumulated_savings || 0)} économies
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Budgets avec seulement des économies (pas d'excédent) */}
                  {budgetsWithSavings
                    .filter(budget => budget.surplus === 0)
                    .map(budget => (
                    <div key={`savings-${budget.id}`} className="flex justify-between items-center p-3 bg-purple-50 rounded-lg border border-purple-200">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{budget.name}</h4>
                        <div className="text-sm text-gray-600 mt-1">
                          <div>Budget: {formatCurrency(budget.estimated_amount)} / Dépensé: {formatCurrency(budget.spent_amount)}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-purple-600">
                          +{formatCurrency(budget.cumulated_savings || 0)} économies
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Calcul total et bouton d'action */}
            <Card className="p-6 bg-white">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Équilibrage automatique du reste à vivre
                </h3>

                <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                  <div className="p-3 bg-red-50 rounded-lg">
                    <div className="font-medium text-red-900">Déficit à combler</div>
                    <div className="text-xl font-bold text-red-600 mt-1">
                      {formatCurrency(Math.abs(currentRemainingToLive))}
                    </div>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="font-medium text-green-900">Total disponible</div>
                    <div className="text-xl font-bold text-green-600 mt-1">
                      {formatCurrency(totalAvailable)}
                    </div>
                  </div>
                </div>

                {totalAvailable > 0 ? (
                  <div className="space-y-4">
                    <div className="text-sm text-gray-600">
                      L'équilibrage utilisera en priorité les économies, puis les excédents,
                      de manière proportionnelle et équitable.
                    </div>

                    {totalAvailable >= Math.abs(currentRemainingToLive) ? (
                      <div className="inline-flex items-center px-3 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full mb-4">
                        ✅ Équilibrage complet possible
                      </div>
                    ) : (
                      <div className="inline-flex items-center px-3 py-1 bg-orange-100 text-orange-800 text-sm font-medium rounded-full mb-4">
                        ⚠️ Équilibrage partiel ({formatCurrency(Math.abs(currentRemainingToLive) - totalAvailable)} restera en déficit)
                      </div>
                    )}

                    <Button
                      onClick={handleBalanceClick}
                      disabled={isLoading || isProcessing}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 text-lg font-medium"
                    >
                      {isProcessing ? (
                        <div className="flex items-center justify-center space-x-2">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                          <span>Équilibrage en cours...</span>
                        </div>
                      ) : (
                        <>
                          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                          Équilibrer automatiquement le reste à vivre
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                      <p className="text-orange-700 text-sm">
                        ⚠️ Aucun excédent ou économie disponible pour équilibrer le déficit.
                      </p>
                    </div>
                    <div className="text-sm text-gray-600">
                      Vous pouvez continuer avec le déficit et le gérer dans l'étape suivante
                      en utilisant les fonctionnalités de transfert entre budgets.
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </>
        )}

        {/* Informations complémentaires */}
        <Card className="p-4 bg-blue-50 border border-blue-200">
          <div className="flex items-start space-x-2">
            <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="text-sm font-medium text-blue-900">Fonctionnement de l'équilibrage</h4>
              <p className="text-xs text-blue-700 mt-1">
                L'équilibrage automatique répartit proportionnellement les montants disponibles
                pour optimiser votre situation financière tout en préservant vos surplus non utilisés.
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
            onClick={onNext}
            disabled={isLoading || isProcessing}
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