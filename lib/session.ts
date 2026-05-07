import { SignJWT, jwtVerify } from 'jose'
import { SESSION_EXPIRATION_JOSE, SESSION_EXPIRATION_SECONDS } from './constants/auth'

// Secret key for JWT signing and verification
const secretKey = process.env.JWT_SECRET_KEY || 'your-secret-key-here'
const key = new TextEncoder().encode(secretKey)

// Session payload interface
export interface SessionPayload {
  userId: string
  email: string
  createdAt: number
  expiresAt: number
}

/**
 * Encrypts a session payload into a JWT token
 * Creates a signed JWT with user data and expiration
 */
export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_EXPIRATION_JOSE)
    .sign(key)
}

/**
 * Decrypts and verifies a JWT session token
 * Returns the session payload if valid, null if invalid or expired
 */
export async function decrypt(session: string | undefined = ''): Promise<SessionPayload | null> {
  if (!session) return null
  
  try {
    const { payload } = await jwtVerify(session, key, {
      algorithms: ['HS256'],
    })
    
    return payload as unknown as SessionPayload
  } catch (error) {
    console.error('Failed to decrypt session:', error)
    return null
  }
}

/**
 * Creates a session token for the provided user data
 * Returns the encrypted JWT token string
 */
export async function createSessionToken(userId: string, email: string): Promise<string> {
  const currentTime = Math.floor(Date.now() / 1000)
  const expiresAt = currentTime + SESSION_EXPIRATION_SECONDS
  
  const sessionPayload: SessionPayload = {
    userId,
    email,
    createdAt: currentTime,
    expiresAt,
  }
  
  return await encrypt(sessionPayload)
}