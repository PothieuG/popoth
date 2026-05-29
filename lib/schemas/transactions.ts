import { z } from 'zod'
import { isoDateSchema, moneyFormSchema, nonNegativeMoneyFormSchema, uuidSchema } from './common'

const transactionDescriptionSchema = z.string().trim().min(1, 'La description est requise')

/**
 * Client-form discriminated union for AddTransactionModal +
 * EditTransactionModal. Branches on `transactionType` ('expense' | 'income'),
 * each with its own date field name (`expense_date` vs `entry_date`) and
 * optional FK column (`estimated_budget_id` vs `estimated_income_id`).
 *
 * The .refine on each branch enforces the XOR contract:
 *   is_exceptional=true  ⇒ estimated_*_id must be null
 *   is_exceptional=false ⇒ estimated_*_id must be a UUID
 *
 * Decimal `amount` via moneyFormSchema (coerced). Use the dual-type pattern
 * with z.input/z.output in the consumer's useForm generics.
 *
 * In EditTransactionModal, `transactionType` is fixed at mount (prop) and
 * the FK dropdown is rendered read-only — the refine is trivially
 * satisfied because the original transaction already met it. In
 * AddTransactionModal, transactionType is mutable via radio buttons —
 * call form.reset({ transactionType: ..., ... }) on switch.
 */
const expenseBranch = z
  .object({
    transactionType: z.literal('expense'),
    description: transactionDescriptionSchema,
    amount: moneyFormSchema,
    expense_date: isoDateSchema,
    is_exceptional: z.boolean(),
    estimated_budget_id: uuidSchema.nullable(),
    /**
     * Sprint Exceptional-Expense-Piggy-Funding — montant prélevé dans la
     * tirelire pour financer une dépense exceptionnelle. 0 (ou absent) =
     * pas de tirelire. Plafonné à `min(solde tirelire, amount)` côté UI ;
     * le refine ci-dessous garantit ≤ amount.
     */
    amount_from_piggy_bank: nonNegativeMoneyFormSchema.optional(),
  })
  .refine(
    (d) => (d.is_exceptional ? d.estimated_budget_id === null : d.estimated_budget_id !== null),
    {
      message: 'Sélectionnez un budget ou cochez "Dépense exceptionnelle"',
      path: ['estimated_budget_id'],
    },
  )
  .refine((d) => (d.amount_from_piggy_bank ?? 0) <= d.amount, {
    message: 'La part tirelire ne peut pas dépasser le montant',
    path: ['amount_from_piggy_bank'],
  })

const incomeBranch = z
  .object({
    transactionType: z.literal('income'),
    description: transactionDescriptionSchema,
    amount: moneyFormSchema,
    entry_date: isoDateSchema,
    is_exceptional: z.boolean(),
    estimated_income_id: uuidSchema.nullable(),
  })
  .refine(
    (d) => (d.is_exceptional ? d.estimated_income_id === null : d.estimated_income_id !== null),
    {
      message: 'Sélectionnez un revenu ou cochez "Revenu exceptionnel"',
      path: ['estimated_income_id'],
    },
  )

export const editTransactionFormSchema = z.discriminatedUnion('transactionType', [
  expenseBranch,
  incomeBranch,
])
export type EditTransactionFormInput = z.input<typeof editTransactionFormSchema>
export type EditTransactionFormOutput = z.output<typeof editTransactionFormSchema>

/**
 * AddTransactionModal reuses the same shape. The schema is identical but
 * the consumer pattern differs : in Add, `transactionType` switches at
 * runtime (radio buttons) and form.reset() swaps the branch ; in Edit,
 * it's fixed at mount.
 */
export const addTransactionFormSchema = editTransactionFormSchema
export type AddTransactionFormInput = EditTransactionFormInput
export type AddTransactionFormOutput = EditTransactionFormOutput
