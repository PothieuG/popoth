import { z } from 'zod'
import { uuidSchema } from './common'

/**
 * Sprint 15 Monthly Recap V3 (2026-05-27) — body schema for
 * POST /api/finance/{expenses,income}/real/toggle-carry-applied.
 *
 * Route flips both `is_carried_over` AND `applied_to_balance_at` on a
 * carry-over real_expenses / real_income_entries row in one Postgres tx
 * (composite RPC `toggle_carry_over_and_apply{,_income}`).
 *
 *   - validate=true  : carried+unapplied → validated+applied (bank balance
 *                      adjusted for sign of transaction).
 *   - validate=false : validated+applied (was-carried) → carried+unapplied
 *                      (bank balance reverted).
 *
 * The bidirectional flip is allowed only as long as `carried_from_recap_id`
 * remains set — that's the memory marker the RPC inspects on the reverse
 * direction.
 */
export const toggleCarryAppliedBodySchema = z.object({
  id: uuidSchema,
  validate: z.boolean(),
})
export type ToggleCarryAppliedBody = z.infer<typeof toggleCarryAppliedBodySchema>
