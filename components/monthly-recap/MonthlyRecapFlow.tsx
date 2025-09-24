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

  const handleStep1Next = () => {
    // La navigation est maintenant simple car les données sont récupérées live à chaque étape
    goToNextStep()
  }

  const handleCompleteFromStep2 = async () => {
    try {
      // Complete the recap with carry forward action
      const result = await completeRecap({
        action: 'carry_forward',
        final_amount: 0 // Will be calculated by the backend
      })

      if (result?.success) {
        console.log('✅ Récapitulatif mensuel finalisé avec succès')

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