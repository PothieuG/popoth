import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API GET /api/monthly-recap/status
 *
 * Vérifie si un récapitulatif mensuel est requis pour l'utilisateur
 * Supporte les contextes profile et group via paramètre ?context=
 *
 * Retourne:
 * - required: boolean - Si un récap est nécessaire
 * - currentMonth: number - Mois actuel
 * - currentYear: number - Année actuelle
 * - hasExistingRecap: boolean - Si un récap existe déjà
 * - context: string - Contexte utilisé (profile/group)
 */
export async function GET(request: NextRequest) {
  try {
    // Validation de la session
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json(
        { error: 'Session invalide' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') || 'profile'

    // Validation du contexte
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    const userId = sessionData.userId
    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1
    const currentYear = currentDate.getFullYear()
    const currentDay = currentDate.getDate()

    // Récupérer le profil utilisateur pour obtenir le group_id si nécessaire
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profil utilisateur non trouvé' },
        { status: 404 }
      )
    }

    let hasExistingRecap = false
    let contextId: string

    if (context === 'profile') {
      contextId = profile.id

      // Vérifier si un récap profile existe pour ce mois
      const { data: existingRecap } = await supabaseServer
        .from('monthly_recaps')
        .select('id')
        .eq('profile_id', profile.id)
        .eq('recap_month', currentMonth)
        .eq('recap_year', currentYear)
        .single()

      hasExistingRecap = !!existingRecap

    } else if (context === 'group') {
      if (!profile.group_id) {
        return NextResponse.json(
          { error: 'Utilisateur ne fait partie d\'aucun groupe' },
          { status: 400 }
        )
      }

      contextId = profile.group_id

      // Vérifier si un récap groupe existe pour ce mois
      const { data: existingRecap } = await supabaseServer
        .from('monthly_recaps')
        .select('id')
        .eq('group_id', profile.group_id)
        .eq('recap_month', currentMonth)
        .eq('recap_year', currentYear)
        .single()

      hasExistingRecap = !!existingRecap
    }

    // Un récap est requis si:
    // 1. On est le 1er du mois
    // 2. Aucun récap n'existe pour ce mois/contexte
    // const isFirstOfMonth = currentDay === 1
    const isFirstOfMonth = true
    const required = isFirstOfMonth && !hasExistingRecap

    console.log(`📅 [Monthly Recap Status] Context: ${context}, User: ${userId}`)
    console.log(`📅 [Monthly Recap Status] Date: ${currentDay}/${currentMonth}/${currentYear}`)
    console.log(`📅 [Monthly Recap Status] Required: ${required} (First of month: ${isFirstOfMonth}, Has existing: ${hasExistingRecap})`)

    return NextResponse.json({
      required,
      currentMonth,
      currentYear,
      currentDay,
      hasExistingRecap,
      context,
      contextId,
      isFirstOfMonth
    })

  } catch (error) {
    console.error('❌ Erreur lors de la vérification du statut du récap mensuel:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}