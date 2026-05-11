/**
 * Types for the monthly recap step 1 algorithm.
 *
 * Sprint Refactor-I5: extracted from app/api/monthly-recap/process-step1/route.ts
 * (740 LOC god file). The algorithm is split into three layers:
 *   - lib/recap/types.ts          — these type definitions
 *   - lib/recap/step1-algorithm.ts — pure decision logic (0 I/O)
 *   - lib/recap/step1-persist.ts   — I/O orchestrator (Supabase reads + RPC writes)
 */

/**
 * Inputs accepted by `processStep1`. The HTTP handler resolves the
 * `withAuthAndProfile` context into this shape before calling.
 */
export interface ProcessStep1Input {
  userId: string
  context: 'profile' | 'group'
  contextId: string
  ownerField: 'profile_id' | 'group_id'
}

/**
 * Per-budget analysis extracted from `estimated_budgets` + `real_expenses`.
 * Mirror the original `BudgetAnalysis` interface (route.ts:137-145). The
 * pure algorithm operates on arrays of this type.
 */
export interface BudgetAnalysis {
  id: string
  name: string
  estimated_amount: number
  spent_amount: number
  surplus: number
  deficit: number
  cumulated_savings: number
}

/**
 * Pre-decision snapshot built by the persistence layer. The pure algorithm
 * decides what to do given this snapshot — it never reads from the database.
 */
export interface ProcessStep1Snapshot {
  context: 'profile' | 'group'
  contextId: string
  ownerField: 'profile_id' | 'group_id'
  piggyBank: number
  ravActuel: number
  ravBudgetaire: number
  difference: number
  budgetAnalyses: BudgetAnalysis[]
}

/**
 * One step taken during allocation. Mirror the operations_performed array
 * shape (route.ts:194-198) so the response stays byte-identical after the
 * refactor.
 */
export type AllocationOperation =
  | {
      step: '1.1'
      type: 'excedent_to_piggy_bank'
      details: {
        excedent_amount: number
        old_piggy_bank: number
        new_piggy_bank: number
      }
    }
  | {
      step: '2.2'
      type: 'use_savings'
      details: {
        budget_id: string
        budget_name: string
        amount_used: number
        proportion: number
        old_savings: number
        new_savings: number
      }
    }
  | {
      step: '2.3'
      type: 'consume_surplus'
      details: {
        budget_id: string
        budget_name: string
        amount: number
        proportion: number
      }
    }
  | {
      step: '2.3.1'
      type: 'transfer_to_deficit'
      details: {
        budget_id: string
        budget_name: string
        transfer_amount: number
        deficit_remaining: number
      }
    }
  | {
      step: '2.4.1'
      type: 'excedent_to_piggy_bank'
      details: {
        excedent_amount: number
        old_piggy_bank: number
        new_piggy_bank: number
      }
    }
  | {
      step: '2.4.2.2'
      type: 'refloat_from_savings'
      details: {
        from_budget_id: string
        from_budget_name: string
        to_budget_id: string
        to_budget_name: string
        amount: number
        old_savings: number
        new_savings: number
      }
    }

/**
 * Decision produced by the pure algorithm. Immutable — the algorithm never
 * mutates its inputs; the new state is fully described here.
 *
 * `newBudgetSavings`: keyed by budget id, the new `cumulated_savings` value
 * for each touched budget (only entries that changed appear).
 * `secondPassRefloatOps`: ÉTAPE 2.4.2 ops are decided at the algorithm level
 * but materialize against post-2.3.1 in-memory state. The persist layer
 * applies them after the refetch-and-2.4.1-piggy-push step (the algorithm
 * itself doesn't know the refetched RAV).
 */
export interface ProcessStep1Decision {
  case: 'excedent' | 'deficit'
  operations: AllocationOperation[]
  newPiggyBank: number
  newBudgetSavings: Record<string, number>
  budgetsWithDeficitRefloated: Array<{ id: string; name: string; deficit: number }>
  // CAS 2 only
  gapResiduel?: number
  isFullyBalanced?: boolean
  /**
   * If CAS 2 and equilibre atteint AND there are deficit-budgets with
   * remaining-savings, ÉTAPE 2.4.2 ops are pre-decided here. The persist
   * layer applies them AFTER the 2.4.1 refetch-piggy-push (the algorithm
   * doesn't know `newDifference`, so 2.4.1 is computed in persist).
   */
  secondPassRefloatOps: Array<{
    fromBudgetId: string
    fromBudgetName: string
    toBudgetId: string
    toBudgetName: string
    amount: number
    oldSavings: number
    newSavings: number
  }>
}

/**
 * Final output returned by `processStep1` to the HTTP handler. Maps 1:1 to
 * the JSON response body of POST /api/monthly-recap/process-step1
 * (route.ts:288-303 CAS 1, route.ts:754-766 CAS 2). The handler spreads
 * this object into NextResponse.json — the field names must match the
 * pre-refactor response exactly.
 */
export interface ProcessStep1Output {
  success: true
  case: 'excedent' | 'deficit'
  initial_rav: number
  budgetary_rav: number
  final_rav: number
  difference: number
  piggy_bank_final: number
  operations_performed: AllocationOperation[]
  budgets_with_deficit_refloated: Array<{ id: string; name: string; deficit: number }>
  timestamp: number
  // CAS 2 only
  gap_residuel?: number
  is_fully_balanced?: boolean
}
