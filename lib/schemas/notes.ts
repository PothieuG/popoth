import { z } from 'zod'
import { NOTE_CONTENT_MAX_CHARS, NOTE_KINDS } from '@/lib/constants/notes'

/**
 * Contenu d'une note, d'un article de courses ou d'un projet (messages
 * neutres, communs aux 3 onglets). Trimé avant validation : une note faite
 * uniquement d'espaces est refusée, comme le CHECK `notes_content_not_empty_check`.
 * La borne haute est partagée avec le CHECK `notes_content_max_len_check`.
 */
export const noteContentSchema = z
  .string()
  .trim()
  .min(1, 'Le texte ne peut pas être vide')
  .max(NOTE_CONTENT_MAX_CHARS, `Le texte ne peut pas dépasser ${NOTE_CONTENT_MAX_CHARS} caractères`)

/** Onglet d'une note (Sprint Notes-Tabs), miroir du CHECK `notes_kind_check`. */
export const noteKindSchema = z.enum(NOTE_KINDS)

/**
 * Formulaire client du NotesDrawer : seul le contenu est saisi, l'onglet est
 * fourni par le drawer. Aucun champ numérique, donc pas de variante `z.coerce`.
 */
export const noteFormSchema = z.object({
  content: noteContentSchema,
})

/**
 * Body schema for POST /api/notes. Le contexte (perso / groupe) est porté par
 * `?context=profile|group`, miroir POST /api/finance/projects. `kind` absent
 * ⇒ `note` (clients d'avant les onglets).
 */
export const createNoteBodySchema = noteFormSchema.extend({
  kind: noteKindSchema.default('note'),
})

/**
 * Body schema for PUT /api/notes/[id] — l'un ou l'autre :
 * - `{ content }` : modifie le texte (tous les onglets) ;
 * - `{ checked }` : coche / décoche un article de courses.
 * L'onglet d'une note ne change jamais.
 */
export const updateNoteBodySchema = z.union([noteFormSchema, z.object({ checked: z.boolean() })])

export type CreateNoteBody = z.infer<typeof createNoteBodySchema>
export type UpdateNoteBody = z.infer<typeof updateNoteBodySchema>
