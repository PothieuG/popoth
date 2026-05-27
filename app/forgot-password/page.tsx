'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase-client'
import { forgotPasswordFormSchema, type ForgotPasswordForm } from '@/lib/schemas/auth'
import { logger } from '@/lib/logger'
import { getSiteUrl } from '@/lib/site-url'

/**
 * Forgot password page allowing users to request a password reset email.
 *
 * Uses react-hook-form + zodResolver(forgotPasswordFormSchema). Per-field
 * email errors appear inline ; server-side Supabase errors (rate limit,
 * network) surface via a separate `serverError` state (Pattern F).
 */
export default function MotDePasseOubliePage() {
  const router = useRouter()
  const [serverError, setServerError] = useState('')
  const [success, setSuccess] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState('')

  const form = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: { email: '' },
    mode: 'onSubmit',
  })

  const onValidSubmit = async ({ email }: ForgotPasswordForm) => {
    setServerError('')

    try {
      // `redirectTo` resolves to `{{ .RedirectTo }}` in the Supabase email
      // template (configured in Dashboard → Authentication → Email Templates
      // → Reset Password). The custom template appends `token_hash`, `type`,
      // and `next` so the link points to our click-to-confirm gate at
      // `/auth/confirm`, NOT to Supabase's legacy `/auth/v1/verify` endpoint.
      // That gate calls `verifyOtp()` only on explicit user click —
      // neutralising email scanners (Outlook Safe Links, Gmail previewers,
      // antivirus) that pre-fetch links and would otherwise consume the
      // single-use OTP before the user opens it.
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${getSiteUrl()}/auth/confirm`,
      })

      if (resetError) {
        if (resetError.message.includes('rate limit')) {
          setServerError('Trop de demandes. Veuillez patienter avant de réessayer.')
        } else {
          setServerError("Erreur lors de l'envoi de l'email. Veuillez réessayer.")
        }
        logger.error('Password reset error:', resetError)
        return
      }

      // Success - show confirmation message
      // Note: Supabase always succeeds for security reasons, even if email doesn't exist
      setSubmittedEmail(email)
      setSuccess(true)
    } catch (error) {
      setServerError("Erreur lors de l'envoi de l'email. Veuillez réessayer.")
      logger.error('Password reset error:', error)
    }
  }

  const onInvalidSubmit = (errors: FieldErrors<ForgotPasswordForm>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<ForgotPasswordForm>)
    }
  }

  const handleBackToLogin = () => {
    router.push('/connexion')
  }

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

  if (success) {
    return (
      <div className="pt-safe pb-safe flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-6">
          {/* Header */}
          <div className="space-y-2 text-center">
            <h1 className="bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-4xl font-bold text-transparent">
              Email envoyé !
            </h1>
            <p className="text-lg text-gray-600">Vérifiez votre boîte de réception</p>
          </div>

          {/* Success Message */}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
            <div className="space-y-4 text-center">
              {/* Success Icon */}
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <svg
                  className="h-8 w-8 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  ></path>
                </svg>
              </div>

              <div className="space-y-3">
                <h2 className="text-xl font-semibold text-gray-900">Demande traitée</h2>
                <p className="text-gray-600">
                  Si un compte existe avec l&apos;adresse <strong>{submittedEmail}</strong>, vous
                  recevrez un lien de réinitialisation.
                </p>
                <div className="space-y-1.5 text-sm text-gray-500">
                  <p>• Vérifiez votre boîte de réception et votre dossier spam</p>
                  <p>• Le lien expire après 1 heure</p>
                  <p>• Si vous ne recevez rien, vérifiez que l&apos;adresse est correcte</p>
                </div>
              </div>

              {/* Back to Login Button */}
              <Button
                onClick={handleBackToLogin}
                className="h-12 w-full rounded-lg bg-linear-to-r from-blue-600 to-purple-600 text-lg font-semibold text-white shadow-lg transition-all duration-300 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl"
              >
                Retour à la connexion
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-safe pb-safe flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="space-y-2 text-center">
          <h1 className="bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-4xl font-bold text-transparent">
            Mot de passe oublié
          </h1>
          <p className="text-lg text-gray-600">
            Entrez votre email pour recevoir un lien de réinitialisation
          </p>
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          <form
            onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
            className="space-y-4"
            noValidate
          >
            {/* Email Field */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-semibold text-gray-700">
                Adresse email
              </label>
              <Input
                id="email"
                type="email"
                {...form.register('email')}
                placeholder="votre@email.com"
                disabled={isSubmitting}
                autoComplete="email"
                aria-invalid={fieldErrors.email ? 'true' : 'false'}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                className="h-12 rounded-lg border-2 border-gray-300 text-gray-900 transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
              {fieldErrors.email && (
                <p id="email-error" className="text-sm font-medium text-red-600">
                  {fieldErrors.email.message}
                </p>
              )}
            </div>

            {/* Server-side Error Display */}
            {serverError && (
              <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 p-4">
                <div className="flex items-center">
                  <div className="shrink-0">
                    <svg className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-2">
                    <p className="font-medium text-red-800">{serverError}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="h-12 w-full rounded-lg bg-linear-to-r from-blue-600 to-purple-600 text-lg font-semibold text-white shadow-lg transition-all duration-300 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Envoi en cours...' : 'Envoyer le lien de réinitialisation'}
            </Button>
          </form>

          {/* Back to Login Link */}
          <div className="mt-6 text-center">
            <button
              onClick={handleBackToLogin}
              className="text-sm font-medium text-blue-600 transition-colors hover:text-blue-800"
            >
              Retour à la connexion
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
