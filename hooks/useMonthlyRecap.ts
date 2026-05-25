'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { invalidateFinancialRefreshes } from '@/lib/query-client'
import type { RecapContext, RecapStatusKind, RecapStep, RecapSummary } from '@/lib/recap'

/**
 * Sprint 13 — `recap` sibling exposed by GET /api/monthly-recap/status when
 * the wizard is `in_progress`. Carries the progression trackers from the
 * `monthly_recaps` row so the negative-flow `BilanNegativeStep` can compute
 * the remaining deficit live (`|bilan| - refloatedFromPiggy -
 * refloatedFromSavings - sum(snapshotData)`). `null` in every other status
 * state (no_recap / locked_by_other / completed).
 */
export interface RecapProgress {
  id: string
  currentStep: RecapStep
  refloatedFromPiggy: number
  refloatedFromSavings: number
  snapshotData: Record<string, number> | null
}

export interface MonthlyRecapStatusResponse {
  status: RecapStatusKind
  summary: RecapSummary | null
  /** Sprint 13 — present iff `status.kind === 'in_progress'`. Nullable to
   *  keep the field tolerant of degraded/legacy responses. */
  recap: RecapProgress | null
  /** Sprint Complete-Month-Step (2026-05-29) — year/month being recapped,
   *  derived server-side from `checkRecapStatus`. Used by CompleteMonthStep
   *  to filter the transaction list to the recapped period and default the
   *  AddTransactionModal date to the last day of the recap month. */
  recapYear: number
  recapMonth: number
}

const recapStatusKey = (context: RecapContext) => ['monthly-recap', 'status', context] as const

export interface UseMonthlyRecapOptions {
  /**
   * Skip the fetch when false. Used by `RecapWizard` to conditionally peek
   * at the OTHER context's recap (profile context wizard peeking at group
   * recap status to know if it should redirect there post-finalize instead
   * of `/dashboard`). Defaults to true. Sprint 14 follow-up 2026-05-25.
   */
  enabled?: boolean
}

export function useMonthlyRecap(context: RecapContext, options?: UseMonthlyRecapOptions) {
  return useQuery<MonthlyRecapStatusResponse>({
    queryKey: recapStatusKey(context),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/monthly-recap/status?context=${context}`, { signal })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'fetch_status_failed')
      }
      const json = (await res.json()) as { data: MonthlyRecapStatusResponse }
      return json.data
    },
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export interface StartRecapMutationResult {
  recap: { id: string; current_step: string }
  summary: RecapSummary
}

/**
 * Claim the recap lock for the current month via POST /api/monthly-recap/start.
 * Idempotent against re-clicks (RPC returns 'resumed' if the recap already
 * exists for the same initiator). On 409 'locked_by_other' or 410
 * 'already_completed', the mutation rejects with `Error(body.error)`.
 *
 * Invalidates `['monthly-recap', 'status', context]` on success — the wizard
 * re-fetches and routes by the new `status.step`.
 */
export function useStartRecap(context: RecapContext) {
  const qc = useQueryClient()
  return useMutation<StartRecapMutationResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch('/api/monthly-recap/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'start_failed')
      }
      const json = (await res.json()) as { data: StartRecapMutationResult }
      return json.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: recapStatusKey(context) })
    },
  })
}

export interface AdvanceStepMutationVars {
  fromStep: RecapStep
  toStep: RecapStep
}

export interface AdvanceStepMutationResult {
  recap: { id: string; current_step: string }
  summary: RecapSummary
}

/**
 * Generic explicit wizard advance via POST /api/monthly-recap/advance-step.
 * Used by the Welcome (`welcome → summary`) and Summary (`summary →
 * manage_bilan`) buttons. Server validates the transition via
 * `isAdvanceAllowed` + matches `current_step === fromStep` (race guard).
 *
 * Invalidates `['monthly-recap', 'status', context]` on success — the
 * wizard re-fetches and renders the new step component automatically.
 *
 * **`stale_step` recovery (sprint 14 follow-up 2026-05-25)** : the negative
 * flow's `save-budget-snapshot` and the salary flow's `update-salaries`
 * both auto-advance `current_step` server-side. When the client subsequently
 * fires an explicit advance-step with the old `fromStep`, the server
 * answers 409 `stale_step`. Without invalidation in that branch, the cache
 * stayed on the prior step and the wizard wouldn't render the new step
 * until the user refreshed. We now invalidate on `stale_step` too so the
 * cache resyncs with the actual server state — `BilanNegativeStep` already
 * swallows the error silently, this just closes the missing refetch.
 */
export function useAdvanceStep(context: RecapContext) {
  const qc = useQueryClient()
  return useMutation<AdvanceStepMutationResult, Error, AdvanceStepMutationVars>({
    mutationFn: async ({ fromStep, toStep }) => {
      const res = await fetch('/api/monthly-recap/advance-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, fromStep, toStep }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'advance_failed')
      }
      const json = (await res.json()) as { data: AdvanceStepMutationResult }
      return json.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: recapStatusKey(context) })
    },
    onError: async (error) => {
      if (error.message === 'stale_step' || error.message === 'invalid_step') {
        await qc.invalidateQueries({ queryKey: recapStatusKey(context) })
      }
    },
  })
}

export interface TransferSurplusesToPiggyVars {
  budgetIds: string[]
}

export interface TransferSurplusesToPiggyResult {
  transferred: ReadonlyArray<{ budgetId: string; amount: number }>
  failed: readonly string[]
  summary: RecapSummary
}

/**
 * Sprint 12 — positive flow action 1. POST /api/monthly-recap/transfer-surpluses-to-piggy
 * with a non-empty `budgetIds` list. Each per-budget transfer goes through the
 * atomic RPC `transfer_budget_to_piggy_bank`; the loop is fail-soft (per-budget
 * failures appear in `failed[]` and remaining transfers proceed).
 *
 * The server returns a fresh `RecapSummary` reflecting the post-transfer state
 * — we `setQueryData` directly to avoid a re-fetch round-trip. The user
 * typically chains "transfer partial" → "transform the rest" without waiting,
 * so re-render must be immediate.
 *
 * The route does NOT advance `current_step` — the wizard stays on
 * `manage_bilan` after the transfer.
 */
export function useTransferSurplusesToPiggy(context: RecapContext) {
  const qc = useQueryClient()
  return useMutation<TransferSurplusesToPiggyResult, Error, TransferSurplusesToPiggyVars>({
    mutationFn: async ({ budgetIds }) => {
      const res = await fetch('/api/monthly-recap/transfer-surpluses-to-piggy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, budgetIds }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'transfer_failed')
      }
      const json = (await res.json()) as { data: TransferSurplusesToPiggyResult }
      return json.data
    },
    onSuccess: (data) => {
      qc.setQueryData<MonthlyRecapStatusResponse>(recapStatusKey(context), (old) =>
        old ? { ...old, summary: data.summary } : old,
      )
    },
  })
}

export interface TransformRemainingSurplusesResult {
  transformed: ReadonlyArray<{ budgetId: string; amount: number }>
  failed: readonly string[]
  nextStep: RecapStep | null
}

/**
 * Sprint 12 — positive flow action 2 (terminates the 4.A branch). POST
 * /api/monthly-recap/transform-remaining-surpluses-to-savings — sweeps every
 * remaining positive surplus into the budgets' `cumulated_savings` and advances
 * `current_step → 'salary_update'` server-side (no-op safe when no targets).
 *
 * The response does NOT include a fresh `RecapSummary` (only
 * `transformed/failed/nextStep`), so we `invalidateQueries` — the `useQuery`
 * re-fetches `/status` and the `RecapWizard` re-renders on the new step.
 */
export function useTransformRemainingSurplusesToSavings(context: RecapContext) {
  const qc = useQueryClient()
  return useMutation<TransformRemainingSurplusesResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch('/api/monthly-recap/transform-remaining-surpluses-to-savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'transform_failed')
      }
      const json = (await res.json()) as { data: TransformRemainingSurplusesResult }
      return json.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: recapStatusKey(context) })
    },
  })
}

// ---------------------------------------------------------------------------
// Sprint 13 — negative flow mutations (BilanNegativeStep cascade)
// ---------------------------------------------------------------------------

export interface RefloatFromPiggyVars {
  amount: number
}

export interface RefloatFromPiggyResult {
  newDeficit: number
  refloatedFromPiggy: number
  summary: RecapSummary
}

/**
 * Sprint 13 — negative flow action 1 (BilanNegativeStep ligne 1). POST
 * /api/monthly-recap/refloat-from-piggy with the user-chosen amount (clamped
 * by the UI to `min(piggy, deficitRemaining)`). Debits `piggy_bank.amount`
 * via the atomic single-row RPC and bumps `monthly_recaps.refloated_from_piggy`.
 *
 * Cache update strategy: `setQueryData` fast path — the response carries a
 * fresh `RecapSummary` (post-debit `piggyAmount`) AND the new cumulative
 * `refloatedFromPiggy` tracker. We patch both into `summary` and `recap` of
 * the cached status entry so `BilanNegativeStep` re-renders with the new
 * deficit counter without a round-trip. `snapshotData` and
 * `refloatedFromSavings` are preserved verbatim from the prior cache.
 *
 * Does NOT advance `current_step` — the route never does, and the user may
 * continue chaining refloats on the same step.
 */
export function useRefloatFromPiggy(context: RecapContext) {
  const qc = useQueryClient()
  return useMutation<RefloatFromPiggyResult, Error, RefloatFromPiggyVars>({
    mutationFn: async ({ amount }) => {
      const res = await fetch('/api/monthly-recap/refloat-from-piggy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, amount }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'refloat_piggy_failed')
      }
      const json = (await res.json()) as { data: RefloatFromPiggyResult }
      return json.data
    },
    onSuccess: (data) => {
      qc.setQueryData<MonthlyRecapStatusResponse>(recapStatusKey(context), (old) => {
        if (!old) return old
        const nextRecap: RecapProgress | null = old.recap
          ? { ...old.recap, refloatedFromPiggy: data.refloatedFromPiggy }
          : old.recap
        return { ...old, summary: data.summary, recap: nextRecap }
      })
    },
  })
}

export interface RefloatFromSavingsResult {
  newDeficit: number
  refloatedFromSavings: number
  perBudget: ReadonlyArray<{ budgetId: string; amount: number }>
  failed: ReadonlyArray<{ budgetId: string; reason: string }>
  shortfall: number
  summary: RecapSummary
}

/**
 * Sprint 13 — negative flow action 2 (BilanNegativeStep ligne 2). POST
 * /api/monthly-recap/refloat-from-savings with no body other than `context`.
 * Server computes the proportional allocation across each budget's
 * `cumulated_savings` and debits up to the current `deficitRemaining`. Loop
 * is fail-soft (per-budget failures surface in `failed[]`).
 *
 * Cache update strategy: `setQueryData` fast path — same shape as piggy.
 *
 * Does NOT advance `current_step`.
 */
export function useRefloatFromSavings(context: RecapContext) {
  const qc = useQueryClient()
  return useMutation<RefloatFromSavingsResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch('/api/monthly-recap/refloat-from-savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'refloat_savings_failed')
      }
      const json = (await res.json()) as { data: RefloatFromSavingsResult }
      return json.data
    },
    onSuccess: (data) => {
      qc.setQueryData<MonthlyRecapStatusResponse>(recapStatusKey(context), (old) => {
        if (!old) return old
        const nextRecap: RecapProgress | null = old.recap
          ? { ...old.recap, refloatedFromSavings: data.refloatedFromSavings }
          : old.recap
        return { ...old, summary: data.summary, recap: nextRecap }
      })
    },
  })
}

export interface SaveBudgetSnapshotResult {
  newDeficit: number
  snapshot: Record<string, number>
  perBudget: ReadonlyArray<{ budgetId: string; amount: number }>
  shortfall: number
  nextStep: 'salary_update' | null
}

/**
 * Sprint 13 — negative flow action 3 (BilanNegativeStep ligne 3). POST
 * /api/monthly-recap/save-budget-snapshot with no body other than `context`.
 * Server computes the proportional snapshot (pool = `estimated_amount`),
 * OVERWRITES `monthly_recaps.budget_snapshot_data` JSONB, and — uniquement
 * dans le flow négatif — advances `current_step → 'salary_update'` iff the
 * new deficit reaches 0.
 *
 * Cache update strategy: `setQueryData` fast path — we patch
 * `recap.snapshotData` in place with the server-computed snapshot so the
 * UI re-renders the per-budget breakdown without a refetch ("stay on page"
 * UX). We deliberately DO NOT mirror the server-side `current_step`
 * auto-advance into the cache: even when the snapshot covers the deficit,
 * the wizard stays on `BilanNegativeStep` so the user sees a final success
 * snackbar + the "Continuer" button. The Continuer click then triggers a
 * refetch (or an explicit advance-step), which is when the wizard moves to
 * `SalaryUpdateStep`.
 */
export function useSaveBudgetSnapshot(context: RecapContext) {
  const qc = useQueryClient()
  return useMutation<SaveBudgetSnapshotResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch('/api/monthly-recap/save-budget-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'save_snapshot_failed')
      }
      const json = (await res.json()) as { data: SaveBudgetSnapshotResult }
      return json.data
    },
    onSuccess: (data) => {
      qc.setQueryData<MonthlyRecapStatusResponse>(recapStatusKey(context), (old) => {
        if (!old) return old
        const nextRecap: RecapProgress | null = old.recap
          ? { ...old.recap, snapshotData: data.snapshot }
          : old.recap
        return { ...old, recap: nextRecap }
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Sprint 14 — salary update + finalize mutations (SalaryUpdateStep + FinalRecapStep)
// ---------------------------------------------------------------------------

export interface UpdateSalariesVars {
  salaries: ReadonlyArray<{ profileId: string; salary: number }>
}

export interface UpdateSalariesResult {
  updated: number
  nextStep: 'final_recap'
  contributionsRecalculated: boolean
}

/**
 * Sprint 14 — écran 4 "Mise à jour du salaire". POST
 * /api/monthly-recap/update-salaries with `{ context, salaries: [...] }`.
 *
 * The server validates initiator + step + group membership, UPDATEs
 * `profiles.salary`, and (group context only) re-invokes
 * `calculate_group_contributions`. **It auto-advances** `current_step →
 * 'salary_update' → 'final_recap'` — the wizard re-renders the next step
 * after invalidation.
 *
 * Invalidates `['monthly-recap', 'status', context]` AND the financial
 * refresh keys (`['financial-summary']`, `['group-contributions']`,
 * `['budgets']`, `['progress-data']`, `['savings-data']`) since the new
 * salary/contributions feed the dashboard read-only rows + group header
 * after the recap completes (sprint 16 — read-only virtual rows).
 */
export function useUpdateSalaries(context: RecapContext) {
  const qc = useQueryClient()
  return useMutation<UpdateSalariesResult, Error, UpdateSalariesVars>({
    mutationFn: async ({ salaries }) => {
      const res = await fetch('/api/monthly-recap/update-salaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, salaries }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'update_salaries_failed')
      }
      const json = (await res.json()) as { data: UpdateSalariesResult }
      return json.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: recapStatusKey(context) })
      void qc.invalidateQueries({ queryKey: ['profile'] })
      invalidateFinancialRefreshes(qc)
    },
  })
}

export interface CompleteRecapResult {
  /** Present on first success — the recap that was just finalized. */
  recapId?: string
  completed?: true
  snapshotApplied?: { applied: ReadonlyArray<{ budget_id: string; amount: number }> } | null
  transactions?: {
    deleted_expenses: number
    deleted_incomes: number
    carried_expenses: number
    carried_incomes: number
  }
  /** Present on idempotent re-call when the recap was already completed. */
  alreadyCompleted?: true
  recap?: { id: string; completed_at: string; current_step: string }
}

/**
 * Sprint 14 — écran 5 "Retourner au dashboard" button. POST
 * /api/monthly-recap/complete with just `{ context }`. The server orchestrates
 * `finalize_recap_apply_snapshot` (deferred budget snapshot → carryover_spent)
 * + `process_recap_transactions` (DELETE validated, flag carried) and marks
 * `monthly_recaps.completed_at = now()`.
 *
 * **Idempotent** on re-click : if the recap was already completed for this
 * month, the server returns `{ alreadyCompleted: true, recap }` with HTTP 200
 * (not an error). The caller treats both shapes as success.
 *
 * Invalidates `['monthly-recap', 'status', context]` so the wizard's
 * `useEffect(kind === 'completed')` fires `router.replace` to the dashboard.
 * Also invalidates the financial refresh keys since `process_recap_transactions`
 * DELETEs validated real_expenses/real_incomes and the finalize snapshot
 * UPDATEs `estimated_budgets.carryover_spent_amount` — both impact the
 * dashboard summary immediately on landing.
 */
export function useCompleteRecap(context: RecapContext) {
  const qc = useQueryClient()
  return useMutation<CompleteRecapResult, Error, void>({
    mutationFn: async () => {
      const res = await fetch('/api/monthly-recap/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'complete_failed')
      }
      const json = (await res.json()) as { data: CompleteRecapResult }
      return json.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: recapStatusKey(context) })
      invalidateFinancialRefreshes(qc)
    },
  })
}
