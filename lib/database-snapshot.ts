import { supabaseServer } from '@/lib/supabase-server'

/**
 * Crée un snapshot complet de toutes les données financières d'un utilisateur/groupe
 * avant de démarrer un monthly recap.
 *
 * Tables capturées :
 * - profiles (donnée utilisateur)
 * - estimated_incomes, estimated_budgets
 * - real_income_entries, real_expenses
 * - bank_balances, piggy_bank
 * - budget_transfers, monthly_recaps
 * - group_contributions (si contexte groupe)
 * - groups (si contexte groupe)
 * - remaining_to_live_snapshots (historique RAV)
 * - financial_snapshots (cache calculs)
 */
export async function createFullDatabaseSnapshot(
  contextId: string,
  context: 'profile' | 'group',
  snapshotMonth: number,
  snapshotYear: number
): Promise<{ snapshotId: string | null; error: string | null }> {
  const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

  try {
    // Récupérer toutes les tables en parallèle
    const [
      profiles,
      estimatedIncomes,
      estimatedBudgets,
      realIncomeEntries,
      realExpenses,
      bankBalances,
      piggyBank,
      financialSnapshots,
      budgetTransfers,
      monthlyRecaps,
      remainingToLiveSnapshots,
      groupData,
      groupContributions,
    ] = await Promise.all([
      // Profile(s) concerné(s)
      context === 'profile'
        ? supabaseServer.from('profiles').select('*').eq('id', contextId)
        : supabaseServer.from('profiles').select('*').eq('group_id', contextId),
      supabaseServer
        .from('estimated_incomes')
        .select('*')
        .eq(ownerField, contextId),
      supabaseServer
        .from('estimated_budgets')
        .select('*')
        .eq(ownerField, contextId),
      supabaseServer
        .from('real_income_entries')
        .select('*')
        .eq(ownerField, contextId),
      supabaseServer
        .from('real_expenses')
        .select('*')
        .eq(ownerField, contextId),
      supabaseServer
        .from('bank_balances')
        .select('*')
        .eq(ownerField, contextId),
      supabaseServer
        .from('piggy_bank')
        .select('*')
        .eq(ownerField, contextId),
      supabaseServer
        .from('financial_snapshots')
        .select('*')
        .eq(ownerField, contextId),
      supabaseServer
        .from('budget_transfers')
        .select('*')
        .eq(ownerField, contextId),
      supabaseServer
        .from('monthly_recaps')
        .select('*')
        .eq(ownerField, contextId),
      supabaseServer
        .from('remaining_to_live_snapshots')
        .select('*')
        .eq(ownerField, contextId)
        .order('created_at', { ascending: false })
        .limit(50),
      // Données groupe (seulement en contexte groupe)
      context === 'group'
        ? supabaseServer.from('groups').select('*').eq('id', contextId).single()
        : Promise.resolve({ data: null, error: null }),
      context === 'group'
        ? supabaseServer.from('group_contributions').select('*').eq('group_id', contextId)
        : Promise.resolve({ data: null, error: null }),
    ])

    // Log les erreurs non-bloquantes
    const warnings: string[] = []
    const checkError = (name: string, result: { error: any }) => {
      if (result.error) {
        warnings.push(`${name}: ${result.error.message}`)
        console.warn(`⚠️ [Snapshot] Erreur sur ${name}:`, result.error.message)
      }
    }

    checkError('profiles', profiles)
    checkError('estimated_incomes', estimatedIncomes)
    checkError('estimated_budgets', estimatedBudgets)
    checkError('real_income_entries', realIncomeEntries)
    checkError('real_expenses', realExpenses)
    checkError('bank_balances', bankBalances)
    checkError('piggy_bank', piggyBank)
    checkError('financial_snapshots', financialSnapshots)
    checkError('budget_transfers', budgetTransfers)
    checkError('monthly_recaps', monthlyRecaps)
    checkError('remaining_to_live_snapshots', remainingToLiveSnapshots)
    if (context === 'group') {
      checkError('groups', groupData)
      checkError('group_contributions', groupContributions)
    }

    const tableCounts = {
      profiles: profiles.data?.length ?? 0,
      estimated_incomes: estimatedIncomes.data?.length ?? 0,
      estimated_budgets: estimatedBudgets.data?.length ?? 0,
      real_income_entries: realIncomeEntries.data?.length ?? 0,
      real_expenses: realExpenses.data?.length ?? 0,
      bank_balances: bankBalances.data?.length ?? 0,
      piggy_bank: piggyBank.data?.length ?? 0,
      financial_snapshots: financialSnapshots.data?.length ?? 0,
      budget_transfers: budgetTransfers.data?.length ?? 0,
      monthly_recaps: monthlyRecaps.data?.length ?? 0,
      remaining_to_live_snapshots: remainingToLiveSnapshots.data?.length ?? 0,
      ...(context === 'group' ? {
        groups: groupData.data ? 1 : 0,
        group_contributions: groupContributions.data?.length ?? 0,
      } : {}),
    }

    // Construire le JSONB complet
    const snapshotData: Record<string, any> = {
      context,
      snapshot_version: 2,
      created_at: new Date().toISOString(),
      // Données utilisateur
      profiles: profiles.data || [],
      // Données financières principales
      estimated_incomes: estimatedIncomes.data || [],
      estimated_budgets: estimatedBudgets.data || [],
      real_income_entries: realIncomeEntries.data || [],
      real_expenses: realExpenses.data || [],
      // Soldes
      bank_balances: bankBalances.data || [],
      // Compat v1 du recover : bank_balance comme nombre simple
      bank_balance: bankBalances.data?.[0]?.balance ?? null,
      piggy_bank: piggyBank.data || [],
      // Snapshots et historique
      financial_snapshots: financialSnapshots.data || [],
      remaining_to_live_snapshots: remainingToLiveSnapshots.data || [],
      // Transferts et recaps existants
      budget_transfers: budgetTransfers.data || [],
      monthly_recaps: monthlyRecaps.data || [],
      // Métadonnées
      _warnings: warnings.length > 0 ? warnings : undefined,
      _table_counts: tableCounts,
    }

    // Ajouter les données groupe si applicable
    if (context === 'group') {
      snapshotData.groups = groupData.data ? [groupData.data] : []
      snapshotData.group_contributions = groupContributions.data || []
    }

    // Insérer le snapshot
    const insertData: Record<string, any> = {
      [ownerField]: contextId,
      snapshot_month: snapshotMonth,
      snapshot_year: snapshotYear,
      snapshot_data: snapshotData,
      is_active: true,
    }

    const { data: inserted, error: insertError } = await supabaseServer
      .from('recap_snapshots')
      .insert(insertData)
      .select('id')
      .single()

    if (insertError) {
      console.error('❌ [Snapshot] Erreur insertion snapshot:', insertError)
      return { snapshotId: null, error: insertError.message }
    }

    const totalRecords = Object.values(tableCounts).reduce(
      (sum, count) => sum + count,
      0
    )

    console.log(`📸 [Snapshot] Snapshot complet créé avec succès`)
    console.log(`📸 [Snapshot] ID: ${inserted.id}`)
    console.log(`📸 [Snapshot] Mois: ${snapshotMonth}/${snapshotYear}`)
    console.log(`📸 [Snapshot] Total enregistrements capturés: ${totalRecords}`)
    console.log(`📸 [Snapshot] Détail:`, tableCounts)

    return { snapshotId: inserted.id, error: null }
  } catch (err: any) {
    console.error('❌ [Snapshot] Erreur inattendue:', err)
    return { snapshotId: null, error: err.message || 'Erreur inattendue' }
  }
}
