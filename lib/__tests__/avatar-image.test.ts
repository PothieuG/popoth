/**
 * Sprint Fix-Avatar-Payload (2026-09-11) — partie pure du redimensionnement
 * d'avatar. Le canvas n'existe pas en jsdom : `shrinkImageToDataUrl` n'est
 * exercé qu'en navigateur ; ici on pinne les bornes qui rendent une photo
 * brute impossible à stocker.
 */

import { describe, expect, it } from 'vitest'
import { fitWithin, isAvatarUrlTooLarge } from '@/lib/avatar-image'
import { AVATAR_MAX_SIDE_PX, AVATAR_URL_MAX_CHARS } from '@/lib/constants/avatar'

describe('fitWithin', () => {
  it('réduit une photo de téléphone en portrait à 256 px de haut, ratio conservé', () => {
    expect(fitWithin({ width: 3000, height: 4000 })).toEqual({ width: 192, height: 256 })
  })

  it('réduit un paysage à 256 px de large', () => {
    expect(fitWithin({ width: 4000, height: 3000 })).toEqual({ width: 256, height: 192 })
  })

  it("n'agrandit jamais une image déjà petite", () => {
    expect(fitWithin({ width: 100, height: 80 })).toEqual({ width: 100, height: 80 })
  })

  it('ne descend jamais sous 1 px et tolère des dimensions invalides', () => {
    expect(fitWithin({ width: 10000, height: 1 })).toEqual({ width: AVATAR_MAX_SIDE_PX, height: 1 })
    expect(fitWithin({ width: 0, height: 0 })).toEqual({ width: 1, height: 1 })
  })
})

describe('isAvatarUrlTooLarge', () => {
  it('laisse passer un JPEG 256 px typique (≈ 30 Ko en base64)', () => {
    expect(isAvatarUrlTooLarge('data:image/jpeg;base64,' + 'A'.repeat(40_000))).toBe(false)
  })

  it('refuse une photo brute (3,7 Mo en base64, cas prod du 2026-09-11)', () => {
    expect(isAvatarUrlTooLarge('data:image/jpeg;base64,' + 'A'.repeat(3_679_000))).toBe(true)
  })

  it('la borne est exactement AVATAR_URL_MAX_CHARS', () => {
    expect(isAvatarUrlTooLarge('x'.repeat(AVATAR_URL_MAX_CHARS))).toBe(false)
    expect(isAvatarUrlTooLarge('x'.repeat(AVATAR_URL_MAX_CHARS + 1))).toBe(true)
  })
})
