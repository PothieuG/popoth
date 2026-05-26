import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { asContextFilter } from '@/lib/finance'
import {
  createSavingsProject,
  deleteSavingsProjectToPiggy,
  listSavingsProjects,
  updateSavingsProject,
} from '@/lib/finance/projects'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { createProjectBodySchema, updateProjectBodySchema } from '@/lib/schemas/projects'
import { contextSchema, estimatedListQuerySchema, uuidSchema } from '@/lib/schemas/common'
import { logger } from '@/lib/logger'

interface RouteParams {
  id: string
}

/**
 * GET /api/finance/projects - Liste les projets d'épargne de l'utilisateur
 * (perso) ou du groupe quand `?group=true`.
 *
 * Pattern miroir GET /api/finance/budgets/estimated : la même primitive
 * `estimatedListQuerySchema` (`?group=true|false` coerce → boolean) est
 * réutilisée pour l'UI de l'onglet "Projet" (sprint 04+).
 */
export const GET = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { group: forGroup } = estimatedListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    )

    if (forGroup) {
      if (!profile.group_id) {
        return NextResponse.json({ projects: [] })
      }
      const projects = await listSavingsProjects({ group_id: profile.group_id })
      return NextResponse.json({ projects })
    }

    const projects = await listSavingsProjects({ profile_id: userId })
    return NextResponse.json({ projects })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('Error fetching savings projects:', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

/**
 * POST /api/finance/projects - Crée un nouveau projet d'épargne.
 *
 * Le contexte est porté par `?context=profile|group` (default 'profile')
 * miroir POST /api/finance/budgets. Le serveur valide que le user a un
 * groupe si `context=group`, puis délègue à la RPC atomique
 * `create_savings_project` via le helper TS.
 */
export const POST = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const contextRaw = new URL(request.url).searchParams.get('context')
    const context = contextSchema.parse(contextRaw ?? 'profile')

    const body = await parseBody(request, createProjectBodySchema)

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: "Vous devez faire partie d'un groupe pour créer un projet de groupe" },
        { status: 400 },
      )
    }

    const filter = context === 'group' ? { group_id: profile.group_id! } : { profile_id: userId }

    const project = await createSavingsProject(filter, {
      name: body.name,
      targetAmount: body.targetAmount,
      monthlyAllocation: body.monthlyAllocation,
      deadlineDate: body.deadlineDate,
    })

    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    logger.error('Error creating savings project:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
})

/**
 * PUT /api/finance/projects/[id] - Met à jour les champs éditables d'un
 * projet (name, target, monthly, deadline). amount_saved et
 * pending_delay_fraction sont préservés (mutés uniquement par la RPC
 * recap apply et la RPC delete-to-piggy).
 *
 * Ownership : ON résout le owner (profile_id|group_id) depuis la row
 * SELECT verrouillée par `.or(ownershipCondition)` (profile_id=userId OU
 * group_id=profile.group_id quand applicable) — pattern miroir budgets
 * PUT. La RPC re-check ensuite l'ownership via son WHERE clause.
 */
export const PUT = withAuthAndProfile<RouteParams>(
  async (request: NextRequest, { userId, profile }, routeContext) => {
    try {
      const { id } = await routeContext.params
      const projectId = uuidSchema.parse(id)

      const body = await parseBody(request, updateProjectBodySchema)

      let ownershipCondition = `profile_id.eq.${userId}`
      if (profile.group_id) {
        ownershipCondition += `,group_id.eq.${profile.group_id}`
      }

      const { data: existingProject } = await supabaseServer
        .from('savings_projects')
        .select('id, profile_id, group_id')
        .eq('id', projectId)
        .or(ownershipCondition)
        .single()

      if (!existingProject) {
        return NextResponse.json(
          { error: 'Projet non trouvé ou accès non autorisé' },
          { status: 404 },
        )
      }

      const filter = asContextFilter({
        profile_id: existingProject.profile_id,
        group_id: existingProject.group_id,
      })

      const project = await updateSavingsProject(filter, {
        id: projectId,
        name: body.name,
        targetAmount: body.targetAmount,
        monthlyAllocation: body.monthlyAllocation,
        deadlineDate: body.deadlineDate,
      })

      return NextResponse.json({ project })
    } catch (error) {
      const handled = handleBadRequest(error)
      if (handled) return handled
      logger.error('Error updating savings project:', error)
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }
  },
)

/**
 * DELETE /api/finance/projects/[id] - Supprime un projet d'épargne et
 * transfère `amount_saved` vers la tirelire en 1 transaction PG via la
 * RPC composite `delete_savings_project_to_piggy`. Réponse :
 * `{ message, transferredAmount, piggyAmount }` (snackbar UI sprint 04+).
 *
 * Ownership lookup identique à PUT (filter résolu depuis la row).
 */
export const DELETE = withAuthAndProfile<RouteParams>(
  async (_request: NextRequest, { userId, profile }, routeContext) => {
    try {
      const { id } = await routeContext.params
      const projectId = uuidSchema.parse(id)

      let ownershipCondition = `profile_id.eq.${userId}`
      if (profile.group_id) {
        ownershipCondition += `,group_id.eq.${profile.group_id}`
      }

      const { data: existingProject } = await supabaseServer
        .from('savings_projects')
        .select('id, profile_id, group_id')
        .eq('id', projectId)
        .or(ownershipCondition)
        .single()

      if (!existingProject) {
        return NextResponse.json(
          { error: 'Projet non trouvé ou accès non autorisé' },
          { status: 404 },
        )
      }

      const filter = asContextFilter({
        profile_id: existingProject.profile_id,
        group_id: existingProject.group_id,
      })

      const { transferred_amount, piggy_amount } = await deleteSavingsProjectToPiggy(
        filter,
        projectId,
      )

      return NextResponse.json({
        message: 'Projet supprimé avec succès',
        transferredAmount: Number(transferred_amount),
        piggyAmount: piggy_amount !== null ? Number(piggy_amount) : null,
      })
    } catch (error) {
      const handled = handleBadRequest(error)
      if (handled) return handled
      logger.error('Error deleting savings project:', error)
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }
  },
)
