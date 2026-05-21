/**
 * Barrel for the monthly recap V2 ossature.
 *
 * Only re-exports the gating helper for now. V2 modules (algorithm/persist/
 * types) will land here as they are implemented in follow-up sprints.
 *
 * V1 modules are preserved under `@/lib/recap-legacy/*` for reference only —
 * no runtime consumer remains.
 */

export { checkRecapStatus, RecapStatusError } from './check-status'
export type { RecapContext, RecapStatus } from './check-status'
