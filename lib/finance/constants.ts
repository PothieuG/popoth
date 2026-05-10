/**
 * Shared constants for the lib/finance/ modules.
 *
 * Extracted from lib/financial-calculations.ts at chantier I4 — both
 * getProfileFinancialData and getGroupFinancialData fall back to a
 * zeroed FinancialData on caught errors. Centralized here so the two
 * sites cannot drift.
 */

import type { FinancialData } from './types'

/**
 * Zeroed FinancialData template returned by get*FinancialData when the
 * underlying calculation throws. Callers depend on receiving a usable
 * shape rather than a thrown error (UX choice — the dashboard renders
 * zeros instead of an error screen on transient failure). Optional fields
 * (bankBalance, piggyBank, totalEstimatedBudget) are intentionally omitted
 * to match the original inline fallback shape.
 *
 * Frozen to prevent accidental mutation — callers MUST spread (`{...EMPTY_FINANCIAL_DATA}`)
 * before mutating, since the original inline literals returned fresh
 * objects each time.
 */
export const EMPTY_FINANCIAL_DATA: Readonly<FinancialData> = Object.freeze({
  availableBalance: 0,
  remainingToLive: 0,
  totalSavings: 0,
  totalEstimatedIncome: 0,
  totalEstimatedBudgets: 0,
  totalRealIncome: 0,
  totalRealExpenses: 0,
})
