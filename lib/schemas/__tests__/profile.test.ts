import { describe, it, expect } from 'vitest'
import { createProfileBodySchema, updateProfileBodySchema } from '@/lib/schemas/profile'
import { AVATAR_URL_MAX_CHARS } from '@/lib/constants/avatar'

describe('createProfileBodySchema', () => {
  it('accepts a valid create body with all fields', () => {
    const result = createProfileBodySchema.safeParse({
      first_name: 'Alice',
      last_name: 'Doe',
      salary: 2500,
      avatar_url: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects salary above the 999999.99 cap', () => {
    const result = createProfileBodySchema.safeParse({
      first_name: 'Alice',
      last_name: 'Doe',
      salary: 1000000,
    })
    expect(result.success).toBe(false)
  })
})

describe('updateProfileBodySchema', () => {
  it('rejects an empty body (refine: at least one field required)', () => {
    const result = updateProfileBodySchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      const refineIssue = result.error.issues.find((i) =>
        i.message.includes('Aucune donnée à mettre à jour'),
      )
      expect(refineIssue).toBeDefined()
    }
  })
})

// Sprint Fix-Avatar-Payload (2026-09-11) — garde serveur contre une photo brute
// en base64 dans `profiles.avatar_url` (cas prod : 3,7 Mo répétés dans chaque
// ligne de liste jointe au créateur → 500 après 14,7 s).
describe('avatar_url — borne de taille', () => {
  it('accepte un avatar redimensionné (data URL ≤ AVATAR_URL_MAX_CHARS)', () => {
    const result = updateProfileBodySchema.safeParse({
      avatar_url: 'data:image/jpeg;base64,' + 'A'.repeat(30_000),
    })
    expect(result.success).toBe(true)
  })

  it('refuse une photo brute (data URL > AVATAR_URL_MAX_CHARS) avec un message métier', () => {
    const result = updateProfileBodySchema.safeParse({
      avatar_url: 'data:image/jpeg;base64,' + 'A'.repeat(AVATAR_URL_MAX_CHARS + 1),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('Photo trop lourde')
    }
  })

  it('la même borne vaut à la création du profil', () => {
    const result = createProfileBodySchema.safeParse({
      first_name: 'Alice',
      last_name: 'Doe',
      avatar_url: 'data:image/jpeg;base64,' + 'A'.repeat(AVATAR_URL_MAX_CHARS + 1),
    })
    expect(result.success).toBe(false)
  })

  it('`null` (suppression de la photo) reste accepté', () => {
    expect(updateProfileBodySchema.safeParse({ avatar_url: null }).success).toBe(true)
  })
})
