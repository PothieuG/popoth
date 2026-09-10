import { SignJWT, jwtVerify } from 'jose'
import { SESSION_EXPIRATION_JOSE, SESSION_EXPIRATION_SECONDS } from './constants/auth'

// Secret key for JWT signing and verification
const secretKey = process.env.JWT_SECRET_KEY || 'your-secret-key-here'
const key = new TextEncoder().encode(secretKey)

// Session payload interface
export interface SessionPayload {
  userId: string
  email: string
  /**
   * Groupe de l'utilisateur au moment où le jeton a été émis.
   *
   * Sprint Perf-Waterfall (2026-09-10) — embarqué ici pour que les routes API
   * n'aient plus à relire `profiles` avant chaque handler. Un chargement de
   * dashboard déclenche 13 appels, donc 13 lectures bloquantes pour un champ
   * qui ne change qu'aux rares moments où l'on rejoint ou quitte un groupe.
   *
   * Trois états, à ne pas confondre :
   *   - `string`    → l'utilisateur est dans ce groupe
   *   - `null`      → l'utilisateur n'est dans aucun groupe
   *   - `undefined` → jeton émis AVANT ce sprint : l'information est inconnue,
   *                   il faut retomber sur une lecture en base. Sans ce
   *                   troisième état, tous les utilisateurs déjà connectés
   *                   seraient vus comme « sans groupe » au déploiement.
   *
   * La valeur est ré-émise à chaque mutation d'appartenance (cf.
   * `updateSessionGroup`), donc elle ne périme pas : rejoindre, créer, quitter
   * et supprimer un groupe sont tous des actions de l'utilisateur sur
   * lui-même — il n'existe pas de fonction « exclure un membre ».
   */
  groupId?: string | null
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
  } catch {
    return null
  }
}

/**
 * Creates a session token for the provided user data
 * Returns the encrypted JWT token string
 */
export async function createSessionToken(
  userId: string,
  email: string,
  groupId: string | null,
): Promise<string> {
  const currentTime = Math.floor(Date.now() / 1000)
  const expiresAt = currentTime + SESSION_EXPIRATION_SECONDS

  const sessionPayload: SessionPayload = {
    userId,
    email,
    groupId,
    createdAt: currentTime,
    expiresAt,
  }

  return await encrypt(sessionPayload)
}
