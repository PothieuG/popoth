'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface MonthlyRecapStep1Props {
  context: 'profile' | 'group'
  onNext: () => void
  onBalanceRemainingToLive: () => Promise<any>
}

interface Step1Data {
  current_remaining_to_live: number
  is_positive: boolean
  deficit: number
  budgets_with_surplus: Array<{
    id: string
    name: string
    estimated_amount: number
    spent_amount: number
    surplus: number
  }>
  budgets_with_savings: Array<{
    id: string
    name: string
    estimated_amount: number
    spent_amount: number
    savings: number
  }>
  total_surplus_available: number
  total_savings_available: number
  total_available: number
  can_balance: boolean
  can_fully_balance: boolean
  user_name: string
}

/**
 * Étape 1: Récap du reste à vivre - VERSION STATELESS SANS CACHE
 * - Récupère toutes les données en temps réel depuis l'API step1-data
 * - Si positif/nul: affichage du report automatique
 * - Si négatif: liste des budgets avec excédents et bouton d'équilibrage automatique
 */
export default function MonthlyRecapStep1({
  context,
  onNext,
  onBalanceRemainingToLive
}: MonthlyRecapStep1Props) {
  const [step1Data, setStep1Data] = useState<Step1Data | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isBalanceCompleted, setIsBalanceCompleted] = useState(false)
  const [balanceResult, setBalanceResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ]

  const currentDate = new Date()
  const currentMonthName = monthNames[currentDate.getMonth()]
  const currentYear = currentDate.getFullYear()

  /**
   * Récupère les données live depuis l'API step1-data
   */
  const fetchStep1Data = async () => {
    try {
      setIsLoading(true)
      setError(null)

      console.log('🔄 [Step1] Récupération des données live depuis l\'API step1-data')

      const response = await fetch(`/api/monthly-recap/step1-data?context=${context}`)
      const data = await response.json()
      console.log(data);

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la récupération des données')
      }

      console.log('✅ [Step1] Données live récupérées:', data)
      setStep1Data(data)

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      console.error('❌ [Step1] Erreur lors de la récupération des données:', err)
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // Récupérer les données au montage du composant
  useEffect(() => {
    fetchStep1Data()
  }, [context])

  // Debug des données récupérées
  useEffect(() => {
    if (step1Data) {
      console.log('🎯 [STEP 1 LIVE] === DONNÉES LIVE RÉCUPÉRÉES ===')
      console.log('🎯 [STEP 1 LIVE] Step1Data:', step1Data)
      console.log('')

      console.log('💰 [STEP 1 LIVE] RESTE À VIVRE:')
      console.log(`💰 [STEP 1 LIVE] - Montant: ${step1Data.current_remaining_to_live}€`)
      console.log(`💰 [STEP 1 LIVE] - Statut: ${step1Data.is_positive ? 'POSITIF/NUL ✅' : 'NÉGATIF ❌'}`)
      console.log('')

      console.log('📊 [STEP 1 LIVE] ANALYSE BUDGETS:')
      console.log(`📊 [STEP 1 LIVE] - Budgets avec surplus: ${step1Data.budgets_with_surplus.length}`)
      console.log(`📊 [STEP 1 LIVE] - Budgets avec économies: ${step1Data.budgets_with_savings.length}`)
      console.log(`📊 [STEP 1 LIVE] - Total surplus: ${step1Data.total_surplus_available}€`)
      console.log(`📊 [STEP 1 LIVE] - Total économies: ${step1Data.total_savings_available}€`)
      console.log(`📊 [STEP 1 LIVE] - Total disponible: ${step1Data.total_available}€`)
      console.log('')

      if (!step1Data.is_positive) {
        console.log(`📉 [STEP 1 LIVE] Déficit à équilibrer: ${step1Data.deficit}€`)
        console.log(`💡 [STEP 1 LIVE] Peut équilibrer complètement: ${step1Data.can_fully_balance ? 'OUI ✅' : 'PARTIELLEMENT ⚠️'}`)
      }

      console.log('🎯 [STEP 1 LIVE] === FIN ANALYSE ===')
    }
  }, [step1Data])

  const handleBalanceClick = async () => {
    try {
      setIsProcessing(true)
      console.log('🔄 [Step1] Début du rééquilibrage')

      const result = await onBalanceRemainingToLive()
      if (result) {
        console.log('✅ [Step1] Rééquilibrage terminé avec succès')
        setBalanceResult(result)
        setIsBalanceCompleted(true)

        // IMPORTANT: Récupérer les nouvelles données après rééquilibrage
        console.log('🔄 [Step1] Récupération des nouvelles données après rééquilibrage')
        await fetchStep1Data()
      }
    } catch (error) {
      console.error('❌ [Step1] Erreur lors de l\'équilibrage:', error)
      setError('Erreur lors de l\'équilibrage automatique. Veuillez réessayer.')
    } finally {
      setIsProcessing(false)
    }
  }

  // Déterminer si le bouton "Continuer" doit être affiché
  const canContinue = step1Data ? (step1Data.is_positive || isBalanceCompleted) : false

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
  }

  // État de chargement ou d'erreur
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Récupération des données live
          </h2>
          <p className="text-gray-600">
            Calcul en temps réel de votre situation financière...
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full text-center">
          <div className="text-red-600 mb-4">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Erreur</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button
            onClick={fetchStep1Data}
            className="w-full bg-red-600 text-white hover:bg-red-700"
          >
            Réessayer
          </Button>
        </div>
      </div>
    )
  }

  if (!step1Data) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">Récapitulatif {currentMonthName} {currentYear}</h1>
          <p className="text-sm text-gray-600 mt-1">Étape 1 sur 3 - Gestion du reste à vivre</p>
          <p className="text-xs text-blue-600 mt-1">📡 Données live depuis la base de données</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 space-y-6">
        {/* Reste à vivre actuel */}
        <Card className="p-6 bg-white">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Votre reste à vivre actuel</h2>
            <div className={`text-3xl font-bold mb-4 ${step1Data.is_positive ? 'text-green-600' : 'text-red-600'}`}>
              {step1Data.is_positive ? '+' : ''}{formatCurrency(step1Data.current_remaining_to_live)}
            </div>
            <p className="text-sm text-gray-600">
              {step1Data.is_positive
                ? 'Félicitations ! Vous avez un excédent ce mois-ci.'
                : 'Votre reste à vivre est négatif, vous pouvez l\'équilibrer automatiquement.'
              }
            </p>
          </div>
        </Card>

        {/* Reste à vivre positif ou nul - Report automatique */}
        {step1Data.is_positive ? (
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
                Votre reste à vivre de {formatCurrency(step1Data.current_remaining_to_live)} sera automatiquement
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
            {(step1Data.budgets_with_surplus.length > 0 || step1Data.budgets_with_savings.length > 0) && (
              <Card className="p-4 bg-white">
                <h3 className="font-medium text-gray-900 mb-4">
                  💰 Budgets disponibles pour équilibrage
                </h3>

                <div className="space-y-3">
                  {/* Budgets avec excédents */}
                  {step1Data.budgets_with_surplus.map(budget => (
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
                      </div>
                    </div>
                  ))}

                  {/* Budgets avec économies */}
                  {step1Data.budgets_with_savings.map(budget => (
                    <div key={`savings-${budget.id}`} className="flex justify-between items-center p-3 bg-purple-50 rounded-lg border border-purple-200">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{budget.name}</h4>
                        <div className="text-sm text-gray-600 mt-1">
                          <div>Budget: {formatCurrency(budget.estimated_amount)} / Dépensé: {formatCurrency(budget.spent_amount)}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-purple-600">
                          +{formatCurrency(budget.savings)} économies
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
                      {formatCurrency(step1Data.deficit)}
                    </div>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="font-medium text-green-900">Total disponible</div>
                    <div className="text-xl font-bold text-green-600 mt-1">
                      {formatCurrency(step1Data.total_available)}
                    </div>
                  </div>
                </div>

                {step1Data.can_balance ? (
                  <div className="space-y-4">
                    <div className="text-sm text-gray-600">
                      L'équilibrage utilisera en priorité les économies, puis les excédents,
                      de manière proportionnelle et équitable.
                    </div>

                    {step1Data.can_fully_balance ? (
                      <div className="inline-flex items-center px-3 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full mb-4">
                        ✅ Équilibrage complet possible
                      </div>
                    ) : (
                      <div className="inline-flex items-center px-3 py-1 bg-orange-100 text-orange-800 text-sm font-medium rounded-full mb-4">
                        ⚠️ Équilibrage partiel ({formatCurrency(step1Data.deficit - step1Data.total_available)} restera en déficit)
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

        {/* Résultats après rééquilibrage */}
        {isBalanceCompleted && balanceResult && (
          <Card className="p-6 bg-green-50 border border-green-200">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-green-900 mb-4">
                ✅ Rééquilibrage terminé avec succès !
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="p-4 bg-white rounded-lg border border-green-200">
                  <h4 className="font-medium text-green-900 mb-2">Votre reste à vivre après rééquilibrage</h4>
                  <div className="text-2xl font-bold text-green-600">
                    {formatCurrency(balanceResult.final_remaining_to_live || 0)}
                  </div>
                </div>

                <div className="p-4 bg-white rounded-lg border border-green-200">
                  <h4 className="font-medium text-green-900 mb-2">Montant redistribué</h4>
                  <div className="text-2xl font-bold text-blue-600">
                    {formatCurrency(balanceResult.deficit_covered || 0)}
                  </div>
                </div>
              </div>

              {balanceResult.budget_stats && (
                <div>
                  <h4 className="font-medium text-green-900 mb-3">Économies restantes après rééquilibrage</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {balanceResult.budget_stats
                      .filter((budget: any) => budget.surplus > 0 || (budget.cumulated_savings || 0) > 0)
                      .map((budget: any) => (
                        <div key={budget.id} className="p-3 bg-white rounded-lg border border-green-200 text-left">
                          <div className="font-medium text-gray-900">{budget.name}</div>
                          {budget.surplus > 0 && (
                            <div className="text-sm text-green-600">
                              Surplus: {formatCurrency(budget.surplus)}
                            </div>
                          )}
                          {(budget.cumulated_savings || 0) > 0 && (
                            <div className="text-sm text-purple-600">
                              Économies: {formatCurrency(budget.cumulated_savings || 0)}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div className="mt-4 p-3 bg-green-200 rounded-lg">
                <p className="text-green-800 text-sm">
                  🎉 Votre situation financière a été équilibrée ! Vous pouvez maintenant continuer vers l'étape suivante.
                </p>
              </div>
            </div>
          </Card>
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
                pour optimiser votre situation financière. Données mises à jour en temps réel depuis la base.
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
          {canContinue && (
            <Button
              onClick={onNext}
              disabled={isLoading || isProcessing}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2"
            >
              {isProcessing ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  <span>Traitement...</span>
                </div>
              ) : (
                'Continuer'
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}