'use client'

import { useAuth as useAuthContext } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Custom hook that provides authentication functionality and utilities
 * Extends the AuthContext with additional convenience methods and router integration
 */
export function useAuth() {
  const authContext = useAuthContext()
  const router = useRouter()
  const [sessionExpiring, setSessionExpiring] = useState(false)

  /**
   * Redirects user to login page with optional return path
   * Preserves the current path for post-login redirection
   */
  const redirectToLogin = (returnPath?: string) => {
    const loginUrl = returnPath 
      ? `/connexion?from=${encodeURIComponent(returnPath)}`
      : '/connexion'
    router.push(loginUrl)
  }

  /**
   * Redirects user to a specific path after successful authentication
   * Uses the 'from' query parameter if available, otherwise defaults to dashboard
   */
  const redirectAfterLogin = () => {
    const urlParams = new URLSearchParams(window.location.search)
    const returnPath = urlParams.get('from')
    const destination = returnPath || '/dashboard'
    router.push(destination)
  }

  /**
   * Logs out user and redirects to login page
   * Clears all authentication state and session data
   */
  const logoutAndRedirect = async () => {
    await authContext.logout()
    router.push('/connexion')
  }

  /**
   * Checks if the current user session is about to expire
   * Shows warning to user before automatic logout
   */
  const checkSessionExpiry = () => {
    // This would typically check the session timestamp
    // and warn user if session is expiring in next few minutes
    const warningThreshold = 5 * 60 * 1000 // 5 minutes before expiry
    
    // Implementation would check session.expiresAt - Date.now() < warningThreshold
    // For now, we'll use the loading state as a proxy
    setSessionExpiring(authContext.loading)
  }

  /**
   * Requires user to be authenticated
   * Redirects to login if not authenticated
   */
  const requireAuth = () => {
    if (!authContext.loading && !authContext.isLoggedIn) {
      redirectToLogin(window.location.pathname)
      return false
    }
    return true
  }

  /**
   * Requires user to be a guest (not authenticated)
   * Redirects to dashboard if already authenticated
   */
  const requireGuest = () => {
    if (!authContext.loading && authContext.isLoggedIn) {
      router.push('/dashboard')
      return false
    }
    return true
  }

  // Monitor session expiry
  useEffect(() => {
    if (authContext.isLoggedIn) {
      const interval = setInterval(checkSessionExpiry, 60000) // Check every minute
      return () => clearInterval(interval)
    }
  }, [authContext.isLoggedIn])

  // Return extended auth object with additional utilities
  return {
    // Core auth state and methods from context
    ...authContext,
    
    // Additional utility methods
    redirectToLogin,
    redirectAfterLogin,
    logoutAndRedirect,
    requireAuth,
    requireGuest,
    sessionExpiring,
    
    // Convenience properties
    isGuest: !authContext.isLoggedIn,
    hasUser: authContext.user !== null,
    userEmail: authContext.user?.email || null,
    userId: authContext.user?.id || null,
  }
}

/**
 * Hook for components that require authentication
 * Automatically redirects to login if user is not authenticated
 */
export function useRequireAuth() {
  const auth = useAuth()
  
  useEffect(() => {
    auth.requireAuth()
  }, [auth.loading, auth.isLoggedIn])
  
  return auth
}

/**
 * Hook for components that require guest access (auth pages)
 * Automatically redirects to dashboard if user is already authenticated
 */
export function useRequireGuest() {
  const auth = useAuth()
  
  useEffect(() => {
    auth.requireGuest()
  }, [auth.loading, auth.isLoggedIn])
  
  return auth
}

/**
 * Hook that provides login functionality with form handling
 * Includes loading states and error handling for login forms
 */
export function useLogin() {
  const auth = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const handleLogin = async (email: string, password: string) => {
    setIsSubmitting(true)
    auth.clearError()
    
    try {
      const result = await auth.login(email, password)
      
      if (result.success) {
        auth.redirectAfterLogin()
      }
      
      return result
    } catch (error) {
      console.error('Login error:', error)
      return { success: false, error: 'Erreur de connexion inattendue' }
    } finally {
      setIsSubmitting(false)
    }
  }
  
  return {
    handleLogin,
    isSubmitting,
    error: auth.error,
    clearError: auth.clearError,
  }
}

/**
 * Hook that provides registration functionality with form handling
 * Includes loading states and error handling for registration forms
 */
export function useRegister() {
  const auth = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const handleRegister = async (email: string, password: string) => {
    setIsSubmitting(true)
    auth.clearError()
    
    try {
      const result = await auth.register(email, password)
      return result
    } catch (error) {
      console.error('Registration error:', error)
      return { success: false, error: 'Erreur de création de compte inattendue' }
    } finally {
      setIsSubmitting(false)
    }
  }
  
  return {
    handleRegister,
    isSubmitting,
    error: auth.error,
    clearError: auth.clearError,
  }
}