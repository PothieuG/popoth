'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SavingsTransferResponse } from '@/lib/api/finance/savings-transfer'
import type { SavingsTransferDirection } from '@/lib/finance/savings-transfer'
import { logger } from '@/lib/logger'
import { applyBankBalanceToCache, type FinancialContext } from '@/lib/query-client'

export interface SavingsTransferRequest {
  direction: SavingsTransferDirection
  amount: number
}

/** `error` = code renvoyé par la route (ex. `savings-transfer-exceeds-savings`). */
export type SavingsTransferOutcome = { ok: true; balance: number } | { ok: false; error: string }

/**
 * Part 50 — « Transfert d'économies » (`POST /api/finance/savings-transfer`).
 *
 * Seul le solde disponible change : la route renvoie le nouveau solde, écrit
 * directement dans les 2 caches qui l'affichent (`applyBankBalanceToCache`,
 * comme l'appui long). Pas d'`invalidateFinancialRefreshes` : ni le reste à
 * vivre, ni les budgets, ni les économies, ni les listes n'ont bougé —
 * relancer les 11 keys referait ~12 appels pour rien.
 */
export function useSavingsTransfer(context: FinancialContext) {
  const queryClient = useQueryClient()

  const mutation = useMutation<SavingsTransferResponse, Error, SavingsTransferRequest>({
    mutationFn: async ({ direction, amount }) => {
      const response = await fetch('/api/finance/savings-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ context, direction, amount }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      return json.data as SavingsTransferResponse
    },
    onSuccess: ({ balance }) => {
      applyBankBalanceToCache(queryClient, context, balance)
    },
    onError: (err) => {
      logger.error('[useSavingsTransfer] Error in transfer:', err)
    },
  })

  const transfer = async (request: SavingsTransferRequest): Promise<SavingsTransferOutcome> => {
    try {
      const { balance } = await mutation.mutateAsync(request)
      return { ok: true, balance }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  return { transfer }
}
