'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { invalidateFinancialRefreshes } from '@/lib/query-client'

export interface RealIncome {
  id: string
  profile_id?: string
  group_id?: string
  estimated_income_id?: string
  amount: number
  description: string
  entry_date: string
  is_exceptional: boolean
  created_at: string
  /**
   * Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23). Miroir
   * `RealExpense.applied_to_balance_at`. Long-press apply → balance +=
   * amount + applied_to_balance_at = NOW().
   */
  applied_to_balance_at?: string | null
  /**
   * Sprint 15 Monthly Recap V3 (2026-05-27). Miroir
   * `RealExpense.is_carried_over`. `true` = le revenu vient du mois
   * précédent, badge "Mois précédent" affiché, hors calculs.
   */
  is_carried_over?: boolean
  /**
   * Sprint 15 V3 — mémoire du recap d'origine, conservée même après
   * validation pour permettre le retour arrière.
   */
  carried_from_recap_id?: string | null
  estimated_income?: {
    name: string
  }
  created_by?: {
    id: string
    first_name: string | null
    last_name: string | null
    avatar_url: string | null
  } | null
}

export interface CreateRealIncomeRequest {
  amount: number
  description: string
  entry_date?: string
  estimated_income_id?: string
  is_for_group?: boolean
}

export interface UpdateRealIncomeRequest {
  id: string
  amount?: number
  description?: string
  entry_date?: string
  estimated_income_id?: string
}

/** Cf. [useRealExpenses.ts ToggleAppliedOutcome] — même sémantique. */
export type ToggleAppliedOutcome = 'applied' | 'unapplied' | 'no-op' | 'error'

interface UseRealIncomesReturn {
  incomes: RealIncome[]
  loading: boolean
  isFetching: boolean
  error: string | null
  totalIncomes: number
  addIncome: (incomeData: CreateRealIncomeRequest) => Promise<boolean>
  updateIncome: (incomeData: UpdateRealIncomeRequest) => Promise<boolean>
  deleteIncome: (incomeId: string) => Promise<boolean>
  toggleApplied: (incomeId: string, apply: boolean) => Promise<ToggleAppliedOutcome>
  /**
   * Sprint 15 V3 — flip bidirectionnel `is_carried_over` + `applied_to_balance_at`
   * en 1 tx atomique pour un revenu carry-over. Cf. RPC
   * `toggle_carry_over_and_apply_income`.
   */
  toggleCarryApplied: (incomeId: string, validate: boolean) => Promise<ToggleAppliedOutcome>
  refreshIncomes: () => Promise<void>
}

/**
 * Hook for managing real income entries CRUD operations
 * Handles database interactions and state management for actual income entries
 */
export function useRealIncomes(context?: 'profile' | 'group'): UseRealIncomesReturn {
  const queryClient = useQueryClient()
  const queryKey = ['real-incomes', context ?? null]

  const {
    data: incomes = [],
    isLoading,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery<RealIncome[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (context === 'group') {
        params.append('group', 'true')
      }
      params.append('limit', '100')

      const response = await fetch(`/api/finance/income/real?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return (data.real_income_entries ?? []) as RealIncome[]
    },
  })

  const addMutation = useMutation<RealIncome, Error, CreateRealIncomeRequest>({
    mutationFn: async (incomeData) => {
      const requestBody = {
        ...incomeData,
        is_for_group: context === 'group',
      }
      const response = await fetch('/api/finance/income/real', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return data.real_income_entry as RealIncome
    },
    onSuccess: (newIncome) => {
      queryClient.setQueryData<RealIncome[]>(queryKey, (prev = []) => [newIncome, ...prev])
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      // silently-swallowed côté UI (addIncome retourne false sans toast)
      logger.error('Error in addIncome:', err)
    },
  })

  const updateMutation = useMutation<RealIncome, Error, UpdateRealIncomeRequest>({
    mutationFn: async (incomeData) => {
      const response = await fetch(`/api/finance/income/real?id=${incomeData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(incomeData),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return data.real_income_entry as RealIncome
    },
    onSuccess: (updatedIncome, incomeData) => {
      queryClient.setQueryData<RealIncome[]>(queryKey, (prev = []) =>
        prev.map((income) => (income.id === incomeData.id ? updatedIncome : income)),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      // silently-swallowed côté UI (updateIncome retourne false sans toast)
      logger.error('Error in updateIncome:', err)
    },
  })

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (incomeId) => {
      const response = await fetch(`/api/finance/income/real?id=${incomeId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || 'Erreur lors de la suppression du revenu')
      }
    },
    onSuccess: (_, incomeId) => {
      queryClient.setQueryData<RealIncome[]>(queryKey, (prev = []) =>
        prev.filter((income) => income.id !== incomeId),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      // silently-swallowed côté UI (deleteIncome retourne false sans toast)
      logger.error('❌ [useRealIncomes] Error in deleteIncome:', err)
    },
  })

  /** Cf. useRealExpenses.toggleAppliedMutation — miroir pour revenus. */
  type ToggleVars = { id: string; apply: boolean }
  type ToggleContext = { previous: RealIncome[] | undefined }
  const toggleAppliedMutation = useMutation<
    { ok: true; balance: number; appliedAt: string | null } | { ok: false; status: number },
    Error,
    ToggleVars,
    ToggleContext
  >({
    mutationFn: async ({ id, apply }) => {
      const response = await fetch('/api/finance/income/real/toggle-applied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, apply }),
      })
      if (response.status === 409) return { ok: false, status: 409 }
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}`)
      }
      const json = await response.json()
      return { ok: true, balance: json.data.balance, appliedAt: json.data.appliedToBalanceAt }
    },
    onMutate: async ({ id, apply }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<RealIncome[]>(queryKey)
      queryClient.setQueryData<RealIncome[]>(queryKey, (prev = []) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, applied_to_balance_at: apply ? new Date().toISOString() : null }
            : i,
        ),
      )
      return { previous }
    },
    onSuccess: (result, { id }) => {
      if (!result.ok) return
      queryClient.setQueryData<RealIncome[]>(queryKey, (prev = []) =>
        prev.map((i) => (i.id === id ? { ...i, applied_to_balance_at: result.appliedAt } : i)),
      )
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous)
      logger.error('❌ [useRealIncomes] Error in toggleApplied:', err)
    },
    // ⚠️ Pas d'invalidateQueries(['real-incomes']) — cf. useRealExpenses
    // pour la justification (UX skeleton "vide" la liste pendant ~300ms).
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-balance'] })
      invalidateFinancialRefreshes(queryClient)
    },
  })

  /**
   * Sprint 15 Monthly Recap V3 (2026-05-27). Bidirectional toggle for
   * carry-over incomes. Mirror of useRealExpenses.toggleCarryApplied.
   */
  type CarryToggleVars = { id: string; validate: boolean }
  type CarryToggleContext = { previous: RealIncome[] | undefined }
  const toggleCarryAppliedMutation = useMutation<
    | { ok: true; balance: number; appliedAt: string | null; isCarriedOver: boolean }
    | { ok: false; status: number },
    Error,
    CarryToggleVars,
    CarryToggleContext
  >({
    mutationFn: async ({ id, validate }) => {
      const response = await fetch('/api/finance/income/real/toggle-carry-applied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, validate }),
      })
      if (response.status === 409) return { ok: false, status: 409 }
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}`)
      }
      const json = await response.json()
      return {
        ok: true,
        balance: json.data.balance,
        appliedAt: json.data.appliedToBalanceAt,
        isCarriedOver: json.data.isCarriedOver,
      }
    },
    onMutate: async ({ id, validate }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<RealIncome[]>(queryKey)
      queryClient.setQueryData<RealIncome[]>(queryKey, (prev = []) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                is_carried_over: !validate,
                applied_to_balance_at: validate ? new Date().toISOString() : null,
              }
            : i,
        ),
      )
      return { previous }
    },
    onSuccess: (result, { id }) => {
      if (!result.ok) return
      queryClient.setQueryData<RealIncome[]>(queryKey, (prev = []) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                is_carried_over: result.isCarriedOver,
                applied_to_balance_at: result.appliedAt,
              }
            : i,
        ),
      )
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous)
      logger.error('❌ [useRealIncomes] Error in toggleCarryApplied:', err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-balance'] })
      invalidateFinancialRefreshes(queryClient)
    },
  })

  const totalIncomes = incomes.reduce((sum, income) => sum + income.amount, 0)

  const latestError =
    addMutation.error ?? updateMutation.error ?? deleteMutation.error ?? queryError
  const error = latestError instanceof Error ? latestError.message : null

  // Stable refresh reference — useIncomeProgress depends on this for its own
  // useCallback. See useBudgets.ts / useRealExpenses.ts.
  const refreshIncomes = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    incomes,
    loading: isLoading,
    isFetching,
    error,
    totalIncomes,
    addIncome: async (incomeData) => {
      try {
        await addMutation.mutateAsync(incomeData)
        return true
      } catch {
        return false
      }
    },
    updateIncome: async (incomeData) => {
      try {
        await updateMutation.mutateAsync(incomeData)
        return true
      } catch {
        return false
      }
    },
    deleteIncome: async (incomeId) => {
      try {
        await deleteMutation.mutateAsync(incomeId)
        return true
      } catch {
        return false
      }
    },
    toggleApplied: async (incomeId, apply) => {
      try {
        const result = await toggleAppliedMutation.mutateAsync({ id: incomeId, apply })
        if (!result.ok) return 'no-op'
        return apply ? 'applied' : 'unapplied'
      } catch {
        return 'error'
      }
    },
    toggleCarryApplied: async (incomeId, validate) => {
      try {
        const result = await toggleCarryAppliedMutation.mutateAsync({ id: incomeId, validate })
        if (!result.ok) return 'no-op'
        return validate ? 'applied' : 'unapplied'
      } catch {
        return 'error'
      }
    },
    refreshIncomes,
  }
}
