import { z } from 'zod'

export const contextSchema = z.enum(['profile', 'group'])
export type Context = z.infer<typeof contextSchema>

export const uuidSchema = z.string().uuid()

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format ISO YYYY-MM-DD')

export const moneySchema = z
  .number()
  .finite('Montant invalide')
  .positive('Le montant doit être positif')
  .refine((v) => Math.round(v * 100) === v * 100, {
    message: 'Au maximum 2 décimales',
  })

export const nonNegativeMoneySchema = z
  .number()
  .finite('Montant invalide')
  .nonnegative('Le montant doit être positif ou nul')
  .refine((v) => Math.round(v * 100) === v * 100, {
    message: 'Au maximum 2 décimales',
  })

/**
 * Query schema for GET routes that accept only an optional `context` param
 * (profile|group). Defaults to 'profile' when absent. Used by ~10 GET
 * routes under finance, savings, monthly-recap, bank-balance.
 */
export const contextOnlyQuerySchema = z.object({
  context: contextSchema.optional().default('profile'),
})
export type ContextOnlyQuery = z.infer<typeof contextOnlyQuerySchema>

/**
 * Query schema for the 2 estimated-CRUD GET routes
 * (/api/finance/{budgets,income}/estimated). Accepts `?group=true|false`
 * (string), coerces to boolean. Defaults to false when absent.
 */
export const estimatedListQuerySchema = z.object({
  group: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})
export type EstimatedListQuery = z.infer<typeof estimatedListQuerySchema>

/**
 * Query schema for DELETE handlers using `?id=<uuid>`. Used by ~6 DELETE
 * routes (finance budgets/incomes/expenses/real-income real/estimated).
 */
export const deleteByIdQuerySchema = z.object({
  id: uuidSchema,
})
export type DeleteByIdQuery = z.infer<typeof deleteByIdQuerySchema>
