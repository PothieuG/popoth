import { z } from 'zod'
import { isoDateSchema, moneyFormSchema, moneySchema } from './common'

const projectNameSchema = z
  .string()
  .trim()
  .min(2, 'Le nom du projet est requis (minimum 2 caractères)')

/**
 * Body schema for POST /api/finance/projects.
 *
 * camelCase — the handler maps to snake_case columns
 * (`target_amount`, `monthly_allocation`, `deadline_date`) before invoking
 * the `create_savings_project` RPC.
 *
 * `deadlineDate` is validated as YYYY-MM-DD (ISO 8601 date). Calendar
 * sanity (date is in the future, monthly × months ≥ remaining target) is
 * enforced client-side by `makeProjectClientSchema` and server-side by the
 * RPC contract (deadline_date is a DATE column with no past-check — that
 * is intentional, since editing a project can preserve a past deadline if
 * the user explicitly shortened it).
 */
export const createProjectBodySchema = z.object({
  name: projectNameSchema,
  targetAmount: moneySchema,
  monthlyAllocation: moneySchema,
  deadlineDate: isoDateSchema,
})

/**
 * Body schema for PUT /api/finance/projects/[id]. Same shape as create —
 * a project edit is full-replace on the editable fields (name, target,
 * monthly, deadline). `amount_saved` and `pending_delay_fraction` are
 * never touched by the update RPC — they are mutated only by
 * `apply_recap_projects_snapshot` (sprint 10) and
 * `delete_savings_project_to_piggy`.
 */
export const updateProjectBodySchema = createProjectBodySchema

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>

/**
 * Calendar-month delta between `today` (00:00 local) and `deadline`. Returns
 * the floor of full months elapsed: a deadline 1 calendar year + 11 days
 * away returns 12 (the 11-day tail counts as a partial month and is dropped
 * since a partial month cannot host a full monthly allocation).
 *
 * Mirror the trigger semantics for `apply_recap_projects_snapshot`: monthly
 * allocations are credited at recap finalization, which happens once per
 * calendar month, so fractional months at the tail are not actionable.
 *
 * Exported for the form components (sprint 04+) to compute the suggested
 * duration when the user enters a target+monthly pair.
 */
export function monthsUntilDeadline(today: Date, deadline: Date): number {
  const years = deadline.getFullYear() - today.getFullYear()
  const months = deadline.getMonth() - today.getMonth()
  const days = deadline.getDate() - today.getDate()
  let total = years * 12 + months
  if (days < 0) total -= 1
  return total
}

/**
 * Client-side factory for AddProjectDialog + EditProjectDialog. Single refine :
 *
 * **Cohérence durée/target** — the project must be reachable :
 * `monthlyAllocation × monthsUntilDeadline ≥ targetAmount − amountSaved`.
 * Edit case must pass in `amountSaved` from the row so a partially-saved
 * project can still validate even when the remaining gap is small.
 *
 * Also implicitly enforces that `deadlineDate` is in the future (months ≤ 0
 * ⇒ left-hand side ≤ 0 ⇒ refine fails unless remaining ≤ 0, which only
 * happens when the project is already fully saved).
 *
 * Memoize the result via `useMemo` on the calling component so the resolver
 * identity stays stable across renders.
 */
export function makeProjectClientSchema(opts?: { amountSaved?: number }) {
  const { amountSaved = 0 } = opts ?? {}
  const base = z.object({
    name: projectNameSchema,
    targetAmount: moneyFormSchema,
    monthlyAllocation: moneyFormSchema,
    deadlineDate: isoDateSchema,
  })
  return base.refine(
    (d) => {
      const today = new Date()
      const deadline = new Date(d.deadlineDate)
      const months = monthsUntilDeadline(today, deadline)
      const remaining = d.targetAmount - amountSaved
      if (remaining <= 0) return true
      if (months <= 0) return false
      return d.monthlyAllocation * months >= remaining
    },
    {
      message:
        'Allocation mensuelle insuffisante pour atteindre l’objectif d’ici la date butoir. Augmentez le montant mensuel ou reportez l’échéance.',
      path: ['monthlyAllocation'],
    },
  )
}
