import { cookies } from 'next/headers'
import { createSessionToken, decrypt, SessionPayload } from './session'

/**
 * Server-side session management utilities
 * Uses next/headers for cookie operations - only works in Server Components
 */

/**
 * Creates a new session cookie with the provided user data
 * Sets secure HTTP-only cookie with 1-hour expiration
 */
export async function createSession(userId: string, email: string): Promise<void> {
  const sessionToken = await createSessionToken(userId, email)
  const cookieStore = await cookies()
  
  // Set secure HTTP-only cookie
  cookieStore.set('session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 3600, // 1 hour
    path: '/',
  })
}

/**
 * Updates an existing session by creating a new token with extended expiration
 * Refreshes the session cookie to maintain authentication
 */
export async function updateSession(userId: string, email: string): Promise<void> {
  const sessionToken = await createSessionToken(userId, email)
  const cookieStore = await cookies()
  
  // Update the session cookie
  cookieStore.set('session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 3600, // 1 hour (normal usage)
    path: '/',
  })
}

/**
 * Destroys the current session by deleting the session cookie
 * Used for logout functionality
 */
export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete('session')
}

/**
 * Gets the current session from the cookie store
 * Returns the session payload if valid, null otherwise
 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value
  
  if (!sessionCookie) return null
  
  return decrypt(sessionCookie)
}

/**
 * Checks if the current session is valid and not expired
 * Returns true if session exists and is valid, false otherwise
 */
export async function isSessionValid(): Promise<boolean> {
  const session = await getSession()
  
  if (!session) return false
  
  const currentTime = Math.floor(Date.now() / 1000)
  return session.expiresAt > currentTime
}

/**
 * Validates session token from NextRequest and returns session data
 * Used in API routes to validate user authentication
 */
export async function validateSessionToken(request: Request): Promise<SessionPayload | null> {
  try {
    // Extract session token from cookies
    const sessionCookie = request.headers.get('cookie')
      ?.split(';')
      .find(c => c.trim().startsWith('session='))
      ?.split('=')[1]

    if (!sessionCookie) {
      console.log('❌ Aucun cookie de session trouvé')
      return null
    }

    // Decrypt and validate the session token
    const sessionData = await decrypt(sessionCookie)
    
    if (!sessionData) {
      console.log('❌ Token de session invalide')
      return null
    }

    // Check if session is expired
    const currentTime = Math.floor(Date.now() / 1000)
    if (sessionData.expiresAt <= currentTime) {
      console.log('❌ Session expirée')
      return null
    }

    console.log('✅ Session valide pour userId:', sessionData.userId)
    return sessionData
  } catch (error) {
    console.error('❌ Erreur lors de la validation de session:', error)
    return null
  }
}