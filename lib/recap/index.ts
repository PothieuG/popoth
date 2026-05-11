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
