'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { RecapContext, RecapStatusKind, RecapStep, RecapSummary } from '@/lib/recap'

export interface MonthlyRecapStatusResponse {
  status: RecapStatusKind
  summary: RecapSummary | null
}

const recapStatusKey = (context: RecapContext) => ['monthly-recap', 'status', context] as const

export function useMonthlyRecap(context: RecapContext) {
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: recapStatusKey(context) })
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: recapStatusKey(context) })
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: recapStatusKey(context) })
    },
  })
}
