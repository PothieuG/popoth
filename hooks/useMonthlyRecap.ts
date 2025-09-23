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
  session_id: string
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
  const [isRefreshing, setIsRefreshing] = useState(false)
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
   * Sauvegarde et restauration de l'étape courante
   */
  const saveCurrentStep = useCallback((step: number, sessionId?: string) => {
    if (typeof window !== 'undefined' && sessionId) {
      const stepData = {
        step,
        sessionId,
        timestamp: Date.now(),
        context
      }
      localStorage.setItem('monthly-recap-step', JSON.stringify(stepData))
      console.log(`💾 [Hook] Étape ${step} sauvegardée pour session ${sessionId}`)
    }
  }, [context])

  const restoreCurrentStep = useCallback((sessionId?: string) => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('monthly-recap-step')
        if (saved) {
          const stepData = JSON.parse(saved)
          // Vérifier que c'est la même session et pas trop vieux (24h max)
          if (stepData.sessionId === sessionId &&
              stepData.context === context &&
              (Date.now() - stepData.timestamp) < 24 * 60 * 60 * 1000) {
            console.log(`🔄 [Hook] Restauration étape ${stepData.step} pour session ${sessionId}`)
            setCurrentStep(stepData.step)
            return stepData.step
          } else {
            // Nettoyer les anciennes données
            localStorage.removeItem('monthly-recap-step')
          }
        }
      } catch (error) {
        console.error('❌ Erreur lors de la restauration de l\'étape:', error)
        localStorage.removeItem('monthly-recap-step')
      }
    }
    return 1
  }, [context])

  const clearSavedStep = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('monthly-recap-step')
      console.log('🗑️ [Hook] Données d\'étape supprimées')
    }
  }, [])

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
      // Restaurer l'étape sauvegardée si disponible
      const restoredStep = restoreCurrentStep(data.session_id)
      setCurrentStep(restoredStep)
      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors de l\'initialisation du récap:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [context, restoreCurrentStep])

  /**
   * Rafraîchit les données du récap en cours
   */
  const refreshRecapData = useCallback(async () => {
    if (!recapData?.session_id) {
      console.log('⚠️ [Hook] Pas de session_id pour le rafraîchissement')
      return null
    }

    try {
      console.log('🔄 [Hook] Rafraîchissement des données...')
      setIsRefreshing(true)
      setError(null)

      // Récupérer les données actuelles en temps réel
      const response = await fetch(`/api/monthly-recap/refresh?context=${context}&session_id=${recapData.session_id}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors du rafraîchissement')
      }

      // Mettre à jour les données avec les nouveaux calculs
      console.log('📊 [Hook] Nouvelles données reçues du serveur:')
      console.log('  - Total surplus:', recapData?.total_surplus, '→', data.total_surplus)
      console.log('  - Total deficit:', recapData?.total_deficit, '→', data.total_deficit)
      console.log('  - Budget count:', data.budget_stats?.length || 0)

      // Force React to recognize this as a new object
      const updatedData = {
        ...data,
        timestamp: Date.now() // Add timestamp to force re-render
      }

      setRecapData(updatedData)
      console.log('✅ [Hook] État mis à jour dans le hook')
      return updatedData

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors du rafraîchissement du récap:', err)

      // Fallback: re-initialiser complètement
      console.log('🔄 Fallback: re-initialisation complète...')
      return await initializeRecap()
    } finally {
      setIsRefreshing(false)
    }
  }, [recapData?.session_id, context, initializeRecap])

  /**
   * Effectue un transfert entre budgets
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

      // Rafraîchir les données du récap après le transfert
      console.log('🔄 [Hook] Rafraîchissement des données après transfert...')
      const refreshResult = await refreshRecapData()

      if (refreshResult) {
        console.log('✅ [Hook] Données rafraîchies avec succès')
        console.log('📊 [Hook] Nouvelles valeurs - Surplus:', refreshResult.total_surplus, 'Déficit:', refreshResult.total_deficit)
      } else {
        console.log('❌ [Hook] Échec du rafraîchissement')
      }

      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors du transfert entre budgets:', err)
      return null
    }
  }, [context, refreshRecapData])

  /**
   * Effectue une répartition automatique des excédents
   */
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

      // Rafraîchir les données du récap après la répartition
      console.log('🔄 [Hook] Rafraîchissement des données après auto-balance...')
      const refreshResult = await refreshRecapData()

      if (refreshResult) {
        console.log('✅ [Hook] Données rafraîchies après auto-balance')
      } else {
        console.log('❌ [Hook] Échec du rafraîchissement après auto-balance')
      }

      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors de la répartition automatique:', err)
      return null
    }
  }, [context, refreshRecapData])

  /**
   * Équilibre automatiquement un reste à vivre négatif
   * en redistribuant les économies et excédents de manière proportionnelle
   */
  const balanceRemainingToLive = useCallback(async () => {
    if (!recapData?.session_id) {
      console.log('⚠️ [Hook] Pas de session_id pour l\'équilibrage')
      return null
    }

    try {
      setError(null)
      console.log('🔄 [Hook] Démarrage de l\'équilibrage automatique du reste à vivre')

      const response = await fetch('/api/monthly-recap/balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          context,
          session_id: recapData.session_id
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

      // Mettre à jour directement les données avec le résultat de l'équilibrage
      // au lieu de rafraîchir via l'API initialize qui ne prend pas en compte la redistribution
      if (recapData && data.final_remaining_to_live !== undefined) {
        console.log('🔄 [Hook] Mise à jour directe du reste à vivre après équilibrage')
        console.log(`📊 [Hook] ${recapData.current_remaining_to_live}€ → ${data.final_remaining_to_live}€`)

        setRecapData({
          ...recapData,
          current_remaining_to_live: data.final_remaining_to_live,
          budget_stats: data.budget_stats || recapData.budget_stats
        })

        console.log('📊 [Hook] Budget stats mis à jour:', data.budget_stats?.length || 0, 'budgets')

        console.log('✅ [Hook] Données mises à jour avec le nouveau reste à vivre')
      }

      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors de l\'équilibrage automatique:', err)
      return null
    }
  }, [context, recapData?.session_id, refreshRecapData])

  /**
   * Finalise le récapitulatif mensuel
   */
  const completeRecap = useCallback(async (remainingToLiveChoice: RemainingToLiveChoice) => {
    try {
      setIsLoading(true)
      setError(null)

      if (!recapData?.session_id) {
        throw new Error('Aucune session trouvée pour finaliser le récap')
      }

      const requestData = {
        context,
        session_id: recapData.session_id,
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

      // Nettoyer les données sauvegardées une fois terminé
      clearSavedStep()
      return data

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      console.error('❌ Erreur lors de la finalisation du récap:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [context, recapData?.session_id, clearSavedStep])

  /**
   * Navigation entre les étapes
   */
  const goToStep = useCallback((step: number) => {
    if (step >= 1 && step <= 3) {
      setCurrentStep(step)
      saveCurrentStep(step, recapData?.session_id)
      // Scroll vers le haut de la page
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [saveCurrentStep, recapData?.session_id])

  const goToNextStep = useCallback(() => {
    if (currentStep < 3) {
      const nextStep = currentStep + 1
      setCurrentStep(nextStep)
      saveCurrentStep(nextStep, recapData?.session_id)
      // Scroll vers le haut de la page
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [currentStep, saveCurrentStep, recapData?.session_id])

  const goToPreviousStep = useCallback(() => {
    if (currentStep > 1) {
      const prevStep = currentStep - 1
      setCurrentStep(prevStep)
      saveCurrentStep(prevStep, recapData?.session_id)
      // Scroll vers le haut de la page
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [currentStep, saveCurrentStep, recapData?.session_id])

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
    clearSavedStep()
  }, [clearSavedStep])

  // Vérifier le statut au montage du composant
  useEffect(() => {
    checkRecapStatus()
  }, [checkRecapStatus])

  return {
    // État
    isLoading,
    isRefreshing,
    error,
    recapStatus,
    recapData,
    currentStep,

    // Actions principales
    checkRecapStatus,
    initializeRecap,
    transferBetweenBudgets,
    autoBalanceBudgets,
    balanceRemainingToLive,
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

    // Sauvegarde d'étape
    saveCurrentStep,
    restoreCurrentStep,
    clearSavedStep,

    // État dérivé
    hasData: !!recapData,
    isRequired: recapStatus?.required || false,
    isFirstOfMonth: recapStatus?.isFirstOfMonth || false,
    canGoNext: currentStep < 3,
    canGoPrevious: currentStep > 1,
    isLastStep: currentStep === 3
  }
}