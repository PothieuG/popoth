import { z } from 'zod'
import { uuidSchema } from './common'

/**
 * Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23) — body schema for
 * POST /api/finance/{expenses,income}/real/toggle-applied. The route flips
 * `applied_to_balance_at` on a real_expenses / real_income_entries row and
 * adjusts `bank_balances.balance` in one Postgres tx (composite RPC).
 */
export const toggleAppliedBodySchema = z.object({
  id: uuidSchema,
  apply: z.boolean(),
})
export type ToggleAppliedBody = z.infer<typeof toggleAppliedBodySchema>
