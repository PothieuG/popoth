import {
  AVATAR_JPEG_QUALITY,
  AVATAR_MAX_SIDE_PX,
  AVATAR_URL_MAX_CHARS,
} from '@/lib/constants/avatar'

/**
 * Redimensionnement d'une photo de profil côté navigateur.
 *
 * Sprint Fix-Avatar-Payload (2026-09-11) — voir lib/constants/avatar.ts pour
 * le pourquoi. La partie pure (`fitWithin`, `isAvatarUrlTooLarge`) est testée ;
 * `shrinkImageToDataUrl` dépend du DOM (canvas, createImageBitmap) et n'est
 * exercée qu'en navigateur.
 */

export interface Dimensions {
  width: number
  height: number
}

/**
 * Dimensions cibles pour faire tenir `source` dans un carré de `maxSide`,
 * ratio conservé, jamais agrandi. Entiers ≥ 1.
 */
export function fitWithin(source: Dimensions, maxSide: number = AVATAR_MAX_SIDE_PX): Dimensions {
  const { width, height } = source
  if (width <= 0 || height <= 0) return { width: 1, height: 1 }
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Vrai si la chaîne dépasse la borne partagée avec le schéma Zod serveur. */
export function isAvatarUrlTooLarge(url: string): boolean {
  return url.length > AVATAR_URL_MAX_CHARS
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // `createImageBitmap` respecte l'orientation EXIF (photos de téléphone en
  // portrait) — le repli `<img>` couvre les navigateurs sans cette API.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // repli ci-dessous
    }
  }
  const objectUrl = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Image illisible'))
      img.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Convertit une image sélectionnée en data URL JPEG ≤ 256 px de côté.
 *
 * Avant ce sprint, le fichier partait tel quel (`readAsDataURL`) : une photo
 * de téléphone de 3,7 Mo devenait 3,7 Mo de base64 dans `profiles.avatar_url`,
 * ré-embarqués dans chaque ligne de transaction jointe au créateur.
 */
export async function shrinkImageToDataUrl(file: File): Promise<string> {
  const image = await decodeImage(file)
  const { width, height } = fitWithin({ width: image.width, height: image.height })

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')
  // Fond blanc : un PNG transparent converti en JPEG deviendrait noir.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)
  if ('close' in image && typeof image.close === 'function') image.close()

  const dataUrl = canvas.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY)
  if (isAvatarUrlTooLarge(dataUrl)) {
    throw new Error('Image trop lourde après redimensionnement')
  }
  return dataUrl
}
