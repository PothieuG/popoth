'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface MonthlyRecapStep1Props {
  context: 'profile' | 'group'
  onNext: () => void
}

interface Step1Data {
  current_remaining_to_live: number
  budgetary_remaining_to_live: number
  normal_remaining_to_live: number
  factual_remaining_to_live: number
  piggy_bank_amount: number
  needs_balancing: boolean
  balance_amount: number
  surplus_for_next_step: number
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
  onNext
}: MonthlyRecapStep1Props) {
  const [step1Data, setStep1Data] = useState<Step1Data | null>(null)
  const [isLoading, setIsLoading] = useState(true)
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

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la récupération des données')
      }

      console.log(``)
      console.log(`🎯🎯🎯 ========================================================`)
      console.log(`🎯🎯🎯 [FRONTEND] ÉTAPE 1 - DONNÉES REÇUES`)
      console.log(`🎯🎯🎯 ========================================================`)
      console.log(`💰 RESTE À VIVRE: ${data.current_remaining_to_live}€`)
      console.log(`📊 Est positif: ${data.is_positive}`)
      console.log(`📉 Déficit: ${data.deficit}€`)
      console.log(`💎 Économies disponibles: ${data.total_savings_available}€`)
      console.log(`📊 Excédents disponibles: ${data.total_surplus_available}€`)
      console.log(`💰 Total disponible: ${data.total_available}€`)
      console.log(`✅ Peut équilibrer: ${data.can_balance}`)
      console.log(`✅ Peut équilibrer complètement: ${data.can_fully_balance}`)
      console.log(`🎯🎯🎯 ========================================================`)
      console.log(``)

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

  // L'utilisateur peut toujours continuer - le rééquilibrage se fera automatiquement lors du passage à Step 2
  const canContinue = true

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
            Récupération des données
          </h2>
          <p className="text-gray-600">
            Calcul de votre situation financière...
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
          <p className="text-sm text-gray-600 mt-1">Étape 1 sur 2 - Gestion du reste à vivre</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 space-y-6">
        {/* Reste à vivre - Vue d'ensemble */}
        <Card className="p-6 bg-white">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 text-center mb-4">Vue d&apos;ensemble de votre situation</h2>

            {/* Reste à vivre budgétaire (CIBLE) */}
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-medium text-blue-900">Reste à vivre budgétaire 🎯</h3>
                  <p className="text-xs text-blue-700 mt-1">Objectif à atteindre</p>
                </div>
                <div className="text-2xl font-bold text-blue-600">
                  {formatCurrency(step1Data.budgetary_remaining_to_live)}
                </div>
              </div>
            </div>

            {/* Reste à vivre actuel */}
            <div className={`p-4 rounded-lg border ${step1Data.is_positive ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex justify-between items-center">
                <div>
                  <h3 className={`text-sm font-medium ${step1Data.is_positive ? 'text-green-900' : 'text-red-900'}`}>
                    Reste à vivre
                  </h3>
                  <p className={`text-xs mt-1 ${step1Data.is_positive ? 'text-green-700' : 'text-red-700'}`}>
                    Situation actuelle
                  </p>
                </div>
                <div className={`text-2xl font-bold ${step1Data.is_positive ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(step1Data.normal_remaining_to_live)}
                </div>
              </div>
            </div>

            {/* Total des surplus */}
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-medium text-green-900">
                    Surplus totaux
                  </h3>
                  <p className="text-xs text-green-700 mt-1">
                    Excédents des budgets estimés
                  </p>
                </div>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(step1Data.total_surplus_available)}
                </div>
              </div>
            </div>

            {/* Total des économies */}
            <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-medium text-purple-900">
                    Économies totales
                  </h3>
                  <p className="text-xs text-purple-700 mt-1">
                    Cumulées sur les budgets estimés
                  </p>
                </div>
                <div className="text-2xl font-bold text-purple-600">
                  {formatCurrency(step1Data.total_savings_available)}
                </div>
              </div>
            </div>

            {/* Total de la tirelire */}
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-medium text-amber-900">
                    Total tirelire 🐷
                  </h3>
                  <p className="text-xs text-amber-700 mt-1">
                    Disponible pour équilibrage
                  </p>
                </div>
                <div className="text-2xl font-bold text-amber-600">
                  {formatCurrency(step1Data.piggy_bank_amount)}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Message sur l'écart budgétaire - Carte séparée */}
        {step1Data.needs_balancing && (
          <Card className="p-6 bg-orange-50 border-2 border-orange-300">
            <div className="text-center">
              <div className="text-3xl mb-3">⚠️</div>
              <p className="text-lg font-semibold text-orange-900">
                Il manque {formatCurrency(step1Data.balance_amount)} pour atteindre l&apos;objectif budgétaire
              </p>
            </div>
          </Card>
        )}

        {!step1Data.needs_balancing && step1Data.surplus_for_next_step > 0 && (
          <Card className="p-6 bg-green-50 border-2 border-green-300">
            <div className="text-center">
              <div className="text-3xl mb-3">🎉</div>
              <p className="text-lg font-semibold text-green-900">
                Votre reste à vivre dépasse l&apos;objectif budgétaire de {formatCurrency(step1Data.surplus_for_next_step)}
              </p>
            </div>
          </Card>
        )}

        {!step1Data.needs_balancing && step1Data.surplus_for_next_step === 0 && (
          <Card className="p-6 bg-green-50 border-2 border-green-300">
            <div className="text-center">
              <div className="text-3xl mb-3">✅</div>
              <p className="text-lg font-semibold text-green-900">
                Votre reste à vivre atteint exactement l&apos;objectif budgétaire
              </p>
            </div>
          </Card>
        )}

        {/* Affichage conditionnel selon situation */}
        {step1Data.needs_balancing ? (
          /* Objectif non atteint - Équilibrage nécessaire */
          <>
            {/* Affichage des budgets avec excédents et économies */}
            {(step1Data.budgets_with_surplus.length > 0 || step1Data.budgets_with_savings.length > 0) && (
              <Card className="p-4 bg-white">
                <h3 className="font-medium text-gray-900 mb-4">
                  💰 Budgets disponibles pour atteindre l&apos;objectif
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

            {/* Aperçu des calculs de répartition */}
            <Card className="p-6 bg-white">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900 text-center mb-4">
                  📊 Aperçu des calculs de répartition
                </h3>

                {/* Détails de la répartition */}
                <div className="space-y-3">
                  {/* Tirelire */}
                  <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="text-sm font-medium text-amber-900">Tirelire 🐷</h4>
                      <div className="text-lg font-bold text-amber-600">
                        {formatCurrency(step1Data.piggy_bank_amount)}
                      </div>
                    </div>
                    {step1Data.needs_balancing && step1Data.can_balance && (
                      <p className="text-xs text-amber-700">
                        Utilisée en PREMIER pour équilibrer
                      </p>
                    )}
                    {!step1Data.needs_balancing && (
                      <p className="text-xs text-amber-700">
                        Reste disponible
                      </p>
                    )}
                  </div>

                  {/* Économies */}
                  <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="text-sm font-medium text-purple-900">Économies 💎</h4>
                      <div className="text-lg font-bold text-purple-600">
                        {formatCurrency(step1Data.total_savings_available)}
                      </div>
                    </div>
                    {step1Data.needs_balancing && step1Data.can_balance && (
                      <p className="text-xs text-purple-700">
                        Utilisées après la tirelire (en proportion)
                      </p>
                    )}
                    {!step1Data.needs_balancing && (
                      <p className="text-xs text-purple-700">
                        Restent disponibles
                      </p>
                    )}
                  </div>

                  {/* Surplus */}
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="text-sm font-medium text-green-900">Surplus 📈</h4>
                      <div className="text-lg font-bold text-green-600">
                        {formatCurrency(step1Data.total_surplus_available)}
                      </div>
                    </div>
                    {step1Data.needs_balancing && step1Data.can_balance && (
                      <p className="text-xs text-green-700">
                        Utilisés en dernier (en proportion)
                      </p>
                    )}
                    {!step1Data.needs_balancing && (
                      <p className="text-xs text-green-700">
                        Restent disponibles
                      </p>
                    )}
                  </div>
                </div>

                {/* Résumé de ce qui restera après équilibrage */}
                {step1Data.needs_balancing && step1Data.can_balance && (
                  <div className="p-4 bg-blue-50 rounded-lg border-2 border-blue-300 mt-4">
                    <h4 className="text-sm font-semibold text-blue-900 mb-3 text-center">
                      Après équilibrage automatique
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-blue-800">Montant nécessaire:</span>
                        <span className="font-bold text-blue-900">{formatCurrency(step1Data.balance_amount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-800">Montant disponible:</span>
                        <span className="font-bold text-blue-900">{formatCurrency(step1Data.total_available)}</span>
                      </div>
                      <div className="h-px bg-blue-300 my-2"></div>
                      {(() => {
                        // Calcul de ce qui restera après équilibrage
                        let remaining = step1Data.balance_amount

                        // Phase 1: Tirelire
                        const piggyUsed = Math.min(remaining, step1Data.piggy_bank_amount)
                        remaining -= piggyUsed
                        const piggyRemaining = step1Data.piggy_bank_amount - piggyUsed

                        // Phase 2: Économies (proportionnel)
                        const savingsUsed = Math.min(remaining, step1Data.total_savings_available)
                        remaining -= savingsUsed
                        const savingsRemaining = step1Data.total_savings_available - savingsUsed

                        // Phase 3: Surplus (proportionnel)
                        const surplusUsed = Math.min(remaining, step1Data.total_surplus_available)
                        const surplusRemaining = step1Data.total_surplus_available - surplusUsed

                        return (
                          <>
                            <div className="flex justify-between">
                              <span className="text-blue-800">Tirelire restante:</span>
                              <span className="font-bold text-blue-900">{formatCurrency(piggyRemaining)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-blue-800">Économies restantes:</span>
                              <span className="font-bold text-blue-900">{formatCurrency(savingsRemaining)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-blue-800">Surplus restants:</span>
                              <span className="font-bold text-blue-900">{formatCurrency(surplusRemaining)}</span>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )}

                {/* Message informatif sur le rééquilibrage automatique */}
                <div className="p-4 bg-blue-50 border-2 border-blue-300 rounded-lg mt-4">
                  <p className="text-blue-800 text-sm text-center font-medium">
                    ℹ️ Le rééquilibrage se fera automatiquement lors du passage à l&apos;étape suivante
                  </p>
                  <p className="text-blue-700 text-xs text-center mt-2">
                    Les surplus seront transférés vers les économies, et l&apos;excédent éventuel ira dans la tirelire
                  </p>
                </div>
              </div>
            </Card>
          </>
        ) : (
          /* Objectif atteint - Afficher aperçu des calculs sans bouton */
          <Card className="p-6 bg-white">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 text-center mb-4">
                📊 Aperçu des calculs de répartition
              </h3>

              {/* Détails de la répartition */}
              <div className="space-y-3">
                {/* Tirelire */}
                <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-medium text-amber-900">Tirelire 🐷</h4>
                    <div className="text-lg font-bold text-amber-600">
                      {formatCurrency(step1Data.piggy_bank_amount)}
                    </div>
                  </div>
                  <p className="text-xs text-amber-700">
                    Reste disponible
                  </p>
                </div>

                {/* Économies */}
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-medium text-purple-900">Économies 💎</h4>
                    <div className="text-lg font-bold text-purple-600">
                      {formatCurrency(step1Data.total_savings_available)}
                    </div>
                  </div>
                  <p className="text-xs text-purple-700">
                    Restent disponibles
                  </p>
                </div>

                {/* Surplus */}
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-medium text-green-900">Surplus 📈</h4>
                    <div className="text-lg font-bold text-green-600">
                      {formatCurrency(step1Data.total_surplus_available)}
                    </div>
                  </div>
                  <p className="text-xs text-green-700">
                    Restent disponibles
                  </p>
                </div>
              </div>

              {/* Message informatif */}
              <div className="p-4 bg-green-50 border-2 border-green-300 rounded-lg mt-4">
                <p className="text-green-800 text-sm text-center font-medium">
                  ✅ Aucune action nécessaire - Vous pouvez continuer
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
              <h4 className="text-sm font-medium text-blue-900">Fonctionnement de l&apos;équilibrage</h4>
              <p className="text-xs text-blue-700 mt-1">
                L&apos;objectif est d&apos;atteindre votre reste à vivre budgétaire ({formatCurrency(step1Data.budgetary_remaining_to_live)}).
                L&apos;équilibrage automatique répartit proportionnellement les économies et excédents disponibles
                pour vous rapprocher au maximum de cet objectif.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Footer avec navigation */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-500">
            Étape 1 sur 2
          </div>
          {canContinue && (
            <Button
              onClick={onNext}
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2"
            >
              Continuer
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}