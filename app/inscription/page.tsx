'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase-client'
import { signupBodySchema, type SignupBody } from '@/lib/schemas/auth'
import { logger } from '@/lib/logger'

/**
 * Registration page allowing users to create a new account with email and password
 * Features clean cardless design with colorful shadcn/ui component variants and Roboto font
 *
 * Uses react-hook-form + zodResolver(signupBodySchema). The refine on
 * password match places the error under the confirmPassword field via
 * `path: ['confirmPassword']`. Server-side Supabase errors (already
 * registered, weak password, signup disabled, etc.) surface via a
 * separate `serverError` state — they fire after schema validation.
 */
export default function InscriptionPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState('')
  const [success, setSuccess] = useState(false)

  const form = useForm<SignupBody>({
    resolver: zodResolver(signupBodySchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
    mode: 'onSubmit',
  })

  const onValidSubmit = async ({ email, password }: SignupBody) => {
    setServerError('')
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/connexion`,
        },
      })

      if (signUpError) {
        const errorMessage = signUpError.message.toLowerCase()

        if (
          errorMessage.includes('already registered') ||
          errorMessage.includes('user already registered') ||
          errorMessage.includes('email already exists')
        ) {
          setServerError('Cette adresse email est déjà utilisée. Essayez de vous connecter.')
        } else if (
          errorMessage.includes('weak password') ||
          (errorMessage.includes('password') && errorMessage.includes('weak'))
        ) {
          setServerError(
            'Le mot de passe est trop faible. Utilisez au moins 6 caractères avec des lettres et chiffres.',
          )
        } else if (
          errorMessage.includes('invalid email') ||
          (errorMessage.includes('email') && errorMessage.includes('invalid'))
        ) {
          setServerError("Format d'email invalide")
        } else if (errorMessage.includes('signup disabled')) {
          setServerError('Les inscriptions sont temporairement désactivées')
        } else {
          setServerError('Erreur lors de la création du compte. Veuillez réessayer.')
        }

        logger.error('Signup error:', signUpError.message)
        return
      }

      if (data.user) {
        setSuccess(true)
        setTimeout(() => {
          router.push('/connexion')
        }, 3000)
      }
    } catch (error) {
      setServerError('Erreur de connexion. Veuillez réessayer.')
      logger.error('Signup error:', error)
    }
  }

  const goToLogin = () => {
    router.push('/connexion')
  }

  const isSubmitting = form.formState.isSubmitting

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-4 text-center">
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
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-3xl font-bold text-transparent">
              Compte créé !
            </h1>
            <p className="text-lg text-gray-600">
              Un email de confirmation a été envoyé à votre adresse.
            </p>
            <p className="text-sm text-gray-500">Redirection vers la connexion...</p>
          </div>
        </div>
      </div>
    )
  }

  const fieldErrors = form.formState.errors

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="space-y-3 text-center">
          <h1 className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-4xl font-bold text-transparent">
            Inscription
          </h1>
          <p className="text-lg text-gray-600">Créez votre compte</p>
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          <form onSubmit={form.handleSubmit(onValidSubmit)} className="space-y-6" noValidate>
            {/* Email Field */}
            <div className="space-y-2">
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
                className="h-12 rounded-lg border-2 border-gray-300 text-gray-900 transition-all focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
              />
              {fieldErrors.email && (
                <p className="text-sm font-medium text-red-600">{fieldErrors.email.message}</p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <label htmlFor="motdepasse" className="block text-sm font-semibold text-gray-700">
                Mot de passe
              </label>
              <Input
                id="motdepasse"
                type="password"
                {...form.register('password')}
                placeholder="Votre mot de passe"
                disabled={isSubmitting}
                autoComplete="new-password"
                aria-invalid={fieldErrors.password ? 'true' : 'false'}
                className="h-12 rounded-lg border-2 border-gray-300 text-gray-900 transition-all focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
              />
              {fieldErrors.password && (
                <p className="text-sm font-medium text-red-600">{fieldErrors.password.message}</p>
              )}
            </div>

            {/* Confirm Password Field */}
            <div className="space-y-2">
              <label
                htmlFor="confirmmotdepasse"
                className="block text-sm font-semibold text-gray-700"
              >
                Confirmer le mot de passe
              </label>
              <Input
                id="confirmmotdepasse"
                type="password"
                {...form.register('confirmPassword')}
                placeholder="Confirmez votre mot de passe"
                disabled={isSubmitting}
                autoComplete="new-password"
                aria-invalid={fieldErrors.confirmPassword ? 'true' : 'false'}
                className="h-12 rounded-lg border-2 border-gray-300 text-gray-900 transition-all focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
              />
              {fieldErrors.confirmPassword && (
                <p className="text-sm font-medium text-red-600">
                  {fieldErrors.confirmPassword.message}
                </p>
              )}
            </div>

            {/* Server Error Display */}
            {serverError && (
              <div className="rounded-lg border-l-4 border-red-500 bg-red-50 p-4">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
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

            {/* Register Button */}
            <Button
              type="submit"
              className="h-12 w-full rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-lg font-semibold text-white shadow-lg transition-all duration-300 hover:from-purple-700 hover:to-blue-700 hover:shadow-xl"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Création en cours...' : 'Créer mon compte'}
            </Button>
          </form>

          {/* Additional Links */}
          <div className="mt-8 space-y-4">
            <div className="text-center text-sm text-gray-600">
              Déjà un compte ?{' '}
              <button
                onClick={goToLogin}
                className="font-semibold text-purple-600 transition-colors hover:text-purple-800"
              >
                Se connecter
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
