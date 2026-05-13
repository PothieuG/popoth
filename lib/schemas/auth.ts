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

/**
 * Login form schema — carved from signupBodySchema minus confirmPassword +
 * refine. Used by app/connexion/page.tsx (client-side login form) and
 * server-side via the `login` branch of sessionActionBodySchema.
 *
 * Email + password validation mirror the existing manual checks in
 * app/api/auth/session/route.ts L17-22 (`if (!email || !password)` becomes
 * structural; format checks are added on top).
 */
export const loginFormSchema = z.object({
  email: z.string().trim().email("Format d'email invalide"),
  password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères'),
})
export type LoginFormBody = z.infer<typeof loginFormSchema>

/**
 * POST /api/auth/session body — discriminated union on `action` literal
 * (login | refresh | logout). `login` requires email + password; the
 * other two have no extra fields. TS narrows downstream.
 *
 * Note: the route response uses `{ success, error }` shape (not the v1
 * `{ error, issues }` convention). handleBadRequest is intercepted inline
 * in the route's catch to preserve the shape (cf. Risk #1 in the plan).
 */
export const sessionActionBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('login'),
    email: z.string().trim().email("Format d'email invalide"),
    password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères'),
  }),
  z.object({ action: z.literal('refresh') }),
  z.object({ action: z.literal('logout') }),
])
export type SessionActionBody = z.infer<typeof sessionActionBodySchema>

/**
 * Forgot password form schema — used client-side by app/forgot-password/page.tsx
 * via react-hook-form + zodResolver (Sprint Zod-Rollout v4). Single email field
 * matching the previous manual check `!email.includes('@') || !email.includes('.')`.
 */
export const forgotPasswordFormSchema = z.object({
  email: z.string().trim().email("Format d'email invalide"),
})
export type ForgotPasswordForm = z.infer<typeof forgotPasswordFormSchema>

/**
 * Reset password form schema — used client-side by app/reset-password/page.tsx
 * via react-hook-form + zodResolver (Sprint Zod-Rollout v4). Mirrors the password
 * + confirmPassword pair from signupBodySchema (min 6 + refine match on confirm
 * field path) but without email (the user is already authenticated via the email
 * link token, validated separately in a useEffect state-machine).
 */
export const resetPasswordFormSchema = z
  .object({
    password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères'),
    confirmPassword: z.string().min(1, 'Confirmation requise'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmPassword'],
  })
export type ResetPasswordForm = z.infer<typeof resetPasswordFormSchema>
