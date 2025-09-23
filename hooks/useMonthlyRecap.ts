import { useState, useCallback } from 'react'

// Types pour le récapitulatif mensuel (maintenus pour compatibilité)
export interface TransferData {
  from_budget_id: string
  to_budget_id: string
  amount: number
}

export interface RemainingToLiveChoice {
  action: 'carry_forward' | 'deduct_from_budget'
  budget_id?: string
  final_amount: number
}

/**
 * Hook simplifié pour gérer le système de récapitulatif mensuel
 * VERSION SANS CACHE - Chaque composant récupère ses propres données live
 */
export function useMonthlyRecap(context: 'profile' | 'group' = 'profile') {
  const [currentStep, setCurrentStep] = useState(1)
  const [error, setError] = useState<string | null>(null)

  /**
   * Navigation entre les étapes
   */
  const goToStep = useCallback((step: number) => {
    if (step >= 1 && step <= 3) {
      setCurrentStep(step)
      // Scroll vers le haut de la page
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [])

  const goToNextStep = useCallback(() => {
    if (currentStep < 3) {
      const nextStep = currentStep + 1
      setCurrentStep(nextStep)
      // Scroll vers le haut de la page
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [currentStep])

  const goToPreviousStep = useCallback(() => {
    if (currentStep > 1) {
      const prevStep = currentStep - 1
      setCurrentStep(prevStep)
      // Scroll vers le haut de la page
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [currentStep])

  /**
   * Actions principales
   */
  const transferBetweenBudgets = useCallback(async (transferData: TransferData) => {
    try {
      setError(null)
      console.log('🔄 [Hook] Démarrage du transfert:', transferData)

      const response = await fetch('/api/monthly-recap/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          context,
          ...transferData
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors du transfert')
      }

      console.log('✅ [Hook] Transfert réussi côté serveur')
      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors du transfert entre budgets:', err)
      return null
    }
  }, [context])

  const autoBalanceBudgets = useCallback(async () => {
    try {
      setError(null)
      console.log('🔄 [Hook] Démarrage de la répartition automatique')

      const response = await fetch('/api/monthly-recap/auto-balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ context })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la répartition automatique')
      }

      console.log('✅ [Hook] Répartition automatique réussie côté serveur')
      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors de la répartition automatique:', err)
      return null
    }
  }, [context])

  /**
   * Équilibre automatiquement un reste à vivre négatif
   * NOUVELLE VERSION: Appelle l'API balance proportionnelle
   */
  const balanceRemainingToLive = useCallback(async () => {
    try {
      setError(null)
      console.log('🔄 [Hook] Démarrage de l\'équilibrage automatique proportionnel')

      const response = await fetch('/api/monthly-recap/balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          context
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de l\'équilibrage automatique')
      }

      console.log('✅ [Hook] Équilibrage automatique réussi côté serveur')
      console.log('📊 [Hook] Résultat:', {
        original: data.original_remaining_to_live,
        final: data.final_remaining_to_live,
        redistributed: data.deficit_covered
      })

      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors de l\'équilibrage automatique:', err)
      return null
    }
  }, [context])

  /**
   * Finalise le récapitulatif mensuel
   */
  const completeRecap = useCallback(async (remainingToLiveChoice: RemainingToLiveChoice) => {
    try {
      setError(null)

      const requestData = {
        context,
        remaining_to_live_choice: remainingToLiveChoice
      }

      console.log('🔍 [useMonthlyRecap] Données envoyées à l\'API complete:', requestData)

      const response = await fetch('/api/monthly-recap/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la finalisation')
      }

      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors de la finalisation du récap:', err)
      return null
    }
  }, [context])

  /**
   * Réinitialiser l'état
   */
  const resetRecap = useCallback(() => {
    setCurrentStep(1)
    setError(null)
  }, [])








  return {
    // État
    error,
    currentStep,

    // Actions principales
    transferBetweenBudgets,
    autoBalanceBudgets,
    balanceRemainingToLive,
    completeRecap,

    // Navigation
    goToStep,
    goToNextStep,
    goToPreviousStep,

    // Utilitaires
    resetRecap,

    // État dérivé
    canGoNext: currentStep < 3,
    canGoPrevious: currentStep > 1,
    isLastStep: currentStep === 3
  }
}