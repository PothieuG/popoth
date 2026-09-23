/**
 * Notes / pense-bêtes — bornes partagées client (formulaire) / serveur (Zod)
 * / base (CHECK `notes_content_max_len_check`, migration 20260923000000).
 *
 * Un pense-bête tient en quelques lignes ; 1 000 caractères laissent de la
 * place pour une petite liste sans transformer la note en document.
 */
export const NOTE_CONTENT_MAX_CHARS = 1000
