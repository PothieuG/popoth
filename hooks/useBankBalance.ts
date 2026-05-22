'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'

interface BankBalanceQueryResult {
  balance: number
  graceful_default?: boolean
}

/**
 * Hook TanStack Query pour gérer le solde bancaire éditable. Migré du
 * useState/useEffect legacy au Sprint Long-Press-Toggle-Apply-To-Balance
 * (2026-05-23) pour permettre l'invalidation par d'autres mutations
 * (toggleApplied notamment, qui change `bank_balances.balance` côté serveur
 * via la composite RPC `toggle_real_*_applied_to_balance`).
 *
 * QueryKey: `['bank-balance', context ?? null]`. Invalidée par les
 * consumers via `qc.invalidateQueries({ queryKey: ['bank-balance'] })`.
 * Le shape public reste identique à l'ancienne API (`balance`, `loading`,
 * `error`, `updateBankBalance`, `refreshBankBalance`) pour préserver les
 * consumers existants (EditableBalanceLine, SettingsDrawer, layout).
 */
export function useBankBalance(context?: 'profile' | 'group') {
  const queryClient = useQueryClient()
  const queryKey = ['bank-balance', context ?? null]

  const {
    data,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery<BankBalanceQueryResult>({
    queryKey,
    queryFn: async () => {
      const url = context ? `/api/bank-balance?context=${context}` : '/api/bank-balance'
      const response = await fetch(url, { credentials: 'include' })

      if (!response.ok) {
        const errorText = await response.text()
        logger.warn('Erreur API bank-balance:', response.status, errorText)
        // Si la table n'existe pas, on initialise le solde à 0 sans erreur
        if (
          response.status === 500 &&
          errorText.includes('relation "bank_balances" does not exist')
        ) {
          return { balance: 0, graceful_default: true }
        }
        throw new Error(`Erreur ${response.status}: ${errorText}`)
      }

      const json = await response.json()
      return { balance: typeof json.balance === 'number' ? json.balance : 0 }
    },
  })

  const updateMutation = useMutation<number, Error, number>({
    mutationFn: async (newBalance) => {
      const url = context ? `/api/bank-balance?context=${context}` : '/api/bank-balance'
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ balance: newBalance }),
      })
      const json = await response.json()
      if (!response.ok) {
        throw new Error(json.error || 'Erreur lors de la mise à jour du solde')
      }
      if (typeof json.balance !== 'number') {
        throw new Error('Réponse serveur invalide (balance absent)')
      }
      return json.balance
    },
    onSuccess: (newBalance) => {
      queryClient.setQueryData<BankBalanceQueryResult>(queryKey, { balance: newBalance })
    },
    onError: (err) => {
      // silently-swallowed côté UI (updateBankBalance retourne false sans toast)
      logger.error('Erreur lors de la mise à jour du solde bancaire:', err)
    },
  })

  const updateBankBalance = async (newBalance: number): Promise<boolean> => {
    try {
      await updateMutation.mutateAsync(newBalance)
      return true
    } catch {
      return false
    }
  }

  const refreshBankBalance = useCallback(async () => {
    await refetch()
  }, [refetch])

  const errorMessage = queryError instanceof Error ? queryError.message : null

  return {
    balance: data?.balance ?? 0,
    loading: isLoading,
    error: errorMessage,
    updateBankBalance,
    refreshBankBalance,
  }
}
