/**
 * Barrel re-export for the lib/finance/ modules.
 *
 * Consumers can import the public API as `from '@/lib/finance'` rather
 * than the precise sub-path. Useful for the migration of the 17 importers
 * at chantier I4 / commit #9 — single import line per consumer.
 *
 * Sub-modules can also be imported directly when more precise:
 *   - @/lib/finance/calc-rtl              (pure formulas)
 *   - @/lib/finance/income-compensation   (DB-bound contribution helper)
 *   - @/lib/finance/financial-data        (orchestrator)
 *   - @/lib/finance/budget-savings-detail (per-budget breakdown)
 *   - @/lib/finance/rav-persistence       (RAV read/write)
 *   - @/lib/finance/snapshots             (snapshot dispatcher)
 *   - @/lib/finance/{piggy-bank,bank-balance,budget-savings,context}
 *     (Sprint 0 / C3 atomic RPC helpers)
 *   - @/lib/finance/budget-transfers      (Sprint Refactor-I5-followup-v2
 *     composite RPC for monthly recap step 2.4.2 — transfer + savings debit
 *     in one Postgres transaction)
 */

export {
  calculateAvailableCash,
  calculateBudgetDeficit,
  calculateBudgetSavings,
  calculateRemainingToLiveGroup,
  calculateRemainingToLiveProfile,
} from './calc-rtl'
export { EMPTY_FINANCIAL_DATA } from './constants'
export { asContextFilter, resolveContextIds, type ContextFilter, type ContextIds } from './context'
export { calculateIncomeCompensation } from './income-compensation'
export { getBudgetSavingsDetail } from './budget-savings-detail'
export { getGroupFinancialData, getProfileFinancialData } from './financial-data'
export { getRavFromDatabase, saveRavToDatabase } from './rav-persistence'
export { saveRemainingToLiveSnapshot } from './snapshots'
export {
  AppliedToggleNoOpError,
  toggleRealExpenseAppliedToBalance,
  toggleRealIncomeAppliedToBalance,
  type AppliedToggleResult,
} from './applied-balance'
export {
  CarryOverToggleNoOpError,
  deleteCarriedExpenseToPiggy,
  toggleCarryOverAndApply,
  toggleCarryOverAndApplyIncome,
  type CarryOverToggleResult,
  type DeleteCarriedExpenseResult,
} from './carry-over'
export type { BudgetSavings, FinancialData } from './types'
