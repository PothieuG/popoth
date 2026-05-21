import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import type { TablesInsert } from '@/lib/database.types'
import { updatePiggyBank } from '@/lib/finance/piggy-bank'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { accumulatePiggyBankBodySchema } from '@/lib/schemas/recap'
import { logger } from '@/lib/logger'

/**
 * API POST /api/monthly-recap/accumulate-piggy-bank
 *
 * Accumule le surplus de l'étape 1 dans la tirelire
 * Appelé quand l'utilisateur valide l'étape 1 et passe à l'étape 2
 *
 * Body: {
 *   context: 'profile' | 'group',
 *   amount: number  // Le montant à ajouter à la tirelire
 * }
 *
 * Returns: {
 *   success: true,
 *   old_amount: number,
 *   added_amount: number,
 *   new_amount: number
 * }
 */
export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context, amount } = await parseBody(request, accumulatePiggyBankBodySchema)

    // Déterminer le contexte (profile ou group)
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const contextId = context === 'profile' ? userId : profile.group_id

    if (!contextId) {
      return NextResponse.json({ error: `${context} introuvable` }, { status: 404 })
    }

    // Si le montant est 0, on ne fait rien
    if (amount === 0) {
      return NextResponse.json({
        success: true,
        message: 'Aucun surplus à ajouter à la tirelire',
        old_amount: 0,
        added_amount: 0,
        new_amount: 0,
      })
    }

    // Vérifier si la tirelire existe (insert sinon, sinon increment via RPC atomique)
    const { data: piggyBankData, error: fetchError } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .eq(ownerField, contextId)
      .maybeSingle()

    if (fetchError) {
      logger.error(
        '[Accumulate Piggy Bank] Erreur lors de la récupération de la tirelire:',
        fetchError,
      )
      return NextResponse.json(
        { error: 'Erreur lors de la récupération de la tirelire' },
        { status: 500 },
      )
    }

    const oldAmount = piggyBankData?.amount || 0
    let newAmount = oldAmount + amount

    if (piggyBankData) {
      try {
        const filter =
          ownerField === 'profile_id' ? { profile_id: contextId } : { group_id: contextId }
        newAmount = await updatePiggyBank(filter, amount)
      } catch (error) {
        logger.error('[Accumulate Piggy Bank] Erreur lors de la mise à jour:', error)
        return NextResponse.json(
          { error: 'Erreur lors de la mise à jour de la tirelire' },
          { status: 500 },
        )
      }
    } else {
      // Créer une nouvelle entrée (RPC ne crée pas la ligne)
      const insertPayload: TablesInsert<'piggy_bank'> =
        context === 'profile'
          ? { profile_id: contextId, amount: newAmount }
          : { group_id: contextId, amount: newAmount }
      const { error: insertError } = await supabaseServer.from('piggy_bank').insert(insertPayload)

      if (insertError) {
        logger.error('[Accumulate Piggy Bank] Erreur lors de la création:', insertError)
        return NextResponse.json(
          { error: 'Erreur lors de la création de la tirelire' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({
      success: true,
      message: `${amount}€ ajoutés à la tirelire`,
      old_amount: oldAmount,
      added_amount: amount,
      new_amount: newAmount,
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
