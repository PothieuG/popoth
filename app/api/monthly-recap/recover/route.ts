import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/monthly-recap/recover
 *
 * Récupère les données depuis un snapshot de sécurité en cas de bug
 * ou d'interruption pendant le récapitulatif mensuel
 *
 * Body: {
 *   context: 'profile' | 'group',
 *   snapshot_id?: string, // Optionnel, prend le plus récent si non spécifié
 *   confirm: boolean // Protection pour éviter les récupérations accidentelles
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
      confirm = false
    } = body

    // Validations
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    if (!confirm) {
      return NextResponse.json(
        { error: 'La confirmation est requise pour effectuer une récupération' },
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
      .select('id, group_id')
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

    // Récupérer le snapshot approprié
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    let snapshotQuery = supabaseServer
      .from('recap_snapshots')
      .select('id, snapshot_data, created_at')
      .eq(ownerField, contextId)
      .eq('snapshot_month', currentMonth)
      .eq('snapshot_year', currentYear)

    if (snapshot_id) {
      snapshotQuery = snapshotQuery.eq('id', snapshot_id)
    } else {
      snapshotQuery = snapshotQuery.order('created_at', { ascending: false }).limit(1)
    }

    const { data: snapshot, error: snapshotError } = await snapshotQuery.single()

    if (snapshotError || !snapshot) {
      return NextResponse.json(
        { error: 'Aucun snapshot de récupération trouvé pour ce mois' },
        { status: 404 }
      )
    }

    console.log(`🔄 [Monthly Recap Recovery] Début de la récupération pour ${context}:${contextId}`)
    console.log(`🔄 [Monthly Recap Recovery] Snapshot: ${snapshot.id} du ${snapshot.created_at}`)

    const snapshotData = snapshot.snapshot_data as any

    if (!snapshotData || !snapshotData.estimated_incomes || !snapshotData.estimated_budgets) {
      return NextResponse.json(
        { error: 'Données du snapshot corrompues ou incomplètes' },
        { status: 500 }
      )
    }

    // Commencer la récupération des données
    const recoveryResults = {
      estimated_incomes: 0,
      estimated_budgets: 0,
      real_incomes: 0,
      real_expenses: 0,
      bank_balance: false,
      errors: [] as string[]
    }

    try {
      // 1. Restaurer les revenus estimés
      if (snapshotData.estimated_incomes && snapshotData.estimated_incomes.length > 0) {
        // Supprimer les revenus estimés actuels
        const { error: deleteIncomesError } = await supabaseServer
          .from('estimated_incomes')
          .delete()
          .eq(ownerField, contextId)

        if (deleteIncomesError) {
          recoveryResults.errors.push(`Erreur suppression revenus estimés: ${deleteIncomesError.message}`)
        }

        // Restaurer les revenus estimés depuis le snapshot
        const incomesToRestore = snapshotData.estimated_incomes.map((income: any) => ({
          ...income,
          id: undefined, // Laisser la DB générer de nouveaux IDs
          created_at: undefined,
          updated_at: undefined
        }))

        const { error: insertIncomesError } = await supabaseServer
          .from('estimated_incomes')
          .insert(incomesToRestore)

        if (insertIncomesError) {
          recoveryResults.errors.push(`Erreur restauration revenus estimés: ${insertIncomesError.message}`)
        } else {
          recoveryResults.estimated_incomes = incomesToRestore.length
        }
      }

      // 2. Restaurer les budgets estimés
      if (snapshotData.estimated_budgets && snapshotData.estimated_budgets.length > 0) {
        // Supprimer les budgets estimés actuels
        const { error: deleteBudgetsError } = await supabaseServer
          .from('estimated_budgets')
          .delete()
          .eq(ownerField, contextId)

        if (deleteBudgetsError) {
          recoveryResults.errors.push(`Erreur suppression budgets estimés: ${deleteBudgetsError.message}`)
        }

        // Restaurer les budgets estimés depuis le snapshot
        const budgetsToRestore = snapshotData.estimated_budgets.map((budget: any) => ({
          ...budget,
          id: undefined, // Laisser la DB générer de nouveaux IDs
          created_at: undefined,
          updated_at: undefined,
          // Reset des colonnes mensuelles
          monthly_surplus: 0,
          monthly_deficit: 0,
          last_monthly_update: null
        }))

        const { error: insertBudgetsError } = await supabaseServer
          .from('estimated_budgets')
          .insert(budgetsToRestore)

        if (insertBudgetsError) {
          recoveryResults.errors.push(`Erreur restauration budgets estimés: ${insertBudgetsError.message}`)
        } else {
          recoveryResults.estimated_budgets = budgetsToRestore.length
        }
      }

      // 3. Restaurer les revenus réels (optionnel, peut être conservé)
      if (snapshotData.real_income_entries && snapshotData.real_income_entries.length > 0) {
        // Note: On pourrait choisir de ne PAS restaurer les transactions réelles
        // et seulement les données de planification. Pour l'instant, on les restaure.

        const { error: deleteRealIncomesError } = await supabaseServer
          .from('real_income_entries')
          .delete()
          .eq(ownerField, contextId)

        if (deleteRealIncomesError) {
          recoveryResults.errors.push(`Erreur suppression revenus réels: ${deleteRealIncomesError.message}`)
        }

        const realIncomesToRestore = snapshotData.real_income_entries.map((income: any) => ({
          ...income,
          id: undefined,
          created_at: undefined
        }))

        const { error: insertRealIncomesError } = await supabaseServer
          .from('real_income_entries')
          .insert(realIncomesToRestore)

        if (insertRealIncomesError) {
          recoveryResults.errors.push(`Erreur restauration revenus réels: ${insertRealIncomesError.message}`)
        } else {
          recoveryResults.real_incomes = realIncomesToRestore.length
        }
      }

      // 4. Restaurer les dépenses réelles (optionnel)
      if (snapshotData.real_expenses && snapshotData.real_expenses.length > 0) {
        const { error: deleteRealExpensesError } = await supabaseServer
          .from('real_expenses')
          .delete()
          .eq(ownerField, contextId)

        if (deleteRealExpensesError) {
          recoveryResults.errors.push(`Erreur suppression dépenses réelles: ${deleteRealExpensesError.message}`)
        }

        const realExpensesToRestore = snapshotData.real_expenses.map((expense: any) => ({
          ...expense,
          id: undefined,
          created_at: undefined
        }))

        const { error: insertRealExpensesError } = await supabaseServer
          .from('real_expenses')
          .insert(realExpensesToRestore)

        if (insertRealExpensesError) {
          recoveryResults.errors.push(`Erreur restauration dépenses réelles: ${insertRealExpensesError.message}`)
        } else {
          recoveryResults.real_expenses = realExpensesToRestore.length
        }
      }

      // 5. Restaurer le solde bancaire
      if (typeof snapshotData.bank_balance === 'number') {
        const { error: updateBankBalanceError } = await supabaseServer
          .from('bank_balances')
          .update({
            balance: snapshotData.bank_balance,
            updated_at: new Date().toISOString()
          })
          .eq(ownerField, contextId)

        if (updateBankBalanceError) {
          recoveryResults.errors.push(`Erreur restauration solde bancaire: ${updateBankBalanceError.message}`)
        } else {
          recoveryResults.bank_balance = true
        }
      }

      // 6. Désactiver le snapshot utilisé
      const { error: deactivateSnapshotError } = await supabaseServer
        .from('recap_snapshots')
        .update({ is_active: false })
        .eq('id', snapshot.id)

      if (deactivateSnapshotError) {
        console.warn('⚠️ Erreur lors de la désactivation du snapshot:', deactivateSnapshotError)
      }

      console.log(`✅ [Monthly Recap Recovery] Récupération terminée pour ${context}:${contextId}`)
      console.log(`✅ [Monthly Recap Recovery] Résultats:`, recoveryResults)

      return NextResponse.json({
        success: true,
        message: 'Récupération effectuée avec succès',
        snapshot_id: snapshot.id,
        snapshot_date: snapshot.created_at,
        recovery_results: recoveryResults,
        context,
        month: currentMonth,
        year: currentYear,
        has_errors: recoveryResults.errors.length > 0
      })

    } catch (recoveryError) {
      console.error('❌ Erreur lors de la récupération:', recoveryError)
      return NextResponse.json(
        {
          error: 'Erreur lors de la récupération des données',
          recovery_results: recoveryResults
        },
        { status: 500 }
      )
    }

  } catch (error) {
    console.error('❌ Erreur lors de la récupération du récap mensuel:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * API GET /api/monthly-recap/recover
 *
 * Liste les snapshots disponibles pour récupération
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

    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
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

    // Récupérer tous les snapshots disponibles
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: snapshots, error: snapshotsError } = await supabaseServer
      .from('recap_snapshots')
      .select('id, snapshot_month, snapshot_year, created_at, is_active')
      .eq(ownerField, contextId)
      .order('created_at', { ascending: false })
      .limit(10) // Limiter aux 10 plus récents

    if (snapshotsError) {
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des snapshots' },
        { status: 500 }
      )
    }

    const monthNames = [
      'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
    ]

    const formattedSnapshots = snapshots?.map(snapshot => ({
      id: snapshot.id,
      month: snapshot.snapshot_month,
      year: snapshot.snapshot_year,
      month_name: monthNames[snapshot.snapshot_month - 1],
      created_at: snapshot.created_at,
      is_active: snapshot.is_active,
      formatted_date: new Date(snapshot.created_at).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    })) || []

    return NextResponse.json({
      snapshots: formattedSnapshots,
      context,
      total_count: formattedSnapshots.length
    })

  } catch (error) {
    console.error('❌ Erreur lors de la récupération des snapshots:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}