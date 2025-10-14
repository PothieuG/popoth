import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

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
export async function POST(request: NextRequest) {
  try {
    // Validation de la session
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json(
        { error: 'Session invalide' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { context = 'profile', amount } = body

    // Validation du contexte
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    // Validation du montant
    if (typeof amount !== 'number' || amount < 0) {
      return NextResponse.json(
        { error: 'Montant invalide' },
        { status: 400 }
      )
    }

    const userId = sessionData.userId

    // Récupérer le profil utilisateur
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profil utilisateur introuvable' },
        { status: 404 }
      )
    }

    // Déterminer le contexte (profile ou group)
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const contextId = context === 'profile' ? userId : profile.group_id

    if (!contextId) {
      return NextResponse.json(
        { error: `${context} introuvable` },
        { status: 404 }
      )
    }

    console.log(`🐷 [Accumulate Piggy Bank] Démarrage pour ${context}:${contextId}`)
    console.log(`🐷 [Accumulate Piggy Bank] Montant à ajouter: ${amount}€`)

    // Si le montant est 0, on ne fait rien
    if (amount === 0) {
      console.log(`🐷 [Accumulate Piggy Bank] Montant nul, aucune action nécessaire`)
      return NextResponse.json({
        success: true,
        message: 'Aucun surplus à ajouter à la tirelire',
        old_amount: 0,
        added_amount: 0,
        new_amount: 0
      })
    }

    // Récupérer la tirelire existante
    const { data: piggyBankData, error: fetchError } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .eq(ownerField, contextId)
      .maybeSingle()

    if (fetchError) {
      console.error('❌ [Accumulate Piggy Bank] Erreur lors de la récupération de la tirelire:', fetchError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération de la tirelire' },
        { status: 500 }
      )
    }

    const oldAmount = piggyBankData?.amount || 0
    const newAmount = oldAmount + amount

    if (piggyBankData) {
      // Mettre à jour la tirelire existante
      const { error: updateError } = await supabaseServer
        .from('piggy_bank')
        .update({
          amount: newAmount
        })
        .eq(ownerField, contextId)

      if (updateError) {
        console.error('❌ [Accumulate Piggy Bank] Erreur lors de la mise à jour:', updateError)
        return NextResponse.json(
          { error: 'Erreur lors de la mise à jour de la tirelire' },
          { status: 500 }
        )
      }

      console.log(`✅ [Accumulate Piggy Bank] Tirelire mise à jour: ${oldAmount}€ + ${amount}€ = ${newAmount}€`)
    } else {
      // Créer une nouvelle entrée
      const { error: insertError } = await supabaseServer
        .from('piggy_bank')
        .insert({
          [ownerField]: contextId,
          amount: newAmount
        })

      if (insertError) {
        console.error('❌ [Accumulate Piggy Bank] Erreur lors de la création:', insertError)
        return NextResponse.json(
          { error: 'Erreur lors de la création de la tirelire' },
          { status: 500 }
        )
      }

      console.log(`✅ [Accumulate Piggy Bank] Tirelire créée: ${newAmount}€`)
    }

    return NextResponse.json({
      success: true,
      message: `${amount}€ ajoutés à la tirelire`,
      old_amount: oldAmount,
      added_amount: amount,
      new_amount: newAmount
    })

  } catch (error) {
    console.error('❌ [Accumulate Piggy Bank] Erreur:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
