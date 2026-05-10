'use client'

import { useAuthUser, useAuthActions } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { logger } from '@/lib/logger'

/**
 * Guards guest-only pages. Subscribes only to AuthUserContext.
 */
export function useRequireGuest() {
  const { loading, isLoggedIn } = useAuthUser()
  const router = useRouter()

  useEffect(() => {
    if (!loading && isLoggedIn) {
      router.push('/dashboard')
    }
  }, [loading, isLoggedIn, router])

  return { loading, isLoggedIn }
}

/**
 * Login form helper. Subscribes to AuthUserContext for `error` and
 * AuthActionsContext for `login` / `clearError`. Inlines the post-login
 * redirect (no shared dependency on the aggregator).
 */
export function useLogin() {
  const { error } = useAuthUser()
  const { login, clearError } = useAuthActions()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleLogin = async (email: string, password: string) => {
    setIsSubmitting(true)
    clearError()

    try {
      const result = await login(email, password)

      if (result.success) {
        const urlParams = new URLSearchParams(window.location.search)
        const returnPath = urlParams.get('from')
        const destination = returnPath || '/dashboard'
        router.push(destination)
      }

      return result
    } catch (err) {
      logger.error('Login error:', err)
      return { success: false, error: 'Erreur de connexion inattendue' }
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    handleLogin,
    isSubmitting,
    error,
    clearError,
  }
}

/**
 * Logout-and-redirect helper for single-concern consumers (footer logout
 * buttons, settings page). Subscribes only to AuthActionsContext — pages
 * that just need to log out no longer re-render on user-state changes.
 */
export function useLogoutAndRedirect() {
  const { logout } = useAuthActions()
  const router = useRouter()

  const logoutAndRedirect = async () => {
    await logout()
    router.push('/connexion')
  }

  return { logoutAndRedirect }
}
