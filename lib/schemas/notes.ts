import { z } from 'zod'
import { NOTE_CONTENT_MAX_CHARS } from '@/lib/constants/notes'

/**
 * Contenu d'une note (pense-bête). Trimé avant validation : une note faite
 * uniquement d'espaces est refusée, comme le CHECK `notes_content_not_empty_check`.
 * La borne haute est partagée avec le CHECK `notes_content_max_len_check`.
 */
export const noteContentSchema = z
  .string()
  .trim()
  .min(1, 'La note ne peut pas être vide')
  .max(NOTE_CONTENT_MAX_CHARS, `La note ne peut pas dépasser ${NOTE_CONTENT_MAX_CHARS} caractères`)

/**
 * Body schema for POST /api/notes. Le contexte (perso / groupe) est porté par
 * `?context=profile|group`, miroir POST /api/finance/projects.
 *
 * Réutilisé tel quel par le formulaire client du NotesDrawer (aucun champ
 * numérique, donc pas de variante `z.coerce` à maintenir).
 */
export const createNoteBodySchema = z.object({
  content: noteContentSchema,
})

/** Body schema for PUT /api/notes/[id] — seul le contenu est éditable. */
export const updateNoteBodySchema = createNoteBodySchema

export type CreateNoteBody = z.infer<typeof createNoteBodySchema>
export type UpdateNoteBody = z.infer<typeof updateNoteBodySchema>
