/**
 * Sprint Perf-Waterfall (2026-09-10) — `groupId` embarqué dans le jeton.
 *
 * Le risque de ce mécanisme n'est pas la performance mais la PÉREMPTION : un
 * jeton qui affirme un groupe que l'utilisateur a quitté ferait servir les
 * données de ce groupe jusqu'à son prochain rafraîchissement. La parade est la
 * ré-émission à chaque mutation d'appartenance ; ces tests pinnent le contrat
 * du jeton dont elle dépend.
 */

import { describe, expect, it } from 'vitest'
import { createSessionToken, decrypt } from '@/lib/session'

describe('jeton de session — groupe embarqué', () => {
  it('transporte le groupe et le rend lisible sans base', async () => {
    const token = await createSessionToken('u1', 'a@b.c', 'group-1')
    const payload = await decrypt(token)

    expect(payload?.userId).toBe('u1')
    expect(payload?.groupId).toBe('group-1')
  })

  it('distingue « aucun groupe » (null) de « inconnu » (absent)', async () => {
    // `null` doit survivre à l'aller-retour JWT : c'est ce qui permet à
    // `withAuthAndGroup` de ne PAS relire la base pour un utilisateur solo.
    const payload = await decrypt(await createSessionToken('u1', 'a@b.c', null))

    expect(payload).not.toBeNull()
    expect(payload?.groupId).toBeNull()
    expect(payload?.groupId).not.toBeUndefined()
  })

  it('un jeton émis avant ce sprint laisse le groupe indéterminé', async () => {
    // Reproduit la forme legacy : payload sans `groupId`. Le wrapper doit voir
    // `undefined` (et donc retomber sur la base), surtout pas `null` — sinon
    // tout utilisateur déjà connecté perdrait son groupe au déploiement.
    const { SignJWT } = await import('jose')
    const key = new TextEncoder().encode(process.env.JWT_SECRET_KEY || 'your-secret-key-here')
    const legacy = await new SignJWT({
      userId: 'u1',
      email: 'a@b.c',
      createdAt: 0,
      expiresAt: 9e9,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key)

    const payload = await decrypt(legacy)

    expect(payload?.userId).toBe('u1')
    expect(payload?.groupId).toBeUndefined()
  })

  it('un jeton forgé avec une autre clé est rejeté', async () => {
    // Le groupe devient une donnée d'autorisation : il faut que la signature
    // reste la seule source de confiance.
    const { SignJWT } = await import('jose')
    const forged = await new SignJWT({ userId: 'u1', email: 'a@b.c', groupId: 'group-victime' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('mauvaise-cle-de-signature-quelconque'))

    expect(await decrypt(forged)).toBeNull()
  })
})
