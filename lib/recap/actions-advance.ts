/**
 * Monthly Recap V3 — generic step advance helper. Sprint 11.
 *
 * Used by the wizard's explicit "next" transitions where there is no business
 * action attached (e.g. Welcome → Summary, Summary → Manage_bilan, and any
 * future "skip" transition). The other recap action endpoints
 * (`transform-remaining-surpluses-to-savings`, `save-budget-snapshot`,
 * `complete`) embed their own step advance side-effect — they do NOT route
 * through this helper because their advance happens iff the action succeeded.
 *
 * Validation contract :
 *   - `isAdvanceAllowed(fromStep, toStep)` must hold (strict forward order).
 *   - `recap.current_step` must equal `fromStep` (race / stale-client guard).
 *
 * The UPDATE includes `current_step = fromStep` in the WHERE clause to guard
 * against concurrent writers — if a second client advanced first, the UPDATE
 * affects 0 rows and we surface `'stale_step'` rather than overwriting.
 *
 * Pure of business logic — caller (route handler) is responsible for :
 *   - resolving `recap` via `getActiveRecap`
 *   - 403 not_initiator check (`recap.started_by_profile_id !== userId`)
 *   - reloading the summary after success
 *   - mapping the error code to an HTTP status
 */

import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import type { MonthlyRecapRow } from './active-recap'
import { isAdvanceAllowed, type RecapStep } from './state'

export interface ExecuteAdvanceStepArgs {
  recap: MonthlyRecapRow
  fromStep: RecapStep
  toStep: RecapStep
}

export type AdvanceStepError = 'invalid_transition' | 'stale_step' | 'db_error'

export type AdvanceStepOutcome =
  | { success: true; currentStep: RecapStep }
  | { success: false; error: AdvanceStepError }

export async function executeAdvanceStep(
  args: ExecuteAdvanceStepArgs,
): Promise<AdvanceStepOutcome> {
  const { recap, fromStep, toStep } = args

  if (!isAdvanceAllowed(fromStep, toStep)) {
    return { success: false, error: 'invalid_transition' }
  }

  if (recap.current_step !== fromStep) {
    return { success: false, error: 'stale_step' }
  }

  const { data, error } = await supabaseServer
    .from('monthly_recaps')
    .update({ current_step: toStep })
    .eq('id', recap.id)
    .eq('current_step', fromStep)
    .select('id')

  if (error) {
    logger.error('[recap/advance-step] update failed', {
      recapId: recap.id,
      fromStep,
      toStep,
      error,
    })
    return { success: false, error: 'db_error' }
  }

  if (!data || data.length === 0) {
    // The row was updated by a concurrent writer between our SELECT and our UPDATE
    // (or the recap row vanished). Treat as a stale step from the caller's
    // perspective so the UI re-fetches the canonical state.
    return { success: false, error: 'stale_step' }
  }

  return { success: true, currentStep: toStep }
}
