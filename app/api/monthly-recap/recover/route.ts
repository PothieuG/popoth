import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import type { TablesInsert } from '@/lib/database.types'
import {
  isSnapshotV2,
  type SnapshotPayload,
} from '@/lib/recap-snapshot.types'
import { withAuthAndProfile } from '@/lib/api/with-auth'

// Tables that the recovery flow restores from a snapshot blob. Restoration
// follows a delete-by-owner + bulk-insert pattern, so each branch picks the
// matching TablesInsert<...> shape.
type RestorableTable =
  | 'estimated_incomes'
  | 'estimated_budgets'
  | 'real_income_entries'
  | 'real_expenses'
  | 'bank_balances'
  | 'piggy_bank'
  | 'budget_transfers'

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
export const POST = withAuthAndProfile(async (request, { profile }) => {
  try {
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

    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1
    const currentYear = currentDate.getFullYear()

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: 'Utilisateur ne fait partie d\'aucun groupe' },
        { status: 400 }
      )
    }

    const contextId: string = context === 'profile' ? profile.id : profile.group_id!

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

    const snapshotData = snapshot.snapshot_data as unknown as SnapshotPayload

    if (!snapshotData || !snapshotData.estimated_incomes || !snapshotData.estimated_budgets) {
      return NextResponse.json(
        { error: 'Données du snapshot corrompues ou incomplètes' },
        { status: 500 }
      )
    }

    console.log(`🔄 [Recovery] Version du snapshot: ${isSnapshotV2(snapshotData) ? 'v2 (complet)' : 'v1 (legacy)'}`)

    // Commencer la récupération des données
    const recoveryResults: {
      estimated_incomes: number
      estimated_budgets: number
      real_incomes: number
      real_expenses: number
      bank_balance: boolean
      piggy_bank: boolean
      budget_transfers: number
      errors: string[]
    } = {
      estimated_incomes: 0,
      estimated_budgets: 0,
      real_incomes: 0,
      real_expenses: 0,
      bank_balance: false,
      piggy_bank: false,
      budget_transfers: 0,
      errors: [] as string[]
    }

    // Helper: supprimer + réinsérer une table complète. Switch sur les 7
    // tables littérales — chaque branche garde le typage <Database> de bout
    // en bout (delete + insert), aucun cast au client.
    // bank_balance/piggy_bank exposent un flag boolean (sémantique v1) plutôt
    // qu'un compteur — le path v1 assigne `true` (route line 288), donc le
    // path v2 doit faire pareil pour qu'un consumer `=== true` soit cohérent.
    type CountKey = 'estimated_incomes' | 'estimated_budgets' | 'real_incomes' | 'real_expenses' | 'budget_transfers'
    type BooleanKey = 'bank_balance' | 'piggy_bank'
    type ResultKey = CountKey | BooleanKey
    const restoreTable = async (
      tableName: RestorableTable,
      data: unknown[] | null | undefined,
      resultKey: ResultKey
    ) => {
      if (!data || data.length === 0) return

      let deleteError: { message: string } | null = null
      let insertError: { message: string } | null = null

      switch (tableName) {
        case 'estimated_incomes':
          ({ error: deleteError } = await supabaseServer
            .from('estimated_incomes').delete().eq(ownerField, contextId))
          if (deleteError) break
          ({ error: insertError } = await supabaseServer
            .from('estimated_incomes')
            .insert(data as TablesInsert<'estimated_incomes'>[]))
          break
        case 'estimated_budgets':
          ({ error: deleteError } = await supabaseServer
            .from('estimated_budgets').delete().eq(ownerField, contextId))
          if (deleteError) break
          ({ error: insertError } = await supabaseServer
            .from('estimated_budgets')
            .insert(data as TablesInsert<'estimated_budgets'>[]))
          break
        case 'real_income_entries':
          ({ error: deleteError } = await supabaseServer
            .from('real_income_entries').delete().eq(ownerField, contextId))
          if (deleteError) break
          ({ error: insertError } = await supabaseServer
            .from('real_income_entries')
            .insert(data as TablesInsert<'real_income_entries'>[]))
          break
        case 'real_expenses':
          ({ error: deleteError } = await supabaseServer
            .from('real_expenses').delete().eq(ownerField, contextId))
          if (deleteError) break
          ({ error: insertError } = await supabaseServer
            .from('real_expenses')
            .insert(data as TablesInsert<'real_expenses'>[]))
          break
        case 'bank_balances':
          ({ error: deleteError } = await supabaseServer
            .from('bank_balances').delete().eq(ownerField, contextId))
          if (deleteError) break
          ({ error: insertError } = await supabaseServer
            .from('bank_balances')
            .insert(data as TablesInsert<'bank_balances'>[]))
          break
        case 'piggy_bank':
          ({ error: deleteError } = await supabaseServer
            .from('piggy_bank').delete().eq(ownerField, contextId))
          if (deleteError) break
          ({ error: insertError } = await supabaseServer
            .from('piggy_bank')
            .insert(data as TablesInsert<'piggy_bank'>[]))
          break
        case 'budget_transfers':
          ({ error: deleteError } = await supabaseServer
            .from('budget_transfers').delete().eq(ownerField, contextId))
          if (deleteError) break
          ({ error: insertError } = await supabaseServer
            .from('budget_transfers')
            .insert(data as TablesInsert<'budget_transfers'>[]))
          break
      }

      if (deleteError) {
        recoveryResults.errors.push(`Erreur suppression ${tableName}: ${deleteError.message}`)
        return
      }
      if (insertError) {
        recoveryResults.errors.push(`Erreur restauration ${tableName}: ${insertError.message}`)
      } else if (resultKey === 'bank_balance' || resultKey === 'piggy_bank') {
        recoveryResults[resultKey] = true
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
      if (isSnapshotV2(snapshotData) && snapshotData.bank_balances.length > 0) {
        // V2 : restauration complète des bank_balances (avec current_remaining_to_live)
        await restoreTable(
          'bank_balances',
          snapshotData.bank_balances,
          'bank_balance'
        )
      } else if (typeof snapshotData.bank_balance === 'number') {
        // V1 (ou V2 avec bank_balances vide) : mise à jour simple du montant
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
      if (isSnapshotV2(snapshotData) && snapshotData.piggy_bank.length > 0) {
        await restoreTable(
          'piggy_bank',
          snapshotData.piggy_bank,
          'piggy_bank'
        )
      }

      // 7. Restaurer les transferts de budget (v2 uniquement)
      if (isSnapshotV2(snapshotData) && snapshotData.budget_transfers.length > 0) {
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
})

/**
 * API GET /api/monthly-recap/recover
 *
 * Liste les snapshots disponibles pour récupération
 */
export const GET = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') || 'profile'

    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: 'Utilisateur ne fait partie d\'aucun groupe' },
        { status: 400 }
      )
    }

    const contextId: string = context === 'profile' ? profile.id : profile.group_id!

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
      formatted_date: snapshot.created_at ? new Date(snapshot.created_at).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) : '—'
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
})