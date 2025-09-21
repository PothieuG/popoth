import { useState, useEffect, useCallback } from 'react'

// Types pour le récapitulatif mensuel
export interface BudgetStat {
  id: string
  name: string
  estimated_amount: number
  spent_amount: number
  carryover_spent_amount?: number // Legacy, plus utilisé
  total_spent_amount?: number // Legacy, plus utilisé
  difference: number
  surplus: number
  deficit: number
  cumulated_savings?: number // Économies cumulées existantes
}

export interface RecapData {
  snapshot_id: string
  current_remaining_to_live: number
  budget_stats: BudgetStat[]
  total_surplus: number
  total_deficit: number
  general_ratio: number
  context: 'profile' | 'group'
  month: number
  year: number
  user_name: string
}

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

export interface RecapStatus {
  required: boolean
  currentMonth: number
  currentYear: number
  currentDay: number
  hasExistingRecap: boolean
  context: string
  contextId: string
  isFirstOfMonth: boolean
}

/**
 * Hook personnalisé pour gérer le système de récapitulatif mensuel
 */
export function useMonthlyRecap(context: 'profile' | 'group' = 'profile') {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recapStatus, setRecapStatus] = useState<RecapStatus | null>(null)
  const [recapData, setRecapData] = useState<RecapData | null>(null)
  const [currentStep, setCurrentStep] = useState(1)

  /**
   * Vérifie si un récapitulatif mensuel est requis
   */
  const checkRecapStatus = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch(`/api/monthly-recap/status?context=${context}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la vérification du statut')
      }

      setRecapStatus(data)
      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors de la vérification du statut du récap:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [context])

  /**
   * Initialise un nouveau récapitulatif mensuel
   */
  const initializeRecap = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const response = await fetch('/api/monthly-recap/initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ context })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de l\'initialisation')
      }

      setRecapData(data)
      setCurrentStep(1)
      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors de l\'initialisation du récap:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [context])

  /**
   * Effectue un transfert entre budgets
   */
  const transferBetweenBudgets = useCallback(async (transferData: TransferData) => {
    try {
      setIsLoading(true)
      setError(null)

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

      // Rafraîchir les données du récap après le transfert
      await refreshRecapData()

      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors du transfert entre budgets:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [context])

  /**
   * Effectue une répartition automatique des excédents
   */
  const autoBalanceBudgets = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

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

      // Rafraîchir les données du récap après la répartition
      await refreshRecapData()

      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors de la répartition automatique:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [context])

  /**
   * Finalise le récapitulatif mensuel
   */
  const completeRecap = useCallback(async (remainingToLiveChoice: RemainingToLiveChoice) => {
    try {
      setIsLoading(true)
      setError(null)

      if (!recapData?.snapshot_id) {
        throw new Error('Aucun snapshot trouvé pour finaliser le récap')
      }

      const requestData = {
        context,
        snapshot_id: recapData.snapshot_id,
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
    } finally {
      setIsLoading(false)
    }
  }, [context, recapData?.snapshot_id])

  /**
   * Rafraîchit les données du récap en cours
   */
  const refreshRecapData = useCallback(async () => {
    if (!recapData) return

    // Pour l'instant, on re-initialise les données
    // Dans une vraie app, on aurait une API GET pour récupérer l'état actuel
    return await initializeRecap()
  }, [recapData, initializeRecap])

  /**
   * Navigation entre les étapes
   */
  const goToStep = useCallback((step: number) => {
    if (step >= 1 && step <= 3) {
      setCurrentStep(step)
    }
  }, [])

  const goToNextStep = useCallback(() => {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1)
    }
  }, [currentStep])

  const goToPreviousStep = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }, [currentStep])

  /**
   * Utilitaires pour les calculs
   */
  const getBudgetsWithSurplus = useCallback(() => {
    return recapData?.budget_stats.filter(budget => budget.surplus > 0) || []
  }, [recapData])

  const getBudgetsWithDeficit = useCallback(() => {
    return recapData?.budget_stats.filter(budget => budget.deficit > 0) || []
  }, [recapData])

  const canTransfer = useCallback((fromBudgetId: string, amount: number) => {
    const fromBudget = recapData?.budget_stats.find(b => b.id === fromBudgetId)
    return fromBudget ? fromBudget.surplus >= amount : false
  }, [recapData])

  /**
   * Réinitialiser l'état
   */
  const resetRecap = useCallback(() => {
    setRecapData(null)
    setCurrentStep(1)
    setError(null)
  }, [])

  // Vérifier le statut au montage du composant
  useEffect(() => {
    checkRecapStatus()
  }, [checkRecapStatus])

  return {
    // État
    isLoading,
    error,
    recapStatus,
    recapData,
    currentStep,

    // Actions principales
    checkRecapStatus,
    initializeRecap,
    transferBetweenBudgets,
    autoBalanceBudgets,
    completeRecap,
    refreshRecapData,

    // Navigation
    goToStep,
    goToNextStep,
    goToPreviousStep,

    // Utilitaires
    getBudgetsWithSurplus,
    getBudgetsWithDeficit,
    canTransfer,
    resetRecap,

    // État dérivé
    hasData: !!recapData,
    isRequired: recapStatus?.required || false,
    isFirstOfMonth: recapStatus?.isFirstOfMonth || false,
    canGoNext: currentStep < 3,
    canGoPrevious: currentStep > 1,
    isLastStep: currentStep === 3
  }
}