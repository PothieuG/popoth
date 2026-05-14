/**
 * Barrel re-export for the monthly recap library. Consumers should
 * `import { ... } from '@/lib/recap'` rather than reaching into the
 * individual modules.
 */

export { checkRecapStatus, RecapStatusError } from './check-status'
export type { RecapContext, RecapStatus } from './check-status'

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
