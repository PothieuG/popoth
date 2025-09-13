import { decrypt, SessionPayload } from './session'

/**
 * Client-side session management utilities
 * Uses document.cookie for browser-based cookie operations
 */

/**
 * Gets a cookie value by name from document.cookie
 * Only works on the client side
 */
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  
  if (parts.length === 2) {
    const cookieValue = parts.pop()?.split(';').shift()
    return cookieValue || null
  }
  
  return null
}

/**
 * Sets a cookie with the specified name, value, and options
 * Only works on the client side
 */
function setCookie(name: string, value: string, options: {
  maxAge?: number
  path?: string
  secure?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
} = {}): void {
  if (typeof document === 'undefined') return
  
  const {
    maxAge = 3600, // 1 hour default
    path = '/',
    secure = process.env.NODE_ENV === 'production',
    sameSite = 'lax'
  } = options
  
  let cookieString = `${name}=${value}; max-age=${maxAge}; path=${path}; samesite=${sameSite}`
  
  if (secure) {
    cookieString += '; secure'
  }
  
  document.cookie = cookieString
}

/**
 * Deletes a cookie by setting its expiration to the past
 * Only works on the client side
 */
function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return
  
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`
}

/**
 * Gets the current session from client-side cookies
 * Returns the session payload if valid, null otherwise
 */
export async function getClientSession(): Promise<SessionPayload | null> {
  const sessionCookie = getCookie('session')
  
  if (!sessionCookie) return null
  
  return decrypt(sessionCookie)
}

/**
 * Checks if the current client session is valid and not expired
 * Returns true if session exists and is valid, false otherwise
 */
export async function isClientSessionValid(): Promise<boolean> {
  const session = await getClientSession()
  
  if (!session) return false
  
  const currentTime = Math.floor(Date.now() / 1000)
  return session.expiresAt > currentTime
}

/**
 * Deletes the client session cookie
 * Used for client-side logout functionality
 */
export function deleteClientSession(): void {
  deleteCookie('session')
}

/**
 * Checks if we're running on the client side
 * Useful for conditional logic based on environment
 */
export function isClient(): boolean {
  return typeof window !== 'undefined'
}

/**
 * Checks if a session cookie exists without making an API call
 * Quick client-side check to avoid unnecessary network requests
 */
export function hasSessionCookie(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.includes('session=')
}