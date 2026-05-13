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
