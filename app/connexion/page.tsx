'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLogin, useRequireGuest } from '@/hooks/useAuth'
import { loginFormSchema, type LoginFormBody } from '@/lib/schemas/auth'

/**
 * Login page allowing users to authenticate with email and password
 * Uses modern token management system with secure session cookies
 * Features clean cardless design with colorful shadcn/ui component variants and Roboto font
 *
 * Uses react-hook-form + zodResolver(loginFormSchema). Per-field errors
 * appear inline under each input ; server-side auth errors (Supabase /
 * useLogin hook) flow through the existing `error` exposed by useLogin
 * — kept independent of `form.formState.errors`. The hook clears the
 * error on each handleLogin() call (matches original UX).
 */
export default function ConnexionPage() {
  const { handleLogin, isSubmitting, error } = useLogin()

  // Ensure only guests can access this page
  useRequireGuest()

  const form = useForm<LoginFormBody>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
  })

  const onValidSubmit = async ({ email, password }: LoginFormBody) => {
    await handleLogin(email, password)
  }

  const fieldErrors = form.formState.errors

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="space-y-3 text-center">
          <h1 className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-4xl font-bold text-transparent">
            Popoth
          </h1>
          <p className="text-lg text-gray-600">Connectez-vous à votre compte</p>
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
                aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                className="h-12 rounded-lg border-2 border-gray-300 text-gray-900 transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
              {fieldErrors.email && (
                <p id="login-email-error" className="text-sm font-medium text-red-600">
                  {fieldErrors.email.message}
                </p>
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
                autoComplete="current-password"
                aria-invalid={fieldErrors.password ? 'true' : 'false'}
                aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                className="h-12 rounded-lg border-2 border-gray-300 text-gray-900 transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              />
              {fieldErrors.password && (
                <p id="login-password-error" className="text-sm font-medium text-red-600">
                  {fieldErrors.password.message}
                </p>
              )}
            </div>

            {/* Server-side Error Display (from useLogin hook) */}
            {error && (
              <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 p-4">
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
                    <p className="font-medium text-red-800">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Login Button */}
            <Button
              type="submit"
              className="h-12 w-full rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 text-lg font-semibold text-white shadow-lg transition-all duration-300 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Connexion en cours...' : 'Se connecter'}
            </Button>
          </form>

          {/* Additional Links */}
          <div className="mt-8 space-y-4">
            <div className="text-center">
              <button
                onClick={() => (window.location.href = '/forgot-password')}
                className="text-sm font-medium text-blue-600 transition-colors hover:text-blue-800"
              >
                Mot de passe oublié ?
              </button>
            </div>

            <div className="text-center text-sm text-gray-600">
              Pas encore de compte ?{' '}
              <button
                onClick={() => (window.location.href = '/inscription')}
                className="font-semibold text-purple-600 transition-colors hover:text-purple-800"
              >
                Créer un compte
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
