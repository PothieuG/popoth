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

    const isV2 = snapshotData.snapshot_version === 2

    if (!snapshotData || !snapshotData.estimated_incomes || !snapshotData.estimated_budgets) {
      return NextResponse.json(
        { error: 'Données du snapshot corrompues ou incomplètes' },
        { status: 500 }
      )
    }

    console.log(`🔄 [Recovery] Version du snapshot: ${isV2 ? 'v2 (complet)' : 'v1 (legacy)'}`)

    // Commencer la récupération des données
    const recoveryResults: Record<string, any> = {
      estimated_incomes: 0,
      estimated_budgets: 0,
      real_incomes: 0,
      real_expenses: 0,
      bank_balance: false,
      piggy_bank: false,
      budget_transfers: 0,
      errors: [] as string[]
    }

    // Helper: supprimer + réinsérer une table complète
    const restoreTable = async (
      tableName: string,
      data: any[] | null | undefined,
      resultKey: string,
      filterField?: string,
      filterId?: string
    ) => {
      if (!data || data.length === 0) return

      const deleteFilter = filterField || ownerField
      const deleteId = filterId || contextId

      const { error: deleteError } = await supabaseServer
        .from(tableName)
        .delete()
        .eq(deleteFilter, deleteId)

      if (deleteError) {
        recoveryResults.errors.push(`Erreur suppression ${tableName}: ${deleteError.message}`)
        return
      }

      const { error: insertError } = await supabaseServer
        .from(tableName)
        .insert(data)

      if (insertError) {
        recoveryResults.errors.push(`Erreur restauration ${tableName}: ${insertError.message}`)
      } else {
        recoveryResults[resultKey] = data.length
      }
    }

    try {
      // 1. Restaurer les revenus estimés
      await restoreTable(
        'estimated_incomes',
        snapshotData.estimated_incomes,
        'estimated_incomes'
      )

      // 2. Restaurer les budgets estimés
      await restoreTable(
        'estimated_budgets',
        snapshotData.estimated_budgets,
        'estimated_budgets'
      )

      // 3. Restaurer les revenus réels
      await restoreTable(
        'real_income_entries',
        snapshotData.real_income_entries,
        'real_incomes'
      )

      // 4. Restaurer les dépenses réelles
      await restoreTable(
        'real_expenses',
        snapshotData.real_expenses,
        'real_expenses'
      )

      // 5. Restaurer les soldes bancaires
      if (isV2 && snapshotData.bank_balances && snapshotData.bank_balances.length > 0) {
        // V2 : restauration complète des bank_balances (avec current_remaining_to_live)
        await restoreTable(
          'bank_balances',
          snapshotData.bank_balances,
          'bank_balance'
        )
      } else if (typeof snapshotData.bank_balance === 'number') {
        // V1 : mise à jour simple du montant
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

      // 6. Restaurer la tirelire (v2 uniquement)
      if (isV2 && snapshotData.piggy_bank && snapshotData.piggy_bank.length > 0) {
        await restoreTable(
          'piggy_bank',
          snapshotData.piggy_bank,
          'piggy_bank'
        )
      }

      // 7. Restaurer les transferts de budget (v2 uniquement)
      if (isV2 && snapshotData.budget_transfers && snapshotData.budget_transfers.length > 0) {
        await restoreTable(
          'budget_transfers',
          snapshotData.budget_transfers,
          'budget_transfers'
        )
      }

      // 8. Désactiver le snapshot utilisé
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