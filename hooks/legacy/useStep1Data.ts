'use client'

import { useQuery } from '@tanstack/react-query'

export interface Step1Data {
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

interface UseStep1DataReturn {
  data: Step1Data | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Récupère les données live de l'étape 1 du récap mensuel.
 * Refetch à chaque changement de contexte ; expose `refresh` pour le bouton retry.
 */
export function useStep1Data(context: 'profile' | 'group'): UseStep1DataReturn {
  const { data, isLoading, error, refetch } = useQuery<Step1Data>({
    queryKey: ['step1-data', context],
    queryFn: async () => {
      const response = await fetch(`/api/monthly-recap/step1-data?context=${context}`)
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || 'Erreur lors de la récupération des données')
      }
      return payload as Step1Data
    },
  })

  return {
    data: data ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    refresh: async () => {
      await refetch()
    },
  }
}
