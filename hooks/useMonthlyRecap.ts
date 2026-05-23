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
