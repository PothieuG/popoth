/**
 * Notes / pense-bêtes — bornes partagées client (formulaire) / serveur (Zod)
 * / base (CHECK `notes_content_max_len_check`, migration 20260923000000).
 *
 * Un pense-bête tient en quelques lignes ; 1 000 caractères laissent de la
 * place pour une petite liste sans transformer la note en document.
 */
export const NOTE_CONTENT_MAX_CHARS = 1000

/**
 * Onglets du drawer Notes (Sprint Notes-Tabs 2026-10-03), miroir du CHECK
 * `notes_kind_check` (migration 20261003000000) :
 * - `shopping` : liste de courses à cocher ;
 * - `note` : texte libre (les notes d'avant les onglets) ;
 * - `project` : liste simple, une ligne par projet.
 */
export const NOTE_KINDS = ['shopping', 'note', 'project'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

/**
 * Un article de courses coché est supprimé au-delà de ce délai (compté depuis
 * la case cochée), par GET /api/notes. Décocher remet le compteur à zéro.
 */
export const SHOPPING_CHECKED_RETENTION_DAYS = 7
