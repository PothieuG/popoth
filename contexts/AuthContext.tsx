'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  signInWithPassword,
  signUp,
  signOut,
  getCurrentUser,
  refreshSession,
  isAuthenticated,
  type AuthUser,
} from '@/lib/auth'
import { AUTH_CHECK_INTERVAL_MS, SESSION_REFRESH_INTERVAL_MS } from '@/lib/constants/auth'

interface AuthUserValue {
  user: AuthUser | null
  loading: boolean
  error: string | null
  isLoggedIn: boolean
}

interface AuthActionsValue {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  register: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  clearError: () => void
  refreshUserSession: () => Promise<void>
}

const AuthUserContext = createContext<AuthUserValue | undefined>(undefined)
const AuthActionsContext = createContext<AuthActionsValue | undefined>(undefined)

export function useAuthUser(): AuthUserValue {
  const context = useContext(AuthUserContext)
  if (context === undefined) {
    throw new Error('useAuthUser must be used within an AuthProvider')
  }
  return context
}

export function useAuthActions(): AuthActionsValue {
  const context = useContext(AuthActionsContext)
  if (context === undefined) {
    throw new Error('useAuthActions must be used within an AuthProvider')
  }
  return context
}

/**
 * Backwards-compatible aggregator hook. Subscribes to BOTH contexts, so
 * callers re-render on any change. New code should prefer `useAuthUser()`
 * or `useAuthActions()` directly to opt into finer-grained subscription.
 */
export function useAuth(): AuthUserValue & AuthActionsValue {
  return { ...useAuthUser(), ...useAuthActions() }
}

interface AuthProviderProps {
  children: React.ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Refs avoid setState churn on every interval (start|stop) and let
  // handlers read the latest user without listing it as a useCallback dep.
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const userRef = useRef<AuthUser | null>(null)

  useEffect(() => {
    userRef.current = user
  }, [user])

  const stopTokenRefresh = useCallback(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current)
      refreshIntervalRef.current = null
    }
  }, [])

  const stopAuthCheck = useCallback(() => {
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current)
      checkIntervalRef.current = null
    }
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      stopTokenRefresh()
      stopAuthCheck()
      await signOut()
      setUser(null)
      setError(null)
      if (typeof window !== 'undefined') {
        window.location.href = '/connexion'
      }
    } catch (err) {
      console.error('Logout error:', err)
      stopTokenRefresh()
      stopAuthCheck()
      setUser(null)
      if (typeof window !== 'undefined') {
        window.location.href = '/connexion'
      }
    }
  }, [stopTokenRefresh, stopAuthCheck])

  const startTokenRefresh = useCallback(() => {
    stopTokenRefresh()
    const interval = setInterval(async () => {
      try {
        const result = await refreshSession()
        if (!result.success) {
          await handleLogout()
        }
      } catch (err) {
        console.error('Auto refresh error:', err)
        await handleLogout()
      }
    }, SESSION_REFRESH_INTERVAL_MS)
    refreshIntervalRef.current = interval
  }, [stopTokenRefresh, handleLogout])

  const startAuthCheck = useCallback(() => {
    stopAuthCheck()
    const interval = setInterval(async () => {
      try {
        if (userRef.current) {
          const authenticated = await isAuthenticated()
          if (!authenticated) {
            await handleLogout()
          }
        }
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('401')) {
          console.error('Auth check error:', err)
        }
        if (userRef.current) {
          await handleLogout()
        }
      }
    }, AUTH_CHECK_INTERVAL_MS)
    checkIntervalRef.current = interval
  }, [stopAuthCheck, handleLogout])

  const initializeAuth = useCallback(async () => {
    try {
      setLoading(true)

      const hasSession = typeof document !== 'undefined' && document.cookie.includes('session=')

      if (!hasSession) {
        setUser(null)
        stopTokenRefresh()
        stopAuthCheck()
        return
      }

      const currentUser = await getCurrentUser()

      if (currentUser) {
        setUser(currentUser)
        startTokenRefresh()
        startAuthCheck()
      } else {
        setUser(null)
        stopTokenRefresh()
        stopAuthCheck()
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes('401')) {
        console.error('Auth initialization error:', err)
        setError("Erreur d'initialisation de l'authentification")
      }
      setUser(null)
      stopTokenRefresh()
      stopAuthCheck()
    } finally {
      setLoading(false)
    }
  }, [stopTokenRefresh, stopAuthCheck, startTokenRefresh, startAuthCheck])

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        setLoading(true)
        setError(null)

        const result = await signInWithPassword(email, password)

        if (result.success && result.user) {
          setUser(result.user)
          startTokenRefresh()
          startAuthCheck()
          return { success: true }
        } else {
          setError(result.error || 'Erreur de connexion')
          return { success: false, error: result.error }
        }
      } catch {
        const errorMessage = 'Erreur de connexion. Veuillez réessayer.'
        setError(errorMessage)
        return { success: false, error: errorMessage }
      } finally {
        setLoading(false)
      }
    },
    [startTokenRefresh, startAuthCheck],
  )

  const register = useCallback(async (email: string, password: string) => {
    try {
      setLoading(true)
      setError(null)

      const result = await signUp(email, password)

      if (result.success) {
        return { success: true }
      } else {
        setError(result.error || 'Erreur de création de compte')
        return { success: false, error: result.error }
      }
    } catch {
      const errorMessage = 'Erreur de création de compte. Veuillez réessayer.'
      setError(errorMessage)
      return { success: false, error: errorMessage }
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    setLoading(true)
    await handleLogout()
  }, [handleLogout])

  const refreshUserSession = useCallback(async () => {
    try {
      const result = await refreshSession()
      if (result.success && result.user) {
        setUser(result.user)
      } else {
        await handleLogout()
      }
    } catch (err) {
      console.error('Manual refresh error:', err)
      await handleLogout()
    }
  }, [handleLogout])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  /* eslint-disable react-hooks/set-state-in-effect -- initializeAuth() is an async setup pipeline (token validation + setUser/setLoading after the await); the rule cannot tell that the setStates fire in the async continuation, not synchronously in the effect body. */
  useEffect(() => {
    initializeAuth()
    return () => {
      stopTokenRefresh()
      stopAuthCheck()
    }
  }, [initializeAuth, stopTokenRefresh, stopAuthCheck])
  /* eslint-enable react-hooks/set-state-in-effect */

  const isLoggedIn = user !== null

  const userValue: AuthUserValue = {
    user,
    loading,
    error,
    isLoggedIn,
  }

  const actionsValue: AuthActionsValue = {
    login,
    register,
    logout,
    clearError,
    refreshUserSession,
  }

  return (
    <AuthUserContext.Provider value={userValue}>
      <AuthActionsContext.Provider value={actionsValue}>{children}</AuthActionsContext.Provider>
    </AuthUserContext.Provider>
  )
}
