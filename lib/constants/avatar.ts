/**
 * Photo de profil — bornes partagées client (redimensionnement) / serveur (Zod).
 *
 * Sprint Fix-Avatar-Payload (2026-09-11). Cause réelle de « le groupe est
 * lent » (HAR prod) : `AvatarUpload` stockait la photo brute du téléphone en
 * base64 dans `profiles.avatar_url` (3,7 Mo pour un membre), et chaque ligne
 * de liste la ré-embarquait via la jointure `created_by` → la liste des
 * dépenses du groupe répondait 500 après 14,7 s. Un avatar est affiché en
 * 32-48 px : 256 px suffisent largement.
 */

/** Côté maximal (px) de l'image stockée. Affichage max 48 px → marge ×5 retina. */
export const AVATAR_MAX_SIDE_PX = 256

/** Qualité JPEG du rendu redimensionné (0-1). */
export const AVATAR_JPEG_QUALITY = 0.82

/**
 * Longueur maximale acceptée pour `avatar_url` (URL http(s) ou data URL).
 * Un JPEG 256×256 q0.82 pèse 10-30 Ko, soit ≤ 40 000 chars en base64 : la
 * borne laisse ×3 de marge tout en rendant impossible le retour d'une photo
 * brute (une photo de téléphone = 2-8 Mo, soit des millions de chars).
 */
export const AVATAR_URL_MAX_CHARS = 120_000

/** Taille maximale du fichier source sélectionné (avant redimensionnement). */
export const AVATAR_SOURCE_MAX_BYTES = 15 * 1024 * 1024
