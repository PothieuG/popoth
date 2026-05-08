'use client'

import { useAuth as useAuthContext, useAuthUser, useAuthActions } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Backwards-compatible aggregator hook. Subscribes to BOTH AuthUserContext
 * and AuthActionsContext via useAuthContext(), and adds router-based
 * utilities. Prefer the granular hooks below for new code so consumers only
 * re-render on the slice they actually read.
 */
export function useAuth() {
  const authContext = useAuthContext()
  const router = useRouter()
  const [sessionExpiring, setSessionExpiring] = useState(false)

  const redirectToLogin = (returnPath?: string) => {
    const loginUrl = returnPath
      ? `/connexion?from=${encodeURIComponent(returnPath)}`
      : '/connexion'
    router.push(loginUrl)
  }

  const redirectAfterLogin = () => {
    const urlParams = new URLSearchParams(window.location.search)
    const returnPath = urlParams.get('from')
    const destination = returnPath || '/dashboard'
    router.push(destination)
  }

  const logoutAndRedirect = async () => {
    await authContext.logout()
    router.push('/connexion')
  }

  const checkSessionExpiry = () => {
    setSessionExpiring(authContext.loading)
  }

  const requireAuth = () => {
    if (!authContext.loading && !authContext.isLoggedIn) {
      redirectToLogin(window.location.pathname)
      return false
    }
    return true
  }

  const requireGuest = () => {
    if (!authContext.loading && authContext.isLoggedIn) {
      router.push('/dashboard')
      return false
    }
    return true
  }

  useEffect(() => {
    if (authContext.isLoggedIn) {
      const interval = setInterval(checkSessionExpiry, 60000)
      return () => clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkSessionExpiry is recreated each render; effect only needs to react to login state
  }, [authContext.isLoggedIn])

  return {
    ...authContext,
    redirectToLogin,
    redirectAfterLogin,
    logoutAndRedirect,
    requireAuth,
    requireGuest,
    sessionExpiring,
    isGuest: !authContext.isLoggedIn,
    hasUser: authContext.user !== null,
    userEmail: authContext.user?.email || null,
    userId: authContext.user?.id || null,
  }
}

/**
 * Guards authenticated pages. Subscribes only to AuthUserContext —
 * does NOT re-render when actions change.
 */
export function useRequireAuth() {
  const { loading, isLoggedIn } = useAuthUser()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !isLoggedIn) {
      const returnPath = window.location.pathname
      const loginUrl = `/connexion?from=${encodeURIComponent(returnPath)}`
      router.push(loginUrl)
    }
  }, [loading, isLoggedIn, router])

  return { loading, isLoggedIn }
}

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
      console.error('Login error:', err)
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
 * Registration form helper. Subscribes to AuthUserContext for `error`
 * and AuthActionsContext for `register` / `clearError`.
 */
export function useRegister() {
  const { error } = useAuthUser()
  const { register, clearError } = useAuthActions()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleRegister = async (email: string, password: string) => {
    setIsSubmitting(true)
    clearError()

    try {
      const result = await register(email, password)
      return result
    } catch (err) {
      console.error('Registration error:', err)
      return { success: false, error: 'Erreur de création de compte inattendue' }
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    handleRegister,
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
