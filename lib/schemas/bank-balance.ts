import { z } from 'zod'

/**
 * Bank balance can be negative (legitimate overdraft scenario). The schema
 * requires a finite number with at most 2 decimal places, but does NOT
 * enforce non-negativity. Mirrors the existing manual check
 * `typeof balance !== 'number' || isNaN(balance)` but stricter (rejects
 * Infinity and >2 decimal precision too).
 */
export const updateBankBalanceBodySchema = z.object({
  balance: z
    .number()
    .finite('Le solde doit être un nombre fini')
    .refine((v) => Math.round(v * 100) === v * 100, {
      message: 'Au maximum 2 décimales',
    }),
})

export type UpdateBankBalanceBody = z.infer<typeof updateBankBalanceBodySchema>
