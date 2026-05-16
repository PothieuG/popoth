/**
 * Types for the monthly recap recovery (`/api/monthly-recap/recover`).
 *
 * Sprint Refactor-Recover (2026-05-16): extracted from
 * app/api/monthly-recap/recover/route.ts (was 385 LOC mixed
 * orchestration / I/O / logging with a 95-LOC closure-based restoreTable
 * helper). The route is split into three layers:
 *   - lib/recap/recover-types.ts     — these type definitions
 *   - lib/recap/recover-algorithm.ts — pure dispatcher v1|v2 (0 I/O)
 *   - lib/recap/recover-persist.ts   — I/O orchestrator + restoreTable
 *
 * IMPORTANT — TABLES INCLUDED IN SnapshotPayloadV2 BUT NOT RESTORED:
 *
 * Sprint Polish T4 (2026-05-07) introduced SnapshotPayloadV2 which CAPTURES
 * 12 tables: profiles, estimated_incomes, estimated_budgets,
 * real_income_entries, real_expenses, bank_balances, piggy_bank,
 * budget_transfers, monthly_recaps, remaining_to_live_snapshots, groups,
 * group_contributions. However the recover route only RESTORES 7 of those:
 *
 *   ✓ Restored:    estimated_incomes / estimated_budgets /
 *                  real_income_entries / real_expenses / bank_balances /
 *                  piggy_bank / budget_transfers
 *   ✗ NOT restored: profiles / groups / group_contributions /
 *                  monthly_recaps / remaining_to_live_snapshots
 *
 * Rationale (intentional, preserved verbatim 2026-05-16):
 *   - `profiles` / `groups` / `group_contributions` are identity/membership
 *     data — restoring them would risk overwriting user-edited names,
 *     emails, group memberships made AFTER the snapshot was taken. The
 *     recovery flow is meant to undo a FAILED monthly recap, not to
 *     forklift the entire user state.
 *   - `monthly_recaps` is the *output* of the flow — restoring it would
 *     re-create a completed recap state that conflicts with the user's
 *     intent to retry/recover.
 *   - `remaining_to_live_snapshots` is an audit trail (max 50 most recent)
 *     and would create cascade noise if restored.
 *
 * If a future incident shows that one of these tables NEEDS to be restored,
 * spin a dedicated `Recover-V2-Complete-Restoration` sprint with FK cascade
 * tests for each additional table.
 */

import type { SnapshotPayload } from '@/lib/recap-snapshot.types'

// ---------------------------------------------------------------------------
// Restorable table inventory + result-key disjoint union
// ---------------------------------------------------------------------------

/**
 * The 7 tables restored by the recovery flow. Order in which they're
 * applied is FK-safe (parents before children) and is pinned by the
 * algorithm tests (see recover-algorithm.test.ts).
 */
export type RestorableTable =
  | 'estimated_incomes'
  | 'estimated_budgets'
  | 'real_income_entries'
  | 'real_expenses'
  | 'bank_balances'
  | 'piggy_bank'
  | 'budget_transfers'

/**
 * Tables whose `recovery_results` entry is a COUNT of rows inserted
 * (mirror route L99-105).
 */
export type CountResultKey =
  | 'estimated_incomes'
  | 'estimated_budgets'
  | 'real_incomes'
  | 'real_expenses'
  | 'budget_transfers'

/**
 * Tables whose `recovery_results` entry is a STRICT BOOLEAN flag (mirror
 * Sprint Lint-Followups Item 1 fix). The pre-fix code typed these as
 * `boolean | number` and the v2 path assigned `data.length` (numeric);
 * the fix normalises both v1 and v2 paths to assign `true` on success.
 */
export type BooleanResultKey = 'bank_balance' | 'piggy_bank'

export type ResultKey = CountResultKey | BooleanResultKey

// ---------------------------------------------------------------------------
// Pipeline I/O types
// ---------------------------------------------------------------------------

/**
 * Inputs accepted by `processRecovery`. The HTTP handler resolves
 * `withAuthAndProfile` context + the parsed body into this shape.
 */
export interface ProcessRecoveryInput {
  userId: string
  context: 'profile' | 'group'
  /** Computed from withAuthAndProfile: profile.id (profile ctx) or profile.group_id (group ctx) */
  contextId: string
  ownerField: 'profile_id' | 'group_id'
  /** Optional — when absent, the loader picks the most recent active snapshot for the current month */
  snapshotId?: string
  /**
   * Captured at handler-time so the algorithm/persist are deterministic
   * (mirror complete-types.ts ProcessCompleteInput.currentDate invariant).
   * The loader reads `getMonth() + 1` and `getFullYear()` from this Date
   * to scope the snapshot lookup without calling `new Date()` itself.
   */
  currentDate: Date
}

/**
 * Snapshot row loaded from `recap_snapshots`. The `payload` is the
 * deserialised SnapshotPayload v1|v2 — discriminated via `isSnapshotV2()`
 * from @/lib/recap-snapshot.types. The `snapshotRowId` is needed by the
 * persist layer's step 8 to flip `is_active` to false.
 */
export interface ProcessRecoverySnapshot {
  snapshotRowId: string
  snapshotCreatedAt: string | null
  payload: SnapshotPayload
}

/**
 * One restoration action produced by the algorithm. The persist layer
 * applies them sequentially in the order returned by the algorithm.
 *
 * - `restore_table`: DELETE all rows owned by `contextId`, then INSERT
 *   the provided rows. Result key tracks count (CountResultKey) or
 *   boolean true on success (BooleanResultKey).
 * - `update_bank_balance_v1`: v1 fallback — when SnapshotPayloadV2 has
 *   no `bank_balances` array but a scalar `bank_balance: number`, the
 *   route does `UPDATE bank_balances SET balance = ?` rather than
 *   delete+insert. Maps to the same `bank_balance` boolean flag.
 */
export type RestorationAction =
  | {
      kind: 'restore_table'
      table: RestorableTable
      /** Typed dispatch is done in the persist layer via switch on `table`. */
      rows: ReadonlyArray<unknown>
      resultKey: ResultKey
    }
  | {
      kind: 'update_bank_balance_v1'
      amount: number
    }

/**
 * Decision produced by the pure algorithm. Immutable. The persist layer
 * applies these actions in order then deactivates the snapshot.
 *
 * Skipped actions (empty arrays, v1 without scalar bank_balance, v2
 * branches with both bank_balances=[] and bank_balance=null) are NOT
 * included in `actions` — the persist layer just skips them implicitly.
 * Tests against the algorithm assert action ABSENCE to pin that contract.
 */
export interface ProcessRecoveryDecision {
  /** Ordered list of restore actions (FK-safe parents-first) */
  actions: RestorationAction[]
  /** Snapshot row id to deactivate after restoration (mirror route step 8) */
  snapshotRowId: string
}

/**
 * The recovery_results shape returned in the JSON response (mirror route
 * L89-107). Booleans for bank/piggy are STRICT (Sprint Lint-Followups
 * Item 1 — typed and runtime-asserted `true | false`, never numeric).
 */
export interface RecoveryResults {
  estimated_incomes: number
  estimated_budgets: number
  real_incomes: number
  real_expenses: number
  bank_balance: boolean
  piggy_bank: boolean
  budget_transfers: number
  errors: string[]
}

/**
 * Output returned by `processRecovery` to the HTTP handler. Maps 1:1 to
 * the JSON response body of POST /api/monthly-recap/recover (mirror
 * route.ts L275-285 + L292-295 error path returns the same shape).
 *
 * `has_errors` is convenience-derived from `recovery_results.errors.length`
 * so the consumer doesn't need to recompute.
 */
export interface ProcessRecoveryOutput {
  success: true
  message: string
  snapshot_id: string
  snapshot_date: string | null
  recovery_results: RecoveryResults
  context: 'profile' | 'group'
  month: number
  year: number
  has_errors: boolean
}

// ---------------------------------------------------------------------------
// Error classes — mapped by the HTTP handler to status codes
// ---------------------------------------------------------------------------

/**
 * Thrown by the snapshot loader when `context === 'group'` but the profile
 * has no `group_id`. Mirror route L46-51 400 path. The HTTP handler maps
 * this to NextResponse.json({error}, {status: 400}).
 */
export class RecoverContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecoverContextError'
  }
}

/**
 * Thrown by the snapshot loader when no `recap_snapshots` row matches the
 * (contextId, month, year, optional snapshotId) tuple. Mirror route L72-77
 * 404 path.
 */
export class RecoverSnapshotNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecoverSnapshotNotFoundError'
  }
}

/**
 * Thrown by the snapshot loader when the snapshot's `snapshot_data` JSONB
 * blob is null or missing required fields (estimated_incomes /
 * estimated_budgets). Mirror route L81-86 500 path.
 */
export class RecoverSnapshotCorruptedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecoverSnapshotCorruptedError'
  }
}
