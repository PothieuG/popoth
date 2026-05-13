import { z } from 'zod'

/**
 * Signup form schema for app/inscription/page.tsx — used client-side via
 * react-hook-form + zodResolver (Sprint Zod-Rollout-Money-First PoC).
 *
 * Password min 6 mirrors the existing manual check. The refine on
 * password === confirmPassword surfaces the mismatch error on the
 * `confirmPassword` field (path: ['confirmPassword']) so the inline UI
 * shows the message under the right input.
 */
export const signupBodySchema = z
  .object({
    email: z.string().trim().email("Format d'email invalide"),
    password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères'),
    confirmPassword: z.string().min(1, 'Confirmation requise'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmPassword'],
  })

export type SignupBody = z.infer<typeof signupBodySchema>
