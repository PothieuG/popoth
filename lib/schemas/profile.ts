import { z } from 'zod'

/**
 * Profile salary range: 0 < salary <= 999999.99, at most 2 decimals.
 * Strict mirror of the existing manual check in app/api/profile/route.ts
 * (POST L107 + PUT L190).
 */
const salarySchema = z
  .number()
  .finite('Salaire invalide')
  .positive('Le salaire doit être strictement positif')
  .max(999999.99, 'Le salaire ne peut pas dépasser 999 999,99 €')
  .refine((v) => Math.round(v * 100) === v * 100, {
    message: 'Au maximum 2 décimales',
  })

const nameSchema = z.string().trim().min(1, 'Ne peut pas être vide')

export const createProfileBodySchema = z.object({
  first_name: nameSchema,
  last_name: nameSchema,
  salary: salarySchema.optional(),
  avatar_url: z.string().url('URL invalide').nullable().optional(),
})

/**
 * PUT uses partial-update semantics. At least one field must be defined —
 * the refine reproduces the existing route's "Aucune donnée à mettre à jour"
 * check (L204) at the schema level.
 */
export const updateProfileBodySchema = z
  .object({
    first_name: nameSchema.optional(),
    last_name: nameSchema.optional(),
    salary: salarySchema.optional(),
    avatar_url: z.string().url('URL invalide').nullable().optional(),
  })
  .refine(
    (data) =>
      data.first_name !== undefined ||
      data.last_name !== undefined ||
      data.salary !== undefined ||
      data.avatar_url !== undefined,
    { message: 'Aucune donnée à mettre à jour' },
  )

export type CreateProfileBody = z.infer<typeof createProfileBodySchema>
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>
