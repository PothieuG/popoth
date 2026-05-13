import { z } from 'zod'

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
