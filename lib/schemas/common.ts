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
 * Client-form variant of moneySchema. Uses z.coerce.number() so the input
 * accepts string|number (form fields type="text" with inputMode="decimal"
 * normalize comma→dot at onChange and let zodResolver coerce at submit).
 * Same finite + positive + 2-decimal contract as moneySchema.
 *
 * Used by client forms via the dual-type pattern :
 *   useForm<z.input<typeof schema>, undefined, z.output<typeof schema>>
 */
export const moneyFormSchema = z.coerce
  .number()
  .finite('Montant invalide')
  .positive('Le montant doit être positif')
  .refine((v) => Math.round(v * 100) === v * 100, {
    message: 'Au maximum 2 décimales',
  })

/**
 * Client-form variant of nonNegativeMoneySchema (z.coerce, allows 0). Same
 * comma→dot coercion contract as moneyFormSchema but accepts 0 — used for
 * optional "use piggy bank" amount fields where the toggle-off state is 0
 * (Sprint Exceptional-Expense-Piggy-Funding).
 */
export const nonNegativeMoneyFormSchema = z.coerce
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

/**
 * Query schema for /api/finance/summary GET. Accepts optional `context`
 * and `recalculate=true|false` (coerce string → boolean, defaults false).
 */
export const summaryQuerySchema = z.object({
  context: contextSchema.optional().default('profile'),
  recalculate: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})
export type SummaryQuery = z.infer<typeof summaryQuerySchema>

/**
 * Period enum for Sprint P1 (switch hebdo/quotidien). 'month' = no DB
 * date filter (preserves "since last recap" semantics), 'week' = ISO
 * 8601 Monday→Sunday range, 'day' = today only. Both bounds inclusive.
 */
export const periodSchema = z.enum(['month', 'week', 'day'])
export type PeriodQuery = z.infer<typeof periodSchema>

/**
 * Query schema for routes that filter by period in addition to context.
 * Used by expenses-progress GET (Sprint P1) to filter real_expenses by
 * expense_date. The 'period' param is optional, default 'month' = no
 * filter applied.
 */
export const progressQuerySchema = z.object({
  context: contextSchema.optional().default('profile'),
  period: periodSchema.optional().default('month'),
})
export type ProgressQuery = z.infer<typeof progressQuerySchema>
