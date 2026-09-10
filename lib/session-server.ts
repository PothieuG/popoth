import { cookies } from 'next/headers'
import { createSessionToken, decrypt, type SessionPayload } from './session'
import { SESSION_EXPIRATION_SECONDS } from './constants/auth'
import { logger } from './logger'

/**
 * Server-side session management utilities
 * Uses next/headers for cookie operations - only works in Server Components
 */

/**
 * Creates a new session cookie with the provided user data
 * Sets secure HTTP-only cookie with 1-hour expiration
 */
export async function createSession(
  userId: string,
  email: string,
  groupId: string | null,
): Promise<void> {
  const sessionToken = await createSessionToken(userId, email, groupId)
  const cookieStore = await cookies()

  // Set secure HTTP-only cookie
  cookieStore.set('session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_EXPIRATION_SECONDS,
    path: '/',
  })
}

/**
 * Updates an existing session by creating a new token with extended expiration
 * Refreshes the session cookie to maintain authentication
 */
export async function updateSession(
  userId: string,
  email: string,
  groupId: string | null,
): Promise<void> {
  const sessionToken = await createSessionToken(userId, email, groupId)
  const cookieStore = await cookies()

  // Update the session cookie
  cookieStore.set('session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_EXPIRATION_SECONDS,
    path: '/',
  })
}

/**
 * Ré-émet le jeton de session courant avec un nouveau groupe.
 *
 * Sprint Perf-Waterfall (2026-09-10) — à appeler depuis TOUTE route qui modifie
 * `profiles.group_id`, sinon le `groupId` embarqué dans le jeton périme et les
 * routes API continuent de servir l'ancien groupe jusqu'au prochain
 * rafraîchissement (≤ 50 min).
 *
 * Les 4 sites concernés sont tous des actions de l'utilisateur sur lui-même —
 * créer un groupe, le rejoindre, le quitter, le supprimer — donc la ré-émission
 * atteint toujours la bonne session. Il n'existe pas de fonction « exclure un
 * membre » ; si elle était ajoutée un jour, ce mécanisme ne suffirait plus et
 * il faudrait invalider la session de la personne exclue côté serveur.
 *
 * Sans session active (cas théorique : le cookie vient d'expirer pendant la
 * requête), on ne fait rien — le prochain appel ré-authentifiera.
 */
export async function updateSessionGroup(groupId: string | null): Promise<void> {
  const current = await getSession()
  if (!current) return
  await updateSession(current.userId, current.email, groupId)
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
    const sessionCookie = request.headers
      .get('cookie')
      ?.split(';')
      .find((c) => c.trim().startsWith('session='))
      ?.split('=')[1]

    if (!sessionCookie) {
      return null
    }

    // Decrypt and validate the session token
    const sessionData = await decrypt(sessionCookie)

    if (!sessionData) {
      return null
    }

    // Check if session is expired
    const currentTime = Math.floor(Date.now() / 1000)
    if (sessionData.expiresAt <= currentTime) {
      return null
    }

    logger.debug('✅ Session valide pour userId:', sessionData.userId)
    return sessionData
  } catch {
    return null
  }
}
