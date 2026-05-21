/**
 * Types for the monthly recap auto-balance algorithm.
 *
 * Sprint Refactor-Auto-Balance (2026-05-16): extracted from
 * app/api/monthly-recap/auto-balance/route.ts (god file ~533 LOC). The
 * algorithm is split into three layers:
 *   - lib/recap/auto-balance-types.ts     — these type definitions
 *   - lib/recap/auto-balance-algorithm.ts — pure decision logic (0 I/O)
 *   - lib/recap/auto-balance-persist.ts   — I/O orchestrator
 *
 * Atomicity contracts (preserved from Sprint Auto-Balance-Atomic + Phase-B,
 * 2026-05-15):
 *   - savings transfers via transferWithSavingsDebit composite RPC
 *     (INSERT budget_transfers + debit cumulated_savings in one tx)
 *   - piggy transfers via transferPiggyToBudgetWithInsert composite RPC
 *     (debit piggy_bank + INSERT budget_transfers (from=NULL) in one tx)
 *   - surplus transfers via single batched INSERT into budget_transfers
 *     (no debit — surplus is computed, not stored as a column)
 *   - per-pair fail-soft via logger.warn + continue (not hard-500)
 *
 * `RecapContextError` (context='group' without group_id) is reused from
 * complete-types.ts — same semantics across the recap routes.
 */

/**
 * Inputs accepted by `processAutoBalance`. The HTTP handler resolves the
 * `withAuthAndProfile` context into this shape before calling.
 */
export interface ProcessAutoBalanceInput {
  userId: string
  context: 'profile' | 'group'
  contextId: string
  ownerField: 'profile_id' | 'group_id'
}

/**
 * Per-budget analysis extracted from `estimated_budgets` + `real_expenses` +
 * `budget_transfers`. Mirror the route's in-memory shape (lines 142-170 of
 * the pre-extraction route.ts). The pure algorithm operates on arrays of
 * this type — `monthly_surplus` and `monthly_deficit` are pre-computed,
 * mutually exclusive (only one is >0).
 *
 * `spent_amount` is the ADJUSTED spent value: real_expenses + transfersFrom
 * - transfersTo. This captures the effect of any prior manual transfers on
 * the budget's effective consumption.
 */
export interface BudgetAnalysis {
  id: string
  name: string
  estimated_amount: number
  spent_amount: number
  cumulated_savings: number
  monthly_surplus: number
  monthly_deficit: number
}

/**
 * Pre-decision snapshot built by the persistence layer. The pure algorithm
 * decides what to do given this snapshot — it never reads from the database.
 */
export interface ProcessAutoBalanceSnapshot {
  context: 'profile' | 'group'
  contextId: string
  ownerField: 'profile_id' | 'group_id'
  piggyBank: number
  budgetAnalyses: BudgetAnalysis[]
}

/**
 * One transfer in the response. Mirrors verbatim the route's local
 * `transfers` array shape (lines 214-221 of the pre-extraction route.ts).
 *
 * When `source === 'piggy_bank'`:
 *   - `from_budget_id` is null (piggy is not a budget row)
 *   - `from_budget_name` is the fixed string 'Tirelire 🐷'
 *
 * Otherwise (savings/surplus):
 *   - `from_budget_id` is the source budget's id
 *   - `from_budget_name` is the source budget's name
 */
export interface AutoBalanceTransfer {
  from_budget_id: string | null
  from_budget_name: string
  to_budget_id: string
  to_budget_name: string
  amount: number
  source: 'piggy_bank' | 'savings' | 'surplus'
}

/**
 * One step in the allocation, for observability and unit testing. Not
 * exposed in the HTTP response (the route's response only carries the
 * `transfers` array shape, not a separate operations log). The persist
 * layer can use this for logger.info audit-trail if needed.
 */
export type AllocationOperation =
  | {
      step: '0.piggy_distribute'
      details: {
        to_budget_id: string
        to_budget_name: string
        amount: number
        deficit_proportion: number
      }
    }
  | {
      step: '1.savings_transfer'
      details: {
        from_budget_id: string
        from_budget_name: string
        to_budget_id: string
        to_budget_name: string
        amount: number
      }
    }
  | {
      step: '2.surplus_transfer'
      details: {
        from_budget_id: string
        from_budget_name: string
        to_budget_id: string
        to_budget_name: string
        amount: number
      }
    }

/**
 * Decision produced by the pure algorithm. Immutable — the algorithm never
 * mutates its inputs; the new state is fully described here.
 *
 * `transfers` is the ordered list in PHASE 0 → 1 → 2 order (preserves the
 * route's pre-extraction insertion order so the response is byte-identical).
 *
 * Per-source totals are kept verbatim from the route's local counters
 * (totalPiggyBankUsed/totalSavingsUsed/totalSurplusUsed). The snapshot's
 * totalPiggyBank/totalSavings/totalSurplus/totalDeficit are passed through
 * so the persist layer can compute `remaining_*` in the output without
 * re-summing.
 */
export interface ProcessAutoBalanceDecision {
  transfers: AutoBalanceTransfer[]
  totalPiggyBankUsed: number
  totalSavingsUsed: number
  totalSurplusUsed: number
  totalPiggyBank: number
  totalSavings: number
  totalSurplus: number
  totalDeficit: number
  operations: AllocationOperation[]
}

/**
 * Full success output. The handler spreads this into NextResponse.json — the
 * field names must match the pre-refactor response byte-for-byte (lines
 * 514-527 of the pre-extraction route.ts).
 */
export interface AutoBalanceSuccessOutput {
  success: true
  message: string
  transfers: AutoBalanceTransfer[]
  total_transferred: number
  piggy_bank_used: number
  savings_used: number
  surplus_used: number
  transfers_count: number
  remaining_piggy_bank: number
  remaining_savings: number
  remaining_surplus: number
  remaining_deficit: number
}

/**
 * Empty-output shape for the 3 early-return paths of the route:
 *   - "Aucun budget déficitaire à compenser"     (no deficit budgets)
 *   - "Aucune tirelire, économie ou surplus..." (no resources to redistribute)
 *   - "Aucun transfert nécessaire ou possible" (algorithm produced no transfers,
 *     e.g. when all source budgets are self-referential to the same deficit)
 *
 * The route currently returns 200 with `{ message, transfers: [] }` (no
 * `success: true` field). Preserved verbatim.
 */
export interface AutoBalanceEmptyOutput {
  message: string
  transfers: []
}

/**
 * Discriminated union of the route's 200 responses. The handler does
 * `NextResponse.json(output)` directly — TS narrows on `success: true` for
 * downstream consumers.
 */
export type ProcessAutoBalanceOutput = AutoBalanceSuccessOutput | AutoBalanceEmptyOutput

/**
 * Thrown by the snapshot loader when `estimated_budgets` returns an empty
 * array for the owner. Mirror the original L111-113 404 path:
 * `{ error: 'Aucun budget trouvé' }`. The HTTP handler catches this and
 * maps to NextResponse.json({ error: e.message }, { status: 404 }).
 */
export class RecapNoBudgetsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecapNoBudgetsError'
  }
}
