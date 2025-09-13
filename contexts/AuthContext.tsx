'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { AuthUser, signInWithPassword, signUp, signOut, getCurrentUser, refreshSession, isAuthenticated } from '@/lib/auth'

// Auth context interface
interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  register: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  clearError: () => void
  refreshUserSession: () => Promise<void>
  isLoggedIn: boolean
}

// Create the context
const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Custom hook to use the auth context
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Auth provider component props
interface AuthProviderProps {
  children: React.ReactNode
}

/**
 * AuthProvider component that manages global authentication state
 * Provides authentication methods and user state to the entire app
 * Handles automatic token refresh and session management
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null)
  const [checkInterval, setCheckInterval] = useState<NodeJS.Timeout | null>(null)

  /**
   * Initializes auth state by checking for existing session
   * Called on component mount and after authentication changes
   */
  const initializeAuth = async () => {
    try {
      setLoading(true)
      
      // Check if there's a session cookie first (client-side check)
      const hasSession = typeof document !== 'undefined' && 
        document.cookie.includes('session=')
      
      if (!hasSession) {
        // No session cookie, skip API call
        setUser(null)
        stopTokenRefresh()
        stopAuthCheck()
        return
      }
      
      // Only make API call if there's potentially a session
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
    } catch (error) {
      // Don't log 401 errors as they're expected for non-authenticated users
      if (error instanceof Error && !error.message.includes('401')) {
        console.error('Auth initialization error:', error)
        setError('Erreur d\'initialisation de l\'authentification')
      }
      setUser(null)
      stopTokenRefresh()
      stopAuthCheck()
    } finally {
      setLoading(false)
    }
  }

  /**
   * Starts automatic token refresh every 50 minutes (10 minutes before expiry)
   * Prevents session timeout by refreshing tokens in the background
   */
  const startTokenRefresh = () => {
    stopTokenRefresh() // Clear any existing interval
    
    const interval = setInterval(async () => {
      try {
        const result = await refreshSession()
        if (!result.success) {
          await handleLogout()
        }
      } catch (error) {
        console.error('Auto refresh error:', error)
        await handleLogout()
      }
    }, 50 * 60 * 1000) // 50 minutes (refresh before 1h expiration)
    
    setRefreshInterval(interval)
  }

  /**
   * Stops automatic token refresh
   * Called on logout or authentication failure
   */
  const stopTokenRefresh = () => {
    if (refreshInterval) {
      clearInterval(refreshInterval)
      setRefreshInterval(null)
    }
  }

  /**
   * Starts periodic authentication checks
   * Verifies that the user is still authenticated every 5 minutes
   * Only runs when user is logged in to avoid unnecessary API calls
   */
  const startAuthCheck = () => {
    stopAuthCheck() // Clear any existing interval
    
    const interval = setInterval(async () => {
      try {
        // Only check if user is currently set (logged in)
        if (user) {
          const authenticated = await isAuthenticated()
          if (!authenticated) {
            await handleLogout()
          }
        }
      } catch (error) {
        // Only log non-401 errors
        if (!(error instanceof Error) || !error.message.includes('401')) {
          console.error('Auth check error:', error)
        }
        if (user) {
          await handleLogout()
        }
      }
    }, 5 * 60 * 1000) // Check every 5 minutes
    
    setCheckInterval(interval)
  }

  /**
   * Stops periodic authentication checks
   */
  const stopAuthCheck = () => {
    if (checkInterval) {
      clearInterval(checkInterval)
      setCheckInterval(null)
    }
  }

  /**
   * Handles user login with email and password
   * Sets user state and starts token refresh on success
   */
  const login = async (email: string, password: string) => {
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
    } catch (error) {
      const errorMessage = 'Erreur de connexion. Veuillez réessayer.'
      setError(errorMessage)
      return { success: false, error: errorMessage }
    } finally {
      setLoading(false)
    }
  }

  /**
   * Handles user registration with email and password
   * Does not automatically log in user (requires email confirmation)
   */
  const register = async (email: string, password: string) => {
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
    } catch (error) {
      const errorMessage = 'Erreur de création de compte. Veuillez réessayer.'
      setError(errorMessage)
      return { success: false, error: errorMessage }
    } finally {
      setLoading(false)
    }
  }

  /**
   * Handles user logout
   * Clears user state and stops token refresh
   */
  const handleLogout = async () => {
    try {
      stopTokenRefresh()
      stopAuthCheck()
      await signOut()
      setUser(null)
      setError(null)
      
      // Force page reload to ensure all client state is cleared
      if (typeof window !== 'undefined') {
        window.location.href = '/connexion'
      }
    } catch (error) {
      console.error('Logout error:', error)
      // Still clear local state even if logout fails
      stopTokenRefresh()
      stopAuthCheck()
      setUser(null)
      
      // Force page reload even on error
      if (typeof window !== 'undefined') {
        window.location.href = '/connexion'
      }
    }
  }

  const logout = async () => {
    setLoading(true)
    await handleLogout()
    // No need to setLoading(false) since we're redirecting
  }

  /**
   * Manually refreshes the user session
   * Can be called to extend session before automatic refresh
   */
  const refreshUserSession = async () => {
    try {
      const result = await refreshSession()
      if (result.success && result.user) {
        setUser(result.user)
      } else {
        await handleLogout()
      }
    } catch (error) {
      console.error('Manual refresh error:', error)
      await handleLogout()
    }
  }

  /**
   * Clears any current error state
   * Useful for dismissing error messages
   */
  const clearError = () => {
    setError(null)
  }

  // Initialize auth on component mount
  useEffect(() => {
    initializeAuth()
    
    // Cleanup on unmount
    return () => {
      stopTokenRefresh()
      stopAuthCheck()
    }
  }, [])

  // Check if user is logged in
  const isLoggedIn = user !== null

  const value: AuthContextType = {
    user,
    loading,
    error,
    login,
    register,
    logout,
    clearError,
    refreshUserSession,
    isLoggedIn,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}