'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMonthlyRecap, RemainingToLiveChoice } from '@/hooks/useMonthlyRecap'
import MonthlyRecapStep1 from './MonthlyRecapStep1'
import MonthlyRecapStep2 from './MonthlyRecapStep2'

interface MonthlyRecapFlowProps {
  context: 'profile' | 'group'
  onComplete?: () => void
}

/**
 * Composant principal pour le flux de récapitulatif mensuel
 * VERSION SIMPLIFIÉE SANS CACHE - Chaque étape gère ses propres données live
 */
export default function MonthlyRecapFlow({
  context,
  onComplete
}: MonthlyRecapFlowProps) {
  const router = useRouter()
  const {
    error,
    currentStep,
    transferBetweenBudgets,
    autoBalanceBudgets,
    balanceRemainingToLive,
    completeRecap,
    goToStep,
    goToNextStep,
    goToPreviousStep
  } = useMonthlyRecap(context)


  // Gestion des erreurs globales du hook (très rare car chaque étape gère ses erreurs)
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
          <button
            onClick={() => router.push('/dashboard')}
            className="w-full bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
          >
            Retour au tableau de bord
          </button>
        </div>
      </div>
    )
  }

  // Handlers pour les actions
  const handleTransfer = async (fromBudgetId: string, toBudgetId: string, amount: number) => {
    return await transferBetweenBudgets({
      from_budget_id: fromBudgetId,
      to_budget_id: toBudgetId,
      amount
    })
  }

  const handleAutoBalance = async () => {
    return await autoBalanceBudgets()
  }

  const handleBalanceRemainingToLive = async () => {
    const result = await balanceRemainingToLive()
    return result
  }

  const handleStep1Next = async () => {
    try {
      // Avant de passer à l'étape 2, récupérer le surplus de l'étape 1
      // et l'accumuler dans la tirelire
      const response = await fetch(`/api/monthly-recap/step1-data?context=${context}`)
      const step1Data = await response.json()

      if (response.ok && step1Data.surplus_for_next_step > 0) {
        console.log(`🐷 [Frontend] Accumulation de ${step1Data.surplus_for_next_step}€ dans la tirelire`)

        // Appeler l'API pour accumuler le surplus dans la tirelire
        const accumulateResponse = await fetch('/api/monthly-recap/accumulate-piggy-bank', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            context,
            amount: step1Data.surplus_for_next_step
          })
        })

        const accumulateData = await accumulateResponse.json()

        if (accumulateResponse.ok) {
          console.log(`✅ [Frontend] Tirelire mise à jour: ${accumulateData.old_amount}€ → ${accumulateData.new_amount}€`)
        } else {
          console.error('❌ [Frontend] Erreur lors de l\'accumulation:', accumulateData.error)
        }
      }

      // La navigation est maintenant simple car les données sont récupérées live à chaque étape
      goToNextStep()
    } catch (error) {
      console.error('❌ [Frontend] Erreur lors de la validation de l\'étape 1:', error)
      // On continue quand même vers l'étape 2 même en cas d'erreur
      goToNextStep()
    }
  }

  const handleCompleteFromStep2 = async () => {
    try {
      console.log(``)
      console.log(`🏁🏁🏁 ========================================================`)
      console.log(`🏁🏁🏁 [FRONTEND] FINALISATION DU RÉCAP`)
      console.log(`🏁🏁🏁 ========================================================`)
      console.log(`🏁 Action: carry_forward`)
      console.log(`🏁🏁🏁 ========================================================`)
      console.log(``)

      // Complete the recap with carry forward action
      const result = await completeRecap({
        action: 'carry_forward',
        final_amount: 0 // Will be calculated by the backend
      })

      if (result?.success) {
        console.log(``)
        console.log(`🏁🏁🏁 ========================================================`)
        console.log(`🏁🏁🏁 [FRONTEND] FINALISATION RÉUSSIE`)
        console.log(`🏁🏁🏁 ========================================================`)
        console.log(`💰 RAV initial: ${result.summary?.initial_remaining_to_live}€`)
        console.log(`💰 RAV final: ${result.summary?.final_remaining_to_live}€`)
        console.log(`📊 Surplus total: ${result.summary?.total_surplus}€`)
        console.log(`📉 Déficit total: ${result.summary?.total_deficit}€`)
        console.log(`🏁🏁🏁 ========================================================`)
        console.log(``)

        // Callback personnalisé si fourni
        if (onComplete) {
          onComplete()
        }

        // Redirection vers le dashboard après un délai
        setTimeout(() => {
          const dashboardUrl = context === 'profile' ? '/dashboard' : '/group-dashboard'
          router.push(dashboardUrl)
        }, 2000)
      }

      return result
    } catch (error) {
      console.error('❌ Erreur lors de la finalisation:', error)
      return null
    }
  }

  // Rendu des étapes
  switch (currentStep) {
    case 1:
      return (
        <MonthlyRecapStep1
          context={context}
          onNext={handleStep1Next}
          onBalanceRemainingToLive={handleBalanceRemainingToLive}
        />
      )

    case 2:
      return (
        <MonthlyRecapStep2
          context={context}
          onNext={handleCompleteFromStep2}
          onTransfer={handleTransfer}
          onAutoBalance={handleAutoBalance}
        />
      )

    default:
      console.error('❌ Étape inconnue:', currentStep)
      return null
  }
}