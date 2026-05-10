'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useStep1Data } from '@/hooks/useStep1Data'

interface MonthlyRecapStep1Props {
  context: 'profile' | 'group'
  onNext: () => void | Promise<void>
}

/**
 * Étape 1: Récap du reste à vivre - VERSION STATELESS SANS CACHE
 * - Récupère toutes les données en temps réel depuis l'API step1-data
 * - Si positif/nul: affichage du report automatique
 * - Si négatif: liste des budgets avec excédents et bouton d'équilibrage automatique
 */
export default function MonthlyRecapStep1({ context, onNext }: MonthlyRecapStep1Props) {
  const {
    data: step1Data,
    loading: isLoading,
    error,
    refresh: fetchStep1Data,
  } = useStep1Data(context)
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  const currentDate = new Date()
  const currentMonthName = monthNames[currentDate.getMonth()]
  const currentYear = currentDate.getFullYear()

  // L'utilisateur peut toujours continuer - le rééquilibrage se fera automatiquement lors du passage à Step 2
  const canContinue = true

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
  }

  // État de chargement ou d'erreur
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-blue-600"></div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">Récupération des données</h2>
          <p className="text-gray-600">Calcul de votre situation financière...</p>
        </div>
      </div>
    )
  }

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
    <div className="flex h-[100dvh] flex-col bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">
            Récapitulatif {currentMonthName} {currentYear}
          </h1>
          <p className="mt-1 text-sm text-gray-600">Étape 1 sur 2 - Gestion du reste à vivre</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {/* Reste à vivre - Vue d'ensemble */}
        <Card className="bg-white p-6">
          <div className="space-y-4">
            <h2 className="mb-4 text-center text-lg font-semibold text-gray-900">
              Vue d&apos;ensemble de votre situation
            </h2>

            {/* Reste à vivre budgétaire (CIBLE) */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-blue-900">Reste à vivre budgétaire 🎯</h3>
                  <p className="mt-1 text-xs text-blue-700">Objectif à atteindre</p>
                </div>
                <div className="text-2xl font-bold text-blue-600">
                  {formatCurrency(step1Data.budgetary_remaining_to_live)}
                </div>
              </div>
            </div>

            {/* Reste à vivre actuel */}
            <div
              className={`rounded-lg border p-4 ${step1Data.is_positive ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3
                    className={`text-sm font-medium ${step1Data.is_positive ? 'text-green-900' : 'text-red-900'}`}
                  >
                    Reste à vivre
                  </h3>
                  <p
                    className={`mt-1 text-xs ${step1Data.is_positive ? 'text-green-700' : 'text-red-700'}`}
                  >
                    Situation actuelle
                  </p>
                </div>
                <div
                  className={`text-2xl font-bold ${step1Data.is_positive ? 'text-green-600' : 'text-red-600'}`}
                >
                  {formatCurrency(step1Data.normal_remaining_to_live)}
                </div>
              </div>
            </div>

            {/* Total des surplus */}
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-green-900">Surplus totaux</h3>
                  <p className="mt-1 text-xs text-green-700">Excédents des budgets estimés</p>
                </div>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(step1Data.total_surplus_available)}
                </div>
              </div>
            </div>

            {/* Total des économies */}
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-purple-900">Économies totales</h3>
                  <p className="mt-1 text-xs text-purple-700">Cumulées sur les budgets estimés</p>
                </div>
                <div className="text-2xl font-bold text-purple-600">
                  {formatCurrency(step1Data.total_savings_available)}
                </div>
              </div>
            </div>

            {/* Total de la tirelire */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-amber-900">Total tirelire 🐷</h3>
                  <p className="mt-1 text-xs text-amber-700">Disponible pour équilibrage</p>
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
          <Card className="border-2 border-orange-300 bg-orange-50 p-6">
            <div className="text-center">
              <div className="mb-3 text-3xl">⚠️</div>
              <p className="text-lg font-semibold text-orange-900">
                Il manque {formatCurrency(step1Data.balance_amount)} pour atteindre l&apos;objectif
                budgétaire
              </p>
            </div>
          </Card>
        )}

        {!step1Data.needs_balancing && step1Data.surplus_for_next_step > 0 && (
          <Card className="border-2 border-green-300 bg-green-50 p-6">
            <div className="text-center">
              <div className="mb-3 text-3xl">🎉</div>
              <p className="text-lg font-semibold text-green-900">
                Votre reste à vivre dépasse l&apos;objectif budgétaire de{' '}
                {formatCurrency(step1Data.surplus_for_next_step)}
              </p>
            </div>
          </Card>
        )}

        {!step1Data.needs_balancing && step1Data.surplus_for_next_step === 0 && (
          <Card className="border-2 border-green-300 bg-green-50 p-6">
            <div className="text-center">
              <div className="mb-3 text-3xl">✅</div>
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
            {(step1Data.budgets_with_surplus.length > 0 ||
              step1Data.budgets_with_savings.length > 0) && (
              <Card className="bg-white p-4">
                <h3 className="mb-4 font-medium text-gray-900">
                  💰 Budgets disponibles pour atteindre l&apos;objectif
                </h3>

                <div className="space-y-3">
                  {/* Budgets avec excédents */}
                  {step1Data.budgets_with_surplus.map((budget) => (
                    <div
                      key={`surplus-${budget.id}`}
                      className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3"
                    >
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{budget.name}</h4>
                        <div className="mt-1 text-sm text-gray-600">
                          <div>
                            Budget: {formatCurrency(budget.estimated_amount)} / Dépensé:{' '}
                            {formatCurrency(budget.spent_amount)}
                          </div>
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
                  {step1Data.budgets_with_savings.map((budget) => (
                    <div
                      key={`savings-${budget.id}`}
                      className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 p-3"
                    >
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{budget.name}</h4>
                        <div className="mt-1 text-sm text-gray-600">
                          <div>
                            Budget: {formatCurrency(budget.estimated_amount)} / Dépensé:{' '}
                            {formatCurrency(budget.spent_amount)}
                          </div>
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
            <Card className="bg-white p-6">
              <div className="space-y-4">
                <h3 className="mb-4 text-center text-lg font-semibold text-gray-900">
                  📊 Aperçu des calculs de répartition
                </h3>

                {/* Détails de la répartition */}
                <div className="space-y-3">
                  {/* Tirelire */}
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-medium text-amber-900">Tirelire 🐷</h4>
                      <div className="text-lg font-bold text-amber-600">
                        {formatCurrency(step1Data.piggy_bank_amount)}
                      </div>
                    </div>
                    {step1Data.needs_balancing && step1Data.can_balance && (
                      <p className="text-xs text-amber-700">Utilisée en PREMIER pour équilibrer</p>
                    )}
                    {!step1Data.needs_balancing && (
                      <p className="text-xs text-amber-700">Reste disponible</p>
                    )}
                  </div>

                  {/* Économies */}
                  <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
                    <div className="mb-2 flex items-center justify-between">
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
                      <p className="text-xs text-purple-700">Restent disponibles</p>
                    )}
                  </div>

                  {/* Surplus */}
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-medium text-green-900">Surplus 📈</h4>
                      <div className="text-lg font-bold text-green-600">
                        {formatCurrency(step1Data.total_surplus_available)}
                      </div>
                    </div>
                    {step1Data.needs_balancing && step1Data.can_balance && (
                      <p className="text-xs text-green-700">Utilisés en dernier (en proportion)</p>
                    )}
                    {!step1Data.needs_balancing && (
                      <p className="text-xs text-green-700">Restent disponibles</p>
                    )}
                  </div>
                </div>

                {/* Résumé de ce qui restera après équilibrage */}
                {step1Data.needs_balancing && step1Data.can_balance && (
                  <div className="mt-4 rounded-lg border-2 border-blue-300 bg-blue-50 p-4">
                    <h4 className="mb-3 text-center text-sm font-semibold text-blue-900">
                      Après équilibrage automatique
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-blue-800">Montant nécessaire:</span>
                        <span className="font-bold text-blue-900">
                          {formatCurrency(step1Data.balance_amount)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-800">Montant disponible:</span>
                        <span className="font-bold text-blue-900">
                          {formatCurrency(step1Data.total_available)}
                        </span>
                      </div>
                      <div className="my-2 h-px bg-blue-300"></div>
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
                              <span className="font-bold text-blue-900">
                                {formatCurrency(piggyRemaining)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-blue-800">Économies restantes:</span>
                              <span className="font-bold text-blue-900">
                                {formatCurrency(savingsRemaining)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-blue-800">Surplus restants:</span>
                              <span className="font-bold text-blue-900">
                                {formatCurrency(surplusRemaining)}
                              </span>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )}

                {/* Message informatif sur le rééquilibrage automatique */}
                <div className="mt-4 rounded-lg border-2 border-blue-300 bg-blue-50 p-4">
                  <p className="text-center text-sm font-medium text-blue-800">
                    ℹ️ Le rééquilibrage se fera automatiquement lors du passage à l&apos;étape
                    suivante
                  </p>
                  <p className="mt-2 text-center text-xs text-blue-700">
                    Les surplus seront transférés vers les économies, et l&apos;excédent éventuel
                    ira dans la tirelire
                  </p>
                </div>
              </div>
            </Card>
          </>
        ) : (
          /* Objectif atteint - Afficher aperçu des calculs sans bouton */
          <Card className="bg-white p-6">
            <div className="space-y-4">
              <h3 className="mb-4 text-center text-lg font-semibold text-gray-900">
                📊 Aperçu des calculs de répartition
              </h3>

              {/* Détails de la répartition */}
              <div className="space-y-3">
                {/* Tirelire */}
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-medium text-amber-900">Tirelire 🐷</h4>
                    <div className="text-lg font-bold text-amber-600">
                      {formatCurrency(step1Data.piggy_bank_amount)}
                    </div>
                  </div>
                  <p className="text-xs text-amber-700">Reste disponible</p>
                </div>

                {/* Économies */}
                <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-medium text-purple-900">Économies 💎</h4>
                    <div className="text-lg font-bold text-purple-600">
                      {formatCurrency(step1Data.total_savings_available)}
                    </div>
                  </div>
                  <p className="text-xs text-purple-700">Restent disponibles</p>
                </div>

                {/* Surplus */}
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-medium text-green-900">Surplus 📈</h4>
                    <div className="text-lg font-bold text-green-600">
                      {formatCurrency(step1Data.total_surplus_available)}
                    </div>
                  </div>
                  <p className="text-xs text-green-700">Restent disponibles</p>
                </div>
              </div>

              {/* Message informatif */}
              <div className="mt-4 rounded-lg border-2 border-green-300 bg-green-50 p-4">
                <p className="text-center text-sm font-medium text-green-800">
                  ✅ Aucune action nécessaire - Vous pouvez continuer
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Informations complémentaires */}
        <Card className="border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start space-x-2">
            <svg
              className="mt-0.5 h-5 w-5 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <h4 className="text-sm font-medium text-blue-900">
                Fonctionnement de l&apos;équilibrage
              </h4>
              <p className="mt-1 text-xs text-blue-700">
                L&apos;objectif est d&apos;atteindre votre reste à vivre budgétaire (
                {formatCurrency(step1Data.budgetary_remaining_to_live)}). L&apos;équilibrage
                automatique répartit proportionnellement les économies et excédents disponibles pour
                vous rapprocher au maximum de cet objectif.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Footer avec navigation */}
      <div className="border-t border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">Étape 1 sur 2</div>
          {canContinue && (
            <Button
              onClick={async () => {
                setIsSubmitting(true)
                try {
                  const result = onNext()
                  if (result instanceof Promise) {
                    await result
                  }
                } catch {
                  // l'erreur est déjà gérée par MonthlyRecapFlow.handleStep1Next via alert()
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
                  Traitement...
                </span>
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
