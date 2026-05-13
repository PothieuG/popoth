import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { refreshRecapQuerySchema, updateRecapStepBodySchema } from '@/lib/schemas/recap'
import { logger } from '@/lib/logger'

/**
 * API POST/GET /api/monthly-recap/update-step
 *
 * POST: Met à jour l'étape courante dans la base de données
 * GET: Récupère l'étape courante depuis la base de données
 */

export const POST = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { context, session_id, current_step } = await parseBody(
      request,
      updateRecapStepBodySchema,
    )

    // Déterminer le contexte ID
    let contextId: string
    if (context === 'profile') {
      contextId = profile.id
    } else {
      if (!profile.group_id) {
        return NextResponse.json(
          { error: "Utilisateur ne fait partie d'aucun groupe" },
          { status: 400 },
        )
      }
      contextId = profile.group_id
    }

    // Extraire les informations du session_id (format validé par la refine du schema)
    const sessionParts = session_id.split('_')
    const sessionContext = sessionParts[0]
    const sessionContextId = sessionParts[1]
    const sessionMonth = parseInt(sessionParts[2] ?? '')
    const sessionYear = parseInt(sessionParts[3] ?? '')

    // Vérifier que la session correspond au contexte actuel
    if (sessionContext !== context || sessionContextId !== contextId) {
      return NextResponse.json(
        { error: 'session_id ne correspond pas au contexte actuel' },
        { status: 400 },
      )
    }

    // Créer ou mettre à jour l'enregistrement monthly_recap
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    // Vérifier s'il existe déjà un enregistrement pour ce mois
    const { data: existingRecap, error: checkError } = await supabaseServer
      .from('monthly_recaps')
      .select('id, current_step')
      .eq(ownerField, contextId)
      .eq('recap_month', sessionMonth)
      .eq('recap_year', sessionYear)
      .maybeSingle()

    if (checkError) {
      logger.error('Erreur lors de la vérification du récap existant:', checkError)
      return NextResponse.json(
        { error: 'Erreur lors de la vérification du récap existant' },
        { status: 500 },
      )
    }

    if (existingRecap) {
      // Mettre à jour l'étape existante
      const { error: updateError } = await supabaseServer
        .from('monthly_recaps')
        .update({ current_step })
        .eq('id', existingRecap.id)

      if (updateError) {
        logger.error("Erreur lors de la mise à jour de l'étape:", updateError)
        return NextResponse.json(
          { error: "Erreur lors de la mise à jour de l'étape" },
          { status: 500 },
        )
      }
    } else {
      // Créer un nouvel enregistrement en cours (pas encore complété)
      const insertData = {
        [ownerField]: contextId,
        recap_month: sessionMonth,
        recap_year: sessionYear,
        current_step,
        initial_remaining_to_live: 0, // Sera mis à jour lors de la completion
        final_remaining_to_live: 0, // Sera mis à jour lors de la completion
        completed_at: null, // Pas encore complété
      }

      const { error: insertError } = await supabaseServer.from('monthly_recaps').insert(insertData)

      if (insertError) {
        logger.error('Erreur lors de la création du récap en cours:', insertError)
        return NextResponse.json(
          { error: 'Erreur lors de la création du récap en cours' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({
      success: true,
      current_step,
      message: `Étape ${current_step} sauvegardée en base de données`,
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})

export const GET = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { context, session_id } = parseQuery(request, refreshRecapQuerySchema)

    // Déterminer le contexte ID
    let contextId: string
    if (context === 'profile') {
      contextId = profile.id
    } else {
      if (!profile.group_id) {
        return NextResponse.json(
          { error: "Utilisateur ne fait partie d'aucun groupe" },
          { status: 400 },
        )
      }
      contextId = profile.group_id
    }

    // Extraire les informations du session_id
    const sessionParts = session_id.split('_')
    if (sessionParts.length < 5) {
      return NextResponse.json({ error: 'Format de session_id invalide' }, { status: 400 })
    }

    const sessionContext = sessionParts[0]
    const sessionContextId = sessionParts[1]
    const sessionMonth = parseInt(sessionParts[2] ?? '')
    const sessionYear = parseInt(sessionParts[3] ?? '')

    // Vérifier que la session correspond au contexte actuel
    if (sessionContext !== context || sessionContextId !== contextId) {
      return NextResponse.json(
        { error: 'session_id ne correspond pas au contexte actuel' },
        { status: 400 },
      )
    }

    // Récupérer l'étape courante depuis la base de données
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: recap, error: fetchError } = await supabaseServer
      .from('monthly_recaps')
      .select('current_step, completed_at')
      .eq(ownerField, contextId)
      .eq('recap_month', sessionMonth)
      .eq('recap_year', sessionYear)
      .maybeSingle()

    if (fetchError) {
      logger.error("Erreur lors de la récupération de l'étape:", fetchError)
      return NextResponse.json(
        { error: "Erreur lors de la récupération de l'étape" },
        { status: 500 },
      )
    }

    // Si aucun récap en cours n'existe, commencer à l'étape 1
    const currentStep = recap?.current_step || 1
    const isCompleted = !!recap?.completed_at

    return NextResponse.json({
      success: true,
      current_step: currentStep,
      is_completed: isCompleted,
      message: `Étape ${currentStep} récupérée depuis la base de données`,
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
