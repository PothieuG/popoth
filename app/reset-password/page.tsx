'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, type FieldErrors, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase-client'
import { resetPasswordFormSchema, type ResetPasswordForm } from '@/lib/schemas/auth'
import { logger } from '@/lib/logger'

export default function NouveauMotDePassePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
        </div>
      }
    >
      <NouveauMotDePasseContent />
    </Suspense>
  )
}

/**
 * Reset password content. The token validation state-machine
 * (validatingToken / isValidToken) runs in a useEffect on mount and is
 * preserved verbatim from the pre-v4 implementation. Only the form
 * submission branch was migrated to react-hook-form + zodResolver.
 *
 * Server-side Supabase errors (session_not_found / different-from-old /
 * generic password keyword / fallback) are mapped into `serverError`
 * (Pattern F) ; the same mapping is duplicated in the catch block to
 * cover the cases where the SDK throws instead of returning an error.
 */
function NouveauMotDePasseContent() {
  const router = useRouter()
  const [serverError, setServerError] = useState('')
  const [tokenError, setTokenError] = useState('')
  const [success, setSuccess] = useState(false)
  const [validatingToken, setValidatingToken] = useState(true)
  const [isValidToken, setIsValidToken] = useState(false)

  const form = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { password: '', confirmPassword: '' },
    mode: 'onSubmit',
  })

  /**
   * Validates the reset token from the URL parameters on component mount.
   * Checks if the user has a valid session from the email link.
   */
  useEffect(() => {
    const validateToken = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) {
          logger.error('Session validation error:', sessionError)
          setTokenError('Lien de réinitialisation invalide ou expiré')
          setValidatingToken(false)
          return
        }

        if (!session) {
          setTokenError(
            'Lien de réinitialisation invalide ou expiré. Veuillez demander un nouveau lien.',
          )
          setValidatingToken(false)
          return
        }

        // Token is valid
        setIsValidToken(true)
        setValidatingToken(false)
      } catch (error) {
        logger.error('Token validation error:', error)
        setTokenError('Erreur lors de la validation du lien. Veuillez réessayer.')
        setValidatingToken(false)
      }
    }

    validateToken()
  }, [])

  const onValidSubmit = async ({ password }: ResetPasswordForm) => {
    setServerError('')

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      })

      if (updateError) {
        // Handle specific update errors - prevent error from bubbling up
        if (updateError.message.includes('session_not_found')) {
          setServerError('Session expirée. Veuillez demander un nouveau lien de réinitialisation.')
        } else if (
          updateError.message.includes('New password should be different from the old password')
        ) {
          setServerError("Le nouveau mot de passe doit être différent de l'ancien mot de passe.")
        } else if (updateError.message.includes('password')) {
          setServerError('Le mot de passe ne respecte pas les critères de sécurité')
        } else {
          setServerError('Erreur lors de la mise à jour du mot de passe. Veuillez réessayer.')
        }
        return
      }

      // Success - show confirmation message
      setSuccess(true)
    } catch (error: unknown) {
      // Handle specific catch errors as well
      const message = error instanceof Error ? error.message : ''
      if (message.includes('New password should be different from the old password')) {
        setServerError("Le nouveau mot de passe doit être différent de l'ancien mot de passe.")
      } else if (message.includes('session_not_found')) {
        setServerError('Session expirée. Veuillez demander un nouveau lien de réinitialisation.')
      } else if (message.includes('password')) {
        setServerError('Le mot de passe ne respecte pas les critères de sécurité')
      } else {
        setServerError('Erreur lors de la mise à jour du mot de passe. Veuillez réessayer.')
      }
    }
  }

  const onInvalidSubmit = (errors: FieldErrors<ResetPasswordForm>) => {
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<ResetPasswordForm>)
    }
  }

  const handleGoToLogin = () => {
    router.push('/connexion')
  }

  const handleRequestNewLink = () => {
    router.push('/forgot-password')
  }

  // Loading state while validating token
  if (validatingToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-3 text-center">
            <h1 className="bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-4xl font-bold text-transparent">
              Validation en cours...
            </h1>
            <div className="flex justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Invalid token state
  if (!isValidToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-8">
          {/* Header */}
          <div className="space-y-3 text-center">
            <h1 className="bg-linear-to-r from-red-600 to-orange-600 bg-clip-text text-4xl font-bold text-transparent">
              Lien invalide
            </h1>
          </div>

          {/* Error Message */}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
            <div className="space-y-6 text-center">
              {/* Error Icon */}
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                <svg
                  className="h-8 w-8 text-red-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                  ></path>
                </svg>
              </div>

              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  Lien de réinitialisation invalide
                </h2>
                <p className="text-gray-600">{tokenError}</p>
              </div>

              {/* Request New Link Button */}
              <Button
                onClick={handleRequestNewLink}
                className="h-12 w-full rounded-lg bg-linear-to-r from-blue-600 to-purple-600 text-lg font-semibold text-white shadow-lg transition-all duration-300 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl"
              >
                Demander un nouveau lien
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Success state
  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-8">
          {/* Header */}
          <div className="space-y-3 text-center">
            <h1 className="bg-linear-to-r from-green-600 to-blue-600 bg-clip-text text-4xl font-bold text-transparent">
              Mot de passe mis à jour !
            </h1>
          </div>

          {/* Success Message */}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
            <div className="space-y-6 text-center">
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

              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  Mot de passe mis à jour avec succès
                </h2>
                <p className="text-gray-600">
                  Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
                </p>
              </div>

              {/* Go to Login Button */}
              <Button
                onClick={handleGoToLogin}
                className="h-12 w-full rounded-lg bg-linear-to-r from-blue-600 to-purple-600 text-lg font-semibold text-white shadow-lg transition-all duration-300 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl"
              >
                Se connecter
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const fieldErrors = form.formState.errors
  const isSubmitting = form.formState.isSubmitting

  // Main form state
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="space-y-3 text-center">
          <h1 className="bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-4xl font-bold text-transparent">
            Nouveau mot de passe
          </h1>
          <p className="text-lg text-gray-600">Choisissez un nouveau mot de passe sécurisé</p>
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          <form
            onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
            className="space-y-6"
            noValidate
          >
            {/* Password Field */}
            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-semibold text-gray-700">
                Nouveau mot de passe
              </label>
              <Input
                id="password"
                type="password"
                {...form.register('password')}
                placeholder="Votre nouveau mot de passe"
                disabled={isSubmitting}
                autoComplete="new-password"
                aria-invalid={fieldErrors.password ? 'true' : 'false'}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                className="h-12 rounded-lg border-2 border-gray-300 text-gray-900 transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
              {fieldErrors.password && (
                <p id="password-error" className="text-sm font-medium text-red-600">
                  {fieldErrors.password.message}
                </p>
              )}
            </div>

            {/* Confirm Password Field */}
            <div className="space-y-2">
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-semibold text-gray-700"
              >
                Confirmer le mot de passe
              </label>
              <Input
                id="confirmPassword"
                type="password"
                {...form.register('confirmPassword')}
                placeholder="Confirmez votre nouveau mot de passe"
                disabled={isSubmitting}
                autoComplete="new-password"
                aria-invalid={fieldErrors.confirmPassword ? 'true' : 'false'}
                aria-describedby={fieldErrors.confirmPassword ? 'confirmPassword-error' : undefined}
                className="h-12 rounded-lg border-2 border-gray-300 text-gray-900 transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
              {fieldErrors.confirmPassword && (
                <p id="confirmPassword-error" className="text-sm font-medium text-red-600">
                  {fieldErrors.confirmPassword.message}
                </p>
              )}
            </div>

            {/* Password Requirements */}
            <div className="rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4">
              <div className="text-sm text-blue-800">
                <p className="mb-2 font-medium">Critères du mot de passe :</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>Au moins 6 caractères</li>
                  <li>Évitez les mots de passe trop simples</li>
                </ul>
              </div>
            </div>

            {/* Server Error Display */}
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
                  <div className="ml-3">
                    <p className="font-medium text-red-800">{serverError}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Update Button */}
            <Button
              type="submit"
              className="h-12 w-full rounded-lg bg-linear-to-r from-blue-600 to-purple-600 text-lg font-semibold text-white shadow-lg transition-all duration-300 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Mise à jour en cours...' : 'Mettre à jour le mot de passe'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
