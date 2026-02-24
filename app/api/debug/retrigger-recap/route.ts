import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/retrigger-recap
 *
 * Re-trigger le monthly recap en supprimant uniquement le recap du mois en cours
 * NE MODIFIE PAS les données financières (budgets, dépenses, revenus, tirelire, économies)
 */
export async function POST(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }

    const userId = sessionData.userId

    // Récupérer le contexte depuis le body (optionnel, défaut: profile)
    let context = 'profile'
    try {
      const body = await request.json()
      if (body.context === 'group') {
        context = 'group'
      }
    } catch {
      // Pas de body, on utilise le défaut
    }

    // Récupérer le profil
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }

    // Déterminer le contexte ID
    const contextId = context === 'group' && profile.group_id ? profile.group_id : profile.id
    const ownerField = context === 'group' && profile.group_id ? 'group_id' : 'profile_id'

    // Date actuelle
    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()

    console.log(`🔄 [RETRIGGER] Suppression du recap pour ${currentMonth}/${currentYear}`)
    console.log(`   Contexte: ${context}, ID: ${contextId}`)

    // Supprimer le monthly recap du mois en cours
    const { data: deletedRecaps, error: deleteError } = await supabaseServer
      .from('monthly_recaps')
      .delete()
      .eq(ownerField, contextId)
      .eq('recap_month', currentMonth)
      .eq('recap_year', currentYear)
      .select('id')

    if (deleteError) {
      console.error('❌ Erreur suppression recap:', deleteError)
      return NextResponse.json(
        { error: `Erreur suppression: ${deleteError.message}` },
        { status: 500 }
      )
    }

    const recapsDeleted = deletedRecaps?.length || 0

    // Désactiver les snapshots actifs pour ce contexte
    const { error: snapshotError } = await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq(ownerField, contextId)
      .eq('is_active', true)

    if (snapshotError) {
      console.warn('⚠️ Erreur désactivation snapshots:', snapshotError)
    }

    console.log(`✅ [RETRIGGER] ${recapsDeleted} recap(s) supprimé(s)`)

    return NextResponse.json({
      success: true,
      message: recapsDeleted > 0
        ? `Monthly recap de ${currentMonth}/${currentYear} supprimé - Actualisez la page`
        : `Aucun recap trouvé pour ${currentMonth}/${currentYear} - Monthly recap déjà prêt`,
      details: {
        context,
        contextId,
        month: currentMonth,
        year: currentYear,
        recaps_deleted: recapsDeleted,
        snapshots_deactivated: !snapshotError
      },
      data_preserved: [
        'estimated_budgets',
        'estimated_incomes',
        'real_expenses',
        'real_income_entries',
        'piggy_bank',
        'cumulated_savings'
      ]
    })

  } catch (error) {
    console.error('❌ [RETRIGGER] Erreur:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne' },
      { status: 500 }
    )
  }
}
