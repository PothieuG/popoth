'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { invalidateFinancialRefreshes } from '@/lib/query-client'

export interface RealExpense {
  id: string
  profile_id?: string
  group_id?: string
  estimated_budget_id?: string
  amount: number
  description: string
  expense_date: string
  is_exceptional: boolean
  created_at: string
  amount_from_piggy_bank?: number
  amount_from_budget_savings?: number
  amount_from_budget?: number
  /**
   * Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23). NULL = la
   * dépense n'a pas été appliquée au solde bancaire ; ISO timestamp = elle
   * l'a été (long-press utilisateur). Le toggle change cette valeur ET
   * `bank_balances.balance` atomiquement via la composite RPC
   * `toggle_real_expense_applied_to_balance`.
   */
  applied_to_balance_at?: string | null
  /**
   * Sprint 15 Monthly Recap V3 (2026-05-27). `true` = la dépense vient
   * du mois précédent et n'est pas comptée dans le RAV/solde/calculs
   * tant que l'utilisateur ne l'a pas validée via long-press. Badge "Mois
   * précédent" affiché sur la carte.
   */
  is_carried_over?: boolean
  /**
   * Sprint 15 V3 — mémoire du recap d'origine. Conservée même après
   * validation pour permettre le retour arrière (dévalider → re-flagger
   * carry-over).
   */
  carried_from_recap_id?: string | null
  /**
   * Feature "Contribution au groupe" (2026-05-28). Non-null = row auto-managée
   * par le trigger DB `sync_contribution_real_expense` (la row reflète
   * `group_contributions.contribution_amount` du user). L'UI rend cette
   * row en mode read-only spécial : pas de bouton Modifier/Supprimer,
   * catégorie en gris, warning + delta si désynchronisée.
   */
  contribution_id?: string | null
  /**
   * Feature "Contribution au groupe" (2026-05-28). Snapshot du montant
   * de la dépense au moment de la dernière validation long-press. Sert à
   * détecter le drift quand le trigger a réécrit `amount` après que le
   * user a validé (delta = `amount - last_applied_amount`).
   */
  last_applied_amount?: number | null
  estimated_budget?: {
    name: string
  }
  created_by?: {
    id: string
    first_name: string | null
    last_name: string | null
    avatar_url: string | null
  } | null
}

export interface CreateRealExpenseRequest {
  amount: number
  description: string
  expense_date?: string
  estimated_budget_id?: string
  is_for_group?: boolean
  /** Sprint P4-P5-P6 / P5 toggle — see addExpenseWithLogicBodySchema. */
  use_savings?: boolean
  /** Sprint P4-P5-P6 / P4 Phase 2 — see addExpenseWithLogicBodySchema. */
  cross_budget_cascade?: Array<{ budget_id: string; amount: number }>
  /**
   * Sprint Exceptional-Expense-Piggy-Funding — montant prélevé dans la tirelire
   * pour financer une dépense exceptionnelle (hors budget). Default 0 / absent.
   */
  amount_from_piggy_bank?: number
}

export interface UpdateRealExpenseRequest {
  id: string
  amount?: number
  description?: string
  expense_date?: string
  estimated_budget_id?: string
}

/**
 * Result of a toggleApplied call.
 *   - 'applied' / 'unapplied' : the server flipped the flag and adjusted balance.
 *   - 'no-op' : 409 returned because the row was already in the target state
 *     (concurrent toggle). UI should not show an error — the optimistic
 *     update already reflects the truth, the query is invalidated by the
 *     onSettled to re-converge.
 *   - 'error' : 4xx/5xx other than 409 (e.g. 403 ownership, 500 RPC fail).
 */
export type ToggleAppliedOutcome = 'applied' | 'unapplied' | 'no-op' | 'error'

interface UseRealExpensesReturn {
  expenses: RealExpense[]
  loading: boolean
  isFetching: boolean
  error: string | null
  totalExpenses: number
  addExpense: (expenseData: CreateRealExpenseRequest) => Promise<boolean>
  updateExpense: (expenseData: UpdateRealExpenseRequest) => Promise<boolean>
  deleteExpense: (expenseId: string) => Promise<boolean>
  toggleApplied: (expenseId: string, apply: boolean) => Promise<ToggleAppliedOutcome>
  /**
   * Sprint 15 V3 — flip bidirectionnel `is_carried_over` + `applied_to_balance_at`
   * en 1 tx atomique pour une dépense carry-over. Cf. RPC
   * `toggle_carry_over_and_apply`. Renvoie `'no-op'` (HTTP 409) si déjà dans
   * l'état cible.
   */
  toggleCarryApplied: (expenseId: string, validate: boolean) => Promise<ToggleAppliedOutcome>
  refreshExpenses: () => Promise<void>
}

/**
 * Hook for managing real expenses CRUD operations
 * Handles database interactions and state management for actual expenses
 */
export function useRealExpenses(context?: 'profile' | 'group'): UseRealExpensesReturn {
  const queryClient = useQueryClient()
  const queryKey = ['real-expenses', context ?? null]

  const {
    data: expenses = [],
    isLoading,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery<RealExpense[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (context === 'group') {
        params.append('group', 'true')
      }
      params.append('limit', '100')

      const response = await fetch(`/api/finance/expenses/real?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return (data.real_expenses ?? []) as RealExpense[]
    },
  })

  const addMutation = useMutation<RealExpense | null, Error, CreateRealExpenseRequest>({
    mutationFn: async (expenseData) => {
      const requestBody = {
        ...expenseData,
        is_for_group: context === 'group',
      }
      const response = await fetch('/api/finance/expenses/add-with-logic', {
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
      // Smart allocation may not create a real_expense (fully covered by piggy/savings)
      return (data.real_expense ?? null) as RealExpense | null
    },
    onSuccess: (newExpense) => {
      if (newExpense) {
        queryClient.setQueryData<RealExpense[]>(queryKey, (prev = []) => [newExpense, ...prev])
      }
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      // silently-swallowed côté UI (addExpense retourne false sans toast)
      logger.error('Error in addExpense:', err)
    },
  })

  const updateMutation = useMutation<RealExpense, Error, UpdateRealExpenseRequest>({
    mutationFn: async (expenseData) => {
      const response = await fetch(`/api/finance/expenses/real?id=${expenseData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(expenseData),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return data.real_expense as RealExpense
    },
    onSuccess: (updatedExpense, expenseData) => {
      queryClient.setQueryData<RealExpense[]>(queryKey, (prev = []) =>
        prev.map((expense) => (expense.id === expenseData.id ? updatedExpense : expense)),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      // silently-swallowed côté UI (updateExpense retourne false sans toast)
      logger.error('Error in updateExpense:', err)
    },
  })

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (expenseId) => {
      const response = await fetch(`/api/finance/expenses/real?id=${expenseId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || 'Erreur lors de la suppression de la dépense')
      }
    },
    onSuccess: (_, expenseId) => {
      queryClient.setQueryData<RealExpense[]>(queryKey, (prev = []) =>
        prev.filter((expense) => expense.id !== expenseId),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      // silently-swallowed côté UI (deleteExpense retourne false sans toast)
      logger.error('❌ [useRealExpenses] Error in deleteExpense:', err)
    },
  })

  /**
   * Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23). Optimistic
   * toggle of `applied_to_balance_at` ; cancels pending queries, snapshots
   * the previous list, mutates the row locally, then issues the POST.
   *
   * 200 → setQueryData remplace l'ISO optimiste par le timestamp
   *       server-authoritative (precision PG NOW()).
   * 409 → no-op (concurrent mutation already in target state, optimistic
   *       value matches truth — nothing to do).
   * Other errors → rollback to snapshot.
   *
   * ⚠️ Pas d'invalidateQueries(['real-expenses']) ici (sinon refetch =
   * skeleton "vide" la liste pendant ~300ms post-long-press, UX cassée).
   * L'optimistic + setQueryData onSuccess donnent un état déjà convergé
   * avec le serveur. Le bank-balance + financial-summary sont invalidés
   * pour rafraîchir le drawer + le solde dashboard.
   */
  type ToggleVars = { id: string; apply: boolean }
  type ToggleContext = { previous: RealExpense[] | undefined }
  const toggleAppliedMutation = useMutation<
    { ok: true; balance: number; appliedAt: string | null } | { ok: false; status: number },
    Error,
    ToggleVars,
    ToggleContext
  >({
    mutationFn: async ({ id, apply }) => {
      const response = await fetch('/api/finance/expenses/real/toggle-applied', {
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
      const previous = queryClient.getQueryData<RealExpense[]>(queryKey)
      queryClient.setQueryData<RealExpense[]>(queryKey, (prev = []) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, applied_to_balance_at: apply ? new Date().toISOString() : null }
            : e,
        ),
      )
      return { previous }
    },
    onSuccess: (result, { id }) => {
      if (!result.ok) return
      queryClient.setQueryData<RealExpense[]>(queryKey, (prev = []) =>
        prev.map((e) => (e.id === id ? { ...e, applied_to_balance_at: result.appliedAt } : e)),
      )
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous)
      logger.error('❌ [useRealExpenses] Error in toggleApplied:', err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-balance'] })
      invalidateFinancialRefreshes(queryClient)
    },
  })

  /**
   * Sprint 15 Monthly Recap V3 (2026-05-27). Bidirectional toggle for
   * carry-over expenses. Flips both `is_carried_over` AND
   * `applied_to_balance_at` in 1 tx via composite RPC. Optimistic update
   * mirrors both flags pre-server. 409 → no-op (already in target state).
   */
  type CarryToggleVars = { id: string; validate: boolean }
  type CarryToggleContext = { previous: RealExpense[] | undefined }
  const toggleCarryAppliedMutation = useMutation<
    | { ok: true; balance: number; appliedAt: string | null; isCarriedOver: boolean }
    | { ok: false; status: number },
    Error,
    CarryToggleVars,
    CarryToggleContext
  >({
    mutationFn: async ({ id, validate }) => {
      const response = await fetch('/api/finance/expenses/real/toggle-carry-applied', {
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
      const previous = queryClient.getQueryData<RealExpense[]>(queryKey)
      // Optimistic: validate=true → is_carried_over=false + applied=now()
      //             validate=false → is_carried_over=true + applied=null
      queryClient.setQueryData<RealExpense[]>(queryKey, (prev = []) =>
        prev.map((e) =>
          e.id === id
            ? {
                ...e,
                is_carried_over: !validate,
                applied_to_balance_at: validate ? new Date().toISOString() : null,
              }
            : e,
        ),
      )
      return { previous }
    },
    onSuccess: (result, { id }) => {
      if (!result.ok) return
      queryClient.setQueryData<RealExpense[]>(queryKey, (prev = []) =>
        prev.map((e) =>
          e.id === id
            ? {
                ...e,
                is_carried_over: result.isCarriedOver,
                applied_to_balance_at: result.appliedAt,
              }
            : e,
        ),
      )
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous)
      logger.error('❌ [useRealExpenses] Error in toggleCarryApplied:', err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-balance'] })
      invalidateFinancialRefreshes(queryClient)
    },
  })

  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0)

  const latestError =
    addMutation.error ?? updateMutation.error ?? deleteMutation.error ?? queryError
  const error = latestError instanceof Error ? latestError.message : null

  // Stable refresh reference — useBudgetProgress wraps this in its own
  // useCallback with refreshExpenses in deps. Without stability here that
  // chain reboots every render → useEffect dep churn → refetch loop.
  const refreshExpenses = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    expenses,
    loading: isLoading,
    isFetching,
    error,
    totalExpenses,
    addExpense: async (expenseData) => {
      try {
        await addMutation.mutateAsync(expenseData)
        return true
      } catch {
        return false
      }
    },
    updateExpense: async (expenseData) => {
      try {
        await updateMutation.mutateAsync(expenseData)
        return true
      } catch {
        return false
      }
    },
    deleteExpense: async (expenseId) => {
      try {
        await deleteMutation.mutateAsync(expenseId)
        return true
      } catch {
        return false
      }
    },
    toggleApplied: async (expenseId, apply) => {
      try {
        const result = await toggleAppliedMutation.mutateAsync({ id: expenseId, apply })
        if (!result.ok) return 'no-op'
        return apply ? 'applied' : 'unapplied'
      } catch {
        return 'error'
      }
    },
    toggleCarryApplied: async (expenseId, validate) => {
      try {
        const result = await toggleCarryAppliedMutation.mutateAsync({ id: expenseId, validate })
        if (!result.ok) return 'no-op'
        return validate ? 'applied' : 'unapplied'
      } catch {
        return 'error'
      }
    },
    refreshExpenses,
  }
}
