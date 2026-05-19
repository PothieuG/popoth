import { z } from 'zod'

const groupNameSchema = z
  .string()
  .trim()
  .min(2, 'Le nom du groupe doit contenir au moins 2 caractères')

/**
 * Query schema for /api/groups/search GET. `q` is a trimmed string (the
 * route falls back to empty-result if empty); `limit` is an int 1-50,
 * defaults to 20 (route then clamps via Math.min anyway, but the schema
 * enforces the upper bound upstream).
 */
export const searchGroupsQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
})
export type SearchGroupsQuery = z.infer<typeof searchGroupsQuerySchema>

/**
 * POST /api/groups body — create a new group.
 *
 * `monthly_budget_estimate` is intentionally NOT part of this schema since
 * Sprint Group-Budget-Auto-Sync (2026-05-19) : the column is now auto-synced
 * by the DB trigger `estimated_budgets_sync_group_budget` as
 * `SUM(estimated_budgets WHERE group_id = X)`. The group is created with
 * monthly_budget_estimate = 0 by DB default; the trigger updates it on the
 * 1st INSERT into estimated_budgets for this group.
 *
 * The route enforces "user not already in a group" + 23505 uniqueness on
 * name; both stay route-side post-Zod since they require runtime context.
 */
export const createGroupBodySchema = z.object({
  name: groupNameSchema,
})
export type CreateGroupBody = z.infer<typeof createGroupBodySchema>

/**
 * PUT /api/groups/[id] body — partial update of the group name.
 *
 * Like createGroupBodySchema, the budget field is gone (auto-synced from
 * estimated_budgets). Creator-only check stays in the handler (needs runtime
 * profile).
 */
export const updateGroupBodySchema = z.object({
  name: groupNameSchema,
})
export type UpdateGroupBody = z.infer<typeof updateGroupBodySchema>

/**
 * Client-form variant used by CreateGroupForm. Same shape as the body schema
 * post-Sprint Group-Budget-Auto-Sync — no monetary field to coerce.
 */
export const createGroupFormSchema = z.object({
  name: groupNameSchema,
})
export type CreateGroupForm = z.infer<typeof createGroupFormSchema>
