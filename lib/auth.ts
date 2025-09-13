import { supabase } from './supabase-client'

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
        password
      })
    })

    const result = await response.json()
    
    if (result.success && result.user) {
      return {
        success: true,
        user: {
          id: result.user.id,
          email: result.user.email,
        }
      }
    }

    return { success: false, error: result.error || 'Erreur de connexion' }
    
  } catch (error) {
    console.error('Sign in error:', error)
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
      password
    })

    if (error) {
      if (error.message.includes('User already registered')) {
        return { success: false, error: 'Un compte existe déjà avec cette adresse email' }
      } else if (error.message.includes('Password should be at least')) {
        return { success: false, error: 'Le mot de passe doit contenir au moins 6 caractères' }
      } else {
        return { success: false, error: 'Erreur lors de la création du compte. Veuillez réessayer.' }
      }
    }

    if (data.user) {
      return {
        success: true,
        user: {
          id: data.user.id,
          email: data.user.email!,
          email_confirmed_at: data.user.email_confirmed_at
        }
      }
    }

    return { success: false, error: 'Erreur de création de compte inattendue' }
    
  } catch (error) {
    console.error('Sign up error:', error)
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
        action: 'logout'
      })
    })
    
    // Also clear client-side cookie as fallback
    if (typeof document !== 'undefined') {
      document.cookie = 'session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    }
    
  } catch (error) {
    console.error('Sign out error:', error)
    
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
export async function refreshSession(): Promise<AuthResponse> {
  try {
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refresh'
      })
    })

    const result = await response.json()
    
    if (result.success && result.user) {
      return {
        success: true,
        user: {
          id: result.user.id,
          email: result.user.email,
        }
      }
    }

    return { success: false, error: result.error || 'Erreur de rafraîchissement' }
    
  } catch (error) {
    console.error('Refresh session error:', error)
    return { success: false, error: 'Erreur lors du rafraîchissement de la session' }
  }
}

/**
 * Gets the current authenticated user from the API
 * Returns user data if session is valid, null otherwise
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
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
        email: result.user.email
      }
    }
    
    return null
    
  } catch (error) {
    console.error('Get current user error:', error)
    return null
  }
}

/**
 * Checks if a user is currently authenticated via API
 * Returns true if valid session exists, false otherwise
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/session', {
      method: 'GET',
    })

    if (!response.ok) {
      return false
    }

    const result = await response.json()
    return result.success && result.authenticated
    
  } catch (error) {
    console.error('Authentication check error:', error)
    return false
  }
}

/**
 * Sends password reset email using Supabase
 * Returns success/error response
 */
export async function resetPassword(email: string): Promise<AuthResponse> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })

    if (error) {
      console.error('Password reset error:', error)
      return { success: false, error: 'Erreur lors de l\'envoi de l\'email de réinitialisation' }
    }

    return { success: true }
    
  } catch (error) {
    console.error('Reset password error:', error)
    return { success: false, error: 'Erreur lors de l\'envoi de l\'email de réinitialisation' }
  }
}

/**
 * Updates user password with new password
 * Requires valid session for security
 */
export async function updatePassword(newPassword: string): Promise<AuthResponse> {
  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    })

    if (error) {
      if (error.message.includes('same as the old password')) {
        return { success: false, error: 'Le nouveau mot de passe doit être différent de l\'ancien' }
      }
      return { success: false, error: 'Erreur lors de la mise à jour du mot de passe' }
    }

    return { success: true }
    
  } catch (error) {
    console.error('Update password error:', error)
    return { success: false, error: 'Erreur lors de la mise à jour du mot de passe' }
  }
}