/**
 * Monthly Recap V3 — state machine (pure, sync).
 *
 * The 7 wizard steps in forward order. `'completed'` is the terminal state.
 * The `manage_bilan` UI varies based on the period's bilan sign, but the
 * sequence itself is static (no conditional skip at this layer).
 *
 * `'complete_month'` (sprint Complete-Month-Step) sits between `'welcome'`
 * and `'summary'` — the user can add forgotten transactions of the recapped
 * month before viewing the bilan. Distinct from `'completed'` (terminal).
 */
export type RecapStep =
  | 'welcome'
  | 'complete_month'
  | 'summary'
  | 'manage_bilan'
  | 'salary_update'
  | 'final_recap'
  | 'completed'

export const RECAP_STEP_ORDER = [
  'welcome',
  'complete_month',
  'summary',
  'manage_bilan',
  'salary_update',
  'final_recap',
  'completed',
] as const satisfies readonly RecapStep[]

/**
 * Forward-only transition guard. Returns true when `to` is strictly after
 * `from` in `RECAP_STEP_ORDER`. Skipping intermediate steps is allowed —
 * the endpoint layer decides whether a skip is legal business-wise.
 *
 * `isAdvanceAllowed(x, x)` is always false (no self-loop).
 */
export function isAdvanceAllowed(from: RecapStep, to: RecapStep): boolean {
  const fi = RECAP_STEP_ORDER.indexOf(from)
  const ti = RECAP_STEP_ORDER.indexOf(to)
  return fi >= 0 && ti > fi
}

/**
 * Compute the natural next step in linear order. Returns `null` when the
 * recap is already `'completed'` (terminal). Does not consult any business
 * context (bilan sign, group membership) — that lives in the endpoint layer.
 */
export function nextRequiredStep(current: RecapStep): RecapStep | null {
  const i = RECAP_STEP_ORDER.indexOf(current)
  if (i < 0 || i >= RECAP_STEP_ORDER.length - 1) return null
  return RECAP_STEP_ORDER[i + 1] ?? null
}
