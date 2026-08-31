import type { RecapStatusKind } from './check-status'

/**
 * True when the app should force navigation toward the recap wizard /
 * lock screen. Once the recap is `completed`, the rest of the month is
 * unblocked — the user can use the app freely until next month's recap.
 */
export function isRecapBlocking(status: RecapStatusKind): boolean {
  return (
    status.kind === 'no_recap' || status.kind === 'in_progress' || status.kind === 'locked_by_other'
  )
}
