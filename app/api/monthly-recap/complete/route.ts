import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/monthly-recap/complete
 *
 * Finalise le récapitulatif mensuel:
 * 1. Valide et enregistre le récap en base
 * 2. Reset les revenus estimés à 0
 * 3. Met à jour les colonnes de dernier récap
 * 4. Invalide le cache financier
 *
 * Body: {
 *   context: 'profile' | 'group',
 *   snapshot_id: string,
 *   remaining_to_live_choice: {
 *     action: 'carry_forward' | 'deduct_from_budget',
 *     budget_id?: string, // requis si action = 'deduct_from_budget'
 *     final_amount: number
 *   }
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
    const {
      context = 'profile',
      snapshot_id,
      remaining_to_live_choice
    } = body

    // Validations
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    if (!snapshot_id || !remaining_to_live_choice) {
      return NextResponse.json(
        { error: 'snapshot_id et remaining_to_live_choice sont requis' },
        { status: 400 }
      )
    }

    const { action, budget_id, final_amount } = remaining_to_live_choice

    if (!['carry_forward', 'deduct_from_budget'].includes(action)) {
      return NextResponse.json(
        { error: 'Action invalide. Utilisez "carry_forward" ou "deduct_from_budget"' },
        { status: 400 }
      )
    }

    if (action === 'deduct_from_budget' && !budget_id) {
      return NextResponse.json(
        { error: 'budget_id requis pour l\'action "deduct_from_budget"' },
        { status: 400 }
      )
    }

    if (typeof final_amount !== 'number') {
      return NextResponse.json(
        { error: 'final_amount doit être un nombre' },
        { status: 400 }
      )
    }

    const userId = sessionData.userId
    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1
    const currentYear = currentDate.getFullYear()

    // Récupérer le profil utilisateur
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id, first_name, last_name')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profil utilisateur non trouvé' },
        { status: 404 }
      )
    }

    const contextId = context === 'profile' ? profile.id : profile.group_id

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: 'Utilisateur ne fait partie d\'aucun groupe' },
        { status: 400 }
      )
    }

    // Vérifier que le snapshot appartient au bon utilisateur/groupe
    const snapshotOwnerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: snapshot, error: snapshotError } = await supabaseServer
      .from('recap_snapshots')
      .select('id, snapshot_data')
      .eq('id', snapshot_id)
      .eq(snapshotOwnerField, contextId)
      .eq('is_active', true)
      .single()

    if (snapshotError || !snapshot) {
      return NextResponse.json(
        { error: 'Snapshot non trouvé ou non autorisé' },
        { status: 404 }
      )
    }

    // Récupérer les données initiales du snapshot
    const snapshotData = snapshot.snapshot_data as any
    const initialRemainingToLive = snapshotData.financial_data?.remainingToLive || 0

    console.log(`🏁 [Monthly Recap Complete] Finalisation pour ${context}:${contextId}`)
    console.log(`🏁 [Monthly Recap Complete] Reste à vivre initial: ${initialRemainingToLive}€`)
    console.log(`🏁 [Monthly Recap Complete] Reste à vivre final: ${final_amount}€`)
    console.log(`🏁 [Monthly Recap Complete] Action: ${action}`)

    // Calculer les totaux de surplus/déficit actuels
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: currentBudgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, monthly_surplus, monthly_deficit')
      .eq(ownerField, contextId)

    if (budgetsError) {
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des budgets' },
        { status: 500 }
      )
    }

    const totalSurplus = currentBudgets?.reduce((sum, b) => sum + (b.monthly_surplus || 0), 0) || 0
    const totalDeficit = currentBudgets?.reduce((sum, b) => sum + (b.monthly_deficit || 0), 0) || 0

    // Préparer les données du récap
    const recapData: any = {
      recap_month: currentMonth,
      recap_year: currentYear,
      initial_remaining_to_live: initialRemainingToLive,
      final_remaining_to_live: final_amount,
      total_surplus: totalSurplus,
      total_deficit: totalDeficit,
      completed_at: new Date().toISOString()
    }

    // Déterminer la source du reste à vivre
    if (action === 'carry_forward') {
      recapData.remaining_to_live_source = 'carried_forward'
      recapData.remaining_to_live_amount = initialRemainingToLive
    } else {
      // Récupérer le nom du budget utilisé
      const budget = currentBudgets?.find(b => b.id === budget_id)
      if (!budget) {
        return NextResponse.json(
          { error: 'Budget spécifié non trouvé' },
          { status: 404 }
        )
      }
      recapData.remaining_to_live_source = `from_budget_${budget.name}`
      recapData.remaining_to_live_amount = final_amount
    }

    // Ajouter le bon champ propriétaire
    if (context === 'profile') {
      recapData.profile_id = contextId
    } else {
      recapData.group_id = contextId
    }

    // Démarrer une transaction
    try {
      // 1. Insérer le récap mensuel
      const { data: monthlyRecap, error: recapError } = await supabaseServer
        .from('monthly_recaps')
        .insert(recapData)
        .select('id')
        .single()

      if (recapError) {
        console.error('❌ Erreur lors de l\'insertion du récap:', recapError)
        return NextResponse.json(
          { error: 'Erreur lors de la sauvegarde du récap' },
          { status: 500 }
        )
      }

      // 2. Reset des revenus estimés (les mettre à 0)
      const { error: incomeResetError } = await supabaseServer
        .from('estimated_incomes')
        .update({
          estimated_amount: 0,
          updated_at: new Date().toISOString()
        })
        .eq(ownerField, contextId)

      if (incomeResetError) {
        console.error('❌ Erreur lors du reset des revenus:', incomeResetError)
        // Ne pas faire échouer la transaction pour ça, juste logger
      }

      // 3. Mettre à jour la date de dernière mise à jour mensuelle des budgets
      const { error: budgetUpdateError } = await supabaseServer
        .from('estimated_budgets')
        .update({
          last_monthly_update: currentDate.toISOString().split('T')[0], // Format YYYY-MM-DD
          updated_at: new Date().toISOString()
        })
        .eq(ownerField, contextId)

      if (budgetUpdateError) {
        console.error('❌ Erreur lors de la mise à jour des budgets:', budgetUpdateError)
        // Ne pas faire échouer la transaction pour ça, juste logger
      }

      // 4. Désactiver le snapshot (marquer comme utilisé)
      const { error: snapshotUpdateError } = await supabaseServer
        .from('recap_snapshots')
        .update({ is_active: false })
        .eq('id', snapshot_id)

      if (snapshotUpdateError) {
        console.error('❌ Erreur lors de la mise à jour du snapshot:', snapshotUpdateError)
        // Ne pas faire échouer pour ça non plus
      }

      console.log(`✅ [Monthly Recap Complete] Récap mensuel finalisé avec ID: ${monthlyRecap.id}`)

      // 5. Invalider le cache financier (appel à l'API dashboard pour vider le cache)
      try {
        const baseUrl = request.nextUrl.origin
        const cacheInvalidateUrl = `${baseUrl}/api/financial/dashboard?context=${context}&invalidate_cache=true`

        await fetch(cacheInvalidateUrl, {
          method: 'GET',
          headers: {
            'Cookie': request.headers.get('Cookie') || ''
          }
        })

        console.log(`🔄 [Monthly Recap Complete] Cache financier invalidé pour ${context}`)
      } catch (cacheError) {
        console.error('⚠️ Erreur lors de l\'invalidation du cache:', cacheError)
        // Ne pas faire échouer pour ça
      }

      // Préparer le résumé final
      const summary = {
        recap_id: monthlyRecap.id,
        initial_remaining_to_live: initialRemainingToLive,
        final_remaining_to_live: final_amount,
        action_taken: action,
        budget_used: action === 'deduct_from_budget' ? currentBudgets?.find(b => b.id === budget_id)?.name : null,
        total_surplus: totalSurplus,
        total_deficit: totalDeficit,
        incomes_reset: true,
        month: currentMonth,
        year: currentYear,
        completed_at: recapData.completed_at
      }

      return NextResponse.json({
        success: true,
        message: 'Récapitulatif mensuel finalisé avec succès',
        summary,
        redirect_to_dashboard: true
      })

    } catch (transactionError) {
      console.error('❌ Erreur lors de la transaction de finalisation:', transactionError)
      return NextResponse.json(
        { error: 'Erreur lors de la finalisation du récap' },
        { status: 500 }
      )
    }

  } catch (error) {
    console.error('❌ Erreur lors de la finalisation du récap mensuel:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}