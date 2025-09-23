'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMonthlyRecap } from '@/hooks/useMonthlyRecap'
import MonthlyRecapStep1 from './MonthlyRecapStep1'
import MonthlyRecapStep2 from './MonthlyRecapStep2'
import MonthlyRecapStep3 from './MonthlyRecapStep3'

interface MonthlyRecapFlowProps {
  context: 'profile' | 'group'
  onComplete?: () => void
}

interface RemainingToLiveChoice {
  action: 'carry_forward' | 'deduct_from_budget'
  budget_id?: string
  final_amount: number
}

/**
 * Composant principal pour le flux de récapitulatif mensuel
 * Gère les 3 étapes obligatoires et la navigation entre elles
 */
export default function MonthlyRecapFlow({
  context,
  onComplete
}: MonthlyRecapFlowProps) {
  const router = useRouter()
  const {
    isLoading,
    isRefreshing,
    error,
    recapData,
    currentStep,
    resumeOrInitializeRecap,
    transferBetweenBudgets,
    autoBalanceBudgets,
    balanceRemainingToLive,
    completeRecap,
    goToNextStep,
    goToPreviousStep,
    hasData
  } = useMonthlyRecap(context)

  const [remainingToLiveChoice, setRemainingToLiveChoice] = useState<RemainingToLiveChoice | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  // Initialiser le récap au montage du composant
  useEffect(() => {
    if (!isInitialized && !hasData && !isLoading) {
      console.log('🚀 [MonthlyRecapFlow] Reprise ou initialisation du récap mensuel')
      resumeOrInitializeRecap().then((result) => {
        setIsInitialized(true) // Toujours marquer comme initialisé
        if (!result) {
          console.log('⚠️ [MonthlyRecapFlow] Aucun résultat retourné')
        }
      })
    }
  }, [isInitialized, hasData, isLoading, resumeOrInitializeRecap])

  // Gestion des erreurs
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

  // État de chargement initial
  if (isLoading || !isInitialized || !recapData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Préparation du récapitulatif mensuel
          </h2>
          <p className="text-gray-600">
            Calcul de vos données financières en cours...
          </p>
        </div>
      </div>
    )
  }

  // Handlers pour les actions
  const handleRemainingToLiveChoice = (choice: RemainingToLiveChoice) => {
    setRemainingToLiveChoice(choice)
  }

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
    setIsProcessing(true)
    try {
      const result = await balanceRemainingToLive()
      if (result) {
        // L'équilibrage a réussi, on peut automatiquement définir le choix pour l'étape 3
        setRemainingToLiveChoice({
          action: 'carry_forward',
          final_amount: result.final_remaining_to_live || 0
        })

        // Avancer automatiquement à l'étape suivante après équilibrage
        console.log('✅ [Flow] Équilibrage terminé, passage à l\'étape suivante')
        await goToNextStep()
      }
      return result
    } finally {
      setIsProcessing(false)
    }
  }

  const handleStep1Next = async () => {
    // Si aucun choix n'a été fait, utiliser carry_forward par défaut
    if (!remainingToLiveChoice && recapData) {
      setRemainingToLiveChoice({
        action: 'carry_forward',
        final_amount: recapData.current_remaining_to_live
      })
    }
    await goToNextStep()
  }

  const handleComplete = async () => {
    if (!remainingToLiveChoice) {
      console.error('❌ Aucun choix de reste à vivre défini')
      return null
    }

    try {
      const result = await completeRecap(remainingToLiveChoice)

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
          recapData={recapData}
          onNext={handleStep1Next}
          onBalanceRemainingToLive={handleBalanceRemainingToLive}
          isLoading={isLoading}
          isProcessing={isProcessing}
        />
      )

    case 2:
      return (
        <MonthlyRecapStep2
          recapData={recapData}
          onNext={goToNextStep}
          onPrevious={goToPreviousStep}
          onTransfer={handleTransfer}
          onAutoBalance={handleAutoBalance}
          isLoading={isLoading}
          isRefreshing={isRefreshing}
        />
      )

    case 3:
      if (!remainingToLiveChoice) {
        // Si on arrive à l'étape 3 sans choix de reste à vivre, revenir à l'étape 1
        console.warn('⚠️ Étape 3 atteinte sans choix de reste à vivre, retour à l\'étape 1')
        // Ces appels asynchrones ne peuvent pas être await dans un return statement,
        // donc on les lance de façon asynchrone
        goToPreviousStep().then(() => goToPreviousStep())
        return null
      }

      return (
        <MonthlyRecapStep3
          recapData={recapData}
          onPrevious={goToPreviousStep}
          onComplete={handleComplete}
          remainingToLiveChoice={remainingToLiveChoice}
          isLoading={isLoading}
        />
      )

    default:
      console.error('❌ Étape inconnue:', currentStep)
      return null
  }
}