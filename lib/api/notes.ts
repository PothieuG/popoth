import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import type { Database } from '@/lib/database.types'
import { withAuthAndGroup } from '@/lib/api/with-auth'
import { parseBody, parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { createNoteBodySchema, updateNoteBodySchema } from '@/lib/schemas/notes'
import { contextOnlyQuerySchema, uuidSchema } from '@/lib/schemas/common'
import { logger } from '@/lib/logger'

type NoteInsert = Database['public']['Tables']['notes']['Insert']

interface RouteParams {
  id: string
}

/**
 * Colonnes renvoyées au client. Le JOIN `created_by` sert de repli pour les
 * initiales de l'auteur (membre parti du groupe) — hint FK obligatoire, la
 * table a 2 FK vers `profiles`. **Jamais `avatar_url` ici** (règle Part 42
 * §11) : l'avatar est résolu côté client depuis `useGroupMembers` / `useProfile`.
 */
export const NOTE_SELECT =
  'id, profile_id, group_id, created_by_profile_id, content, created_at, updated_at, created_by:profiles!notes_created_by_profile_id_fkey(id, first_name, last_name)'

/**
 * Condition d'accès à une note existante : la sienne (perso) ou celle de son
 * groupe. Les ids viennent du jeton de session (UUID), pas de l'utilisateur.
 */
function ownershipCondition(userId: string, groupId: string | null): string {
  return groupId ? `profile_id.eq.${userId},group_id.eq.${groupId}` : `profile_id.eq.${userId}`
}

const NOT_FOUND = { error: 'Note non trouvée ou accès non autorisé' }

/**
 * GET /api/notes?context=profile|group - Notes perso de l'utilisateur, ou
 * notes partagées de son groupe. Plus récentes d'abord.
 */
export const GET = withAuthAndGroup(async (request: NextRequest, { userId, groupId }) => {
  try {
    const { context } = parseQuery(request, contextOnlyQuerySchema)

    if (context === 'group' && !groupId) {
      return NextResponse.json({ notes: [] })
    }

    const query = supabaseServer.from('notes').select(NOTE_SELECT)
    const scoped =
      context === 'group' ? query.eq('group_id', groupId!) : query.eq('profile_id', userId)

    const { data, error } = await scoped.order('created_at', { ascending: false })
    if (error) throw error

    return NextResponse.json({ notes: data ?? [] })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('Error fetching notes:', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * POST /api/notes?context=profile|group - Crée une note. En groupe, elle est
 * visible et modifiable par tous les membres ; `created_by_profile_id` garde
 * la trace de son auteur (avatar affiché devant la note).
 */
export const POST = withAuthAndGroup(async (request: NextRequest, { userId, groupId }) => {
  try {
    const { context } = parseQuery(request, contextOnlyQuerySchema)
    const body = await parseBody(request, createNoteBodySchema)

    if (context === 'group' && !groupId) {
      return NextResponse.json(
        { error: "Vous devez faire partie d'un groupe pour ajouter une note de groupe" },
        { status: 400 },
      )
    }

    const payload: NoteInsert =
      context === 'group'
        ? { group_id: groupId!, created_by_profile_id: userId, content: body.content }
        : { profile_id: userId, created_by_profile_id: userId, content: body.content }

    const { data: note, error } = await supabaseServer
      .from('notes')
      .insert(payload)
      .select(NOTE_SELECT)
      .single()
    if (error) throw error

    return NextResponse.json({ note }, { status: 201 })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('Error creating note:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})

/**
 * PUT /api/notes/[id] - Modifie le contenu d'une note. L'auteur ne change pas
 * (set-once à l'INSERT, miroir `real_expenses.created_by_profile_id`).
 *
 * Contrôle d'accès et écriture en une seule requête : l'UPDATE est filtré par
 * `ownershipCondition`, 0 ligne touchée ⇒ 404 (note absente ou d'un autre
 * propriétaire — on ne distingue pas, pour ne pas révéler l'existence).
 */
export const PUT = withAuthAndGroup<RouteParams>(
  async (request: NextRequest, { userId, groupId }, routeContext) => {
    try {
      const { id } = await routeContext.params
      const noteId = uuidSchema.safeParse(id)
      if (!noteId.success) {
        return NextResponse.json(NOT_FOUND, { status: 404 })
      }

      const body = await parseBody(request, updateNoteBodySchema)

      const { data: note, error } = await supabaseServer
        .from('notes')
        .update({ content: body.content })
        .eq('id', noteId.data)
        .or(ownershipCondition(userId, groupId))
        .select(NOTE_SELECT)
        .maybeSingle()
      if (error) throw error

      if (!note) {
        return NextResponse.json(NOT_FOUND, { status: 404 })
      }

      return NextResponse.json({ note })
    } catch (error) {
      const handled = handleBadRequest(error)
      if (handled) return handled
      logger.error('Error updating note:', error)
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }
  },
)

/**
 * DELETE /api/notes/[id] - Supprime une note. Même contrôle d'accès que PUT :
 * n'importe quel membre du groupe peut supprimer une note partagée.
 */
export const DELETE = withAuthAndGroup<RouteParams>(
  async (_request: NextRequest, { userId, groupId }, routeContext) => {
    try {
      const { id } = await routeContext.params
      const noteId = uuidSchema.safeParse(id)
      if (!noteId.success) {
        return NextResponse.json(NOT_FOUND, { status: 404 })
      }

      const { data: deleted, error } = await supabaseServer
        .from('notes')
        .delete()
        .eq('id', noteId.data)
        .or(ownershipCondition(userId, groupId))
        .select('id')
        .maybeSingle()
      if (error) throw error

      if (!deleted) {
        return NextResponse.json(NOT_FOUND, { status: 404 })
      }

      return NextResponse.json({ message: 'Note supprimée' })
    } catch (error) {
      logger.error('Error deleting note:', error)
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }
  },
)
