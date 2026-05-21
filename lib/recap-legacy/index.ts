/**
 * Barrel re-export for the monthly recap library. Consumers should
 * `import { ... } from '@/lib/recap-legacy'` rather than reaching into the
 * individual modules.
 */

// Note: checkRecapStatus / RecapStatusError / RecapContext / RecapStatus are
// no longer re-exported here. They remain at `@/lib/recap/check-status` (V2
// path, sole live consumer is `proxy.ts` for the gating). The legacy modules
// below are dormant — preserved for reference only.

export { decideStep1Allocation } from './step1-algorithm'
export { processStep1 } from './step1-persist'

export type {
  AllocationOperation,
  BudgetAnalysis,
  ProcessStep1Decision,
  ProcessStep1Input,
  ProcessStep1Output,
  ProcessStep1Snapshot,
} from './types'

// Sprint Refactor-I6 (2026-05-14)
export { decideCompleteAllocation } from './complete-algorithm'
export { processComplete } from './complete-persist'
export { RecapBudgetNotFoundError, RecapContextError } from './complete-types'
export type {
  AllocationOperation as CompleteAllocationOperation,
  BudgetSnapshot as CompleteBudgetSnapshot,
  ProcessCompleteDecision,
  ProcessCompleteInput,
  ProcessCompleteOutput,
  ProcessCompleteSnapshot,
} from './complete-types'

// Sprint Refactor-Auto-Balance (2026-05-16)
export { decideAutoBalanceAllocation } from './auto-balance-algorithm'
export type { AutoBalanceAlgorithmResult } from './auto-balance-algorithm'
export { processAutoBalance } from './auto-balance-persist'
export { RecapNoBudgetsError } from './auto-balance-types'
export type {
  AllocationOperation as AutoBalanceAllocationOperation,
  AutoBalanceEmptyOutput,
  AutoBalanceSuccessOutput,
  AutoBalanceTransfer,
  BudgetAnalysis as AutoBalanceBudgetAnalysis,
  ProcessAutoBalanceDecision,
  ProcessAutoBalanceInput,
  ProcessAutoBalanceOutput,
  ProcessAutoBalanceSnapshot,
} from './auto-balance-types'

// Sprint Refactor-Recover (2026-05-16)
export { decideRecoveryActions } from './recover-algorithm'
export { loadRecoverySnapshot, applyRecoveryDecision, processRecovery } from './recover-persist'
export {
  RecoverContextError,
  RecoverSnapshotNotFoundError,
  RecoverSnapshotCorruptedError,
  RecoveryAppliedPartiallyError,
} from './recover-types'
export type {
  ProcessRecoveryInput,
  ProcessRecoverySnapshot,
  ProcessRecoveryDecision,
  ProcessRecoveryOutput,
  RecoveryResults,
  RestorableTable,
  RestorationAction,
  ResultKey as RecoverResultKey,
  CountResultKey as RecoverCountResultKey,
  BooleanResultKey as RecoverBooleanResultKey,
} from './recover-types'
