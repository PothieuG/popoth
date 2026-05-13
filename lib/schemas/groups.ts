import { z } from 'zod'
import { moneyFormSchema, moneySchema } from './common'

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
 * POST /api/groups body — create a new group. The route enforces "user not
 * already in a group" + 23505 uniqueness on name; both stay route-side
 * post-Zod since they require runtime context.
 */
export const createGroupBodySchema = z.object({
  name: groupNameSchema,
  monthly_budget_estimate: moneySchema,
})
export type CreateGroupBody = z.infer<typeof createGroupBodySchema>

/**
 * PUT /api/groups/[id] body — partial update (name and/or monthly_budget_estimate).
 * Refine at-least-one ensures the route doesn't bail with empty `updateData`.
 * Creator-only check stays in the handler (needs runtime profile).
 */
export const updateGroupBodySchema = z
  .object({
    name: groupNameSchema.optional(),
    monthly_budget_estimate: moneySchema.optional(),
  })
  .refine((d) => d.name !== undefined || d.monthly_budget_estimate !== undefined, {
    message: 'Aucune donnée à mettre à jour',
  })
export type UpdateGroupBody = z.infer<typeof updateGroupBodySchema>

/**
 * Client-form variant used by CreateGroupForm. Coerces
 * monthly_budget_estimate from string|number at submit.
 */
export const createGroupFormSchema = z.object({
  name: groupNameSchema,
  monthly_budget_estimate: moneyFormSchema,
})
export type CreateGroupForm = z.infer<typeof createGroupFormSchema>
