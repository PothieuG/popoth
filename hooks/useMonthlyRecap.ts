import { useState, useCallback } from 'react'
import { logger } from '@/lib/logger'

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
    if (step >= 1 && step <= 2) {
      setCurrentStep(step)
      // Scroll vers le haut de la page
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [])

  const goToNextStep = useCallback(() => {
    if (currentStep < 2) {
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
  const transferBetweenBudgets = useCallback(
    async (transferData: TransferData) => {
      try {
        setError(null)

        const response = await fetch('/api/monthly-recap/transfer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            context,
            ...transferData,
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Erreur lors du transfert')
        }

        return data
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
        setError(errorMessage)
        // CRITICAL cleanup-attempt : POST /api/monthly-recap/transfer fail peut
        // laisser le state monthly-recap cassé (transfer atomique côté DB mais
        // le hook propage juste null au caller — pas de retry).
        logger.error('❌ Erreur lors du transfert entre budgets:', err)
        return null
      }
    },
    [context],
  )

  const autoBalanceBudgets = useCallback(async () => {
    try {
      setError(null)

      const response = await fetch('/api/monthly-recap/auto-balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ context }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la répartition automatique')
      }

      return data
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      // CRITICAL cleanup-attempt : POST /api/monthly-recap/auto-balance fail
      // peut laisser un déficit partiellement équilibré côté serveur.
      logger.error('❌ Erreur lors de la répartition automatique:', err)
      return null
    }
  }, [context])

  /**
   * Finalise le récapitulatif mensuel
   */
  const completeRecap = useCallback(
    async (remainingToLiveChoice: RemainingToLiveChoice) => {
      try {
        setError(null)

        // Generate a unique session_id for this completion
        const session_id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        const requestData = {
          context,
          session_id,
          remaining_to_live_choice: remainingToLiveChoice,
        }

        const response = await fetch('/api/monthly-recap/complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestData),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Erreur lors de la finalisation')
        }

        return data
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
        setError(errorMessage)
        // CRITICAL cleanup-attempt : POST /api/monthly-recap/complete fail
        // peut laisser le récap dans un état partiellement finalisé (snapshots
        // créés, carryover non appliqué). Pas de retry côté hook.
        logger.error('❌ Erreur lors de la finalisation du récap:', err)
        return null
      }
    },
    [context],
  )

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
    isLastStep: currentStep === 3,
  }
}
