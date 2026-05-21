import { supabase } from './supabase-client'
import { hasSessionCookie } from './session-client'
import { logger } from './logger'

// Auth response interfaces
export interface AuthUser {
  id: string
  email: string
  email_confirmed_at?: string
}

export interface AuthResponse {
  success: boolean
  user?: AuthUser
  error?: string
}

// Tri-state auth check result. `'unknown'` couvre NetworkError, 5xx, ou
// toute response.ok=false non-401 — le caller doit skip (retry plus tard)
// plutôt que logout, sinon un hiccup réseau déconnecte l'utilisateur alors
// que sa session est valide.
export type AuthCheckOutcome = 'authenticated' | 'unauthenticated' | 'unknown'

export interface RefreshSessionResult {
  outcome: 'success' | 'unauthenticated' | 'unknown'
  user?: AuthUser
  error?: string
}

/**
 * Client-side authentication using API routes
 * Authenticates user with email and password via API
 */
export async function signInWithPassword(email: string, password: string): Promise<AuthResponse> {
  try {
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'login',
        email,
        password,
      }),
    })

    const result = await response.json()

    if (result.success && result.user) {
      return {
        success: true,
        user: {
          id: result.user.id,
          email: result.user.email,
        },
      }
    }

    return { success: false, error: result.error || 'Erreur de connexion' }
  } catch {
    return { success: false, error: 'Erreur de connexion. Veuillez réessayer.' }
  }
}

/**
 * Registers a new user with email and password using Supabase
 * Sends email confirmation if registration is successful
 */
export async function signUp(email: string, password: string): Promise<AuthResponse> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      if (error.message.includes('User already registered')) {
        return { success: false, error: 'Un compte existe déjà avec cette adresse email' }
      } else if (error.message.includes('Password should be at least')) {
        return { success: false, error: 'Le mot de passe doit contenir au moins 6 caractères' }
      } else {
        return {
          success: false,
          error: 'Erreur lors de la création du compte. Veuillez réessayer.',
        }
      }
    }

    if (data.user) {
      return {
        success: true,
        user: {
          id: data.user.id,
          email: data.user.email!,
          email_confirmed_at: data.user.email_confirmed_at,
        },
      }
    }

    return { success: false, error: 'Erreur de création de compte inattendue' }
  } catch {
    return { success: false, error: 'Erreur de création de compte. Veuillez réessayer.' }
  }
}

/**
 * Signs out the current user via API
 * Clears session cookie on server and client
 */
export async function signOut(): Promise<void> {
  try {
    // Clear server-side session
    await fetch('/api/auth/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'logout',
      }),
    })

    // Also clear client-side cookie as fallback
    if (typeof document !== 'undefined') {
      document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    }
  } catch {
    // Even if API fails, clear client-side cookie
    if (typeof document !== 'undefined') {
      document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    }
  }
}

/**
 * Refreshes the current user session via API
 * Updates the session cookie with new expiration time
 */
export async function refreshSession(): Promise<RefreshSessionResult> {
  try {
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refresh',
      }),
    })

    if (response.status === 401) {
      return { outcome: 'unauthenticated' }
    }
    if (!response.ok) {
      return { outcome: 'unknown' }
    }

    const result = await response.json()

    if (result.success && result.user) {
      return {
        outcome: 'success',
        user: {
          id: result.user.id,
          email: result.user.email,
        },
      }
    }

    return { outcome: 'unauthenticated', error: result.error || 'Erreur de rafraîchissement' }
  } catch {
    return { outcome: 'unknown', error: 'Erreur lors du rafraîchissement de la session' }
  }
}

/**
 * Gets the current authenticated user from the API
 * Returns user data if session is valid, null otherwise
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    // Quick client-side check first
    if (!hasSessionCookie()) {
      return null
    }

    const response = await fetch('/api/auth/session', {
      method: 'GET',
    })

    if (!response.ok) {
      return null
    }

    const result = await response.json()

    if (result.success && result.user) {
      return {
        id: result.user.id,
        email: result.user.email,
      }
    }

    return null
  } catch (error) {
    // Don't log 401 errors as they're expected for non-authenticated users
    if (!(error instanceof Error) || !error.message.includes('401')) {
      logger.warn('Get current user error:', error)
    }
    return null
  }
}

/**
 * Checks if a user is currently authenticated via API.
 * Tri-state: 'authenticated' (200 + valid session), 'unauthenticated' (401 or
 * no cookie or body says false), 'unknown' (NetworkError, 5xx, or response.ok
 * false non-401). The caller MUST treat 'unknown' as transient and skip — a
 * dev-server hiccup or HMR rebuild ne doit pas déconnecter l'utilisateur.
 */
export async function isAuthenticated(): Promise<AuthCheckOutcome> {
  // Quick client-side check first
  if (!hasSessionCookie()) {
    return 'unauthenticated'
  }

  try {
    const response = await fetch('/api/auth/session', {
      method: 'GET',
    })

    if (response.status === 401) {
      return 'unauthenticated'
    }
    if (!response.ok) {
      return 'unknown'
    }

    const result = await response.json()
    return result.success && result.authenticated ? 'authenticated' : 'unauthenticated'
  } catch (error) {
    // Don't log 401 errors as they're expected for non-authenticated users
    if (!(error instanceof Error) || !error.message.includes('401')) {
      logger.warn('Authentication check error:', error)
    }
    return 'unknown'
  }
}
