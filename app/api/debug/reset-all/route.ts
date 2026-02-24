import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/reset-all
 *
 * Reset complet de toutes les données financières
 * Conserve: profiles, groups, user_profiles
 * Supprime: budgets, revenus, dépenses, transferts, recaps, tirelire, économies
 */
export async function POST(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }

    const userId = sessionData.userId
    console.log(`🗑️ [RESET ALL] Démarrage reset complet pour userId: ${userId}`)

    // Récupérer le profil pour avoir le group_id si besoin
    const { data: profile } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    const results: Record<string, string> = {}

    // 1. Supprimer les transferts de budget
    const { error: transfersError } = await supabaseServer
      .from('budget_transfers')
      .delete()
      .eq('profile_id', userId)
    results['budget_transfers'] = transfersError ? `❌ ${transfersError.message}` : '✅'

    // 2. Supprimer les dépenses réelles
    const { error: expensesError } = await supabaseServer
      .from('real_expenses')
      .delete()
      .eq('profile_id', userId)
    results['real_expenses'] = expensesError ? `❌ ${expensesError.message}` : '✅'

    // 3. Supprimer les revenus réels
    const { error: incomeEntriesError } = await supabaseServer
      .from('real_income_entries')
      .delete()
      .eq('profile_id', userId)
    results['real_income_entries'] = incomeEntriesError ? `❌ ${incomeEntriesError.message}` : '✅'

    // 4. Supprimer les budgets estimés
    const { error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .delete()
      .eq('profile_id', userId)
    results['estimated_budgets'] = budgetsError ? `❌ ${budgetsError.message}` : '✅'

    // 5. Supprimer les revenus estimés
    const { error: incomesError } = await supabaseServer
      .from('estimated_incomes')
      .delete()
      .eq('profile_id', userId)
    results['estimated_incomes'] = incomesError ? `❌ ${incomesError.message}` : '✅'

    // 6. Supprimer les monthly recaps
    const { error: recapsError } = await supabaseServer
      .from('monthly_recaps')
      .delete()
      .eq('profile_id', userId)
    results['monthly_recaps'] = recapsError ? `❌ ${recapsError.message}` : '✅'

    // 7. Désactiver les snapshots
    const { error: snapshotsError } = await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('profile_id', userId)
    results['recap_snapshots'] = snapshotsError ? `❌ ${snapshotsError.message}` : '✅ (désactivés)'

    // 8. Remettre la tirelire à 0
    const { error: piggyBankError } = await supabaseServer
      .from('piggy_bank')
      .update({ amount: 0, last_updated: new Date().toISOString() })
      .eq('profile_id', userId)
    results['piggy_bank'] = piggyBankError ? `❌ ${piggyBankError.message}` : '✅ (remise à 0€)'

    // 9. Remettre le solde bancaire à 0
    const { error: bankBalanceError } = await supabaseServer
      .from('bank_balances')
      .update({ balance: 0, updated_at: new Date().toISOString() })
      .eq('profile_id', userId)
    results['bank_balances'] = bankBalanceError ? `❌ ${bankBalanceError.message}` : '✅ (remis à 0€)'

    // Log des résultats
    console.log('📊 [RESET ALL] Résultats:')
    for (const [table, status] of Object.entries(results)) {
      console.log(`   ${table}: ${status}`)
    }

    const hasErrors = Object.values(results).some(r => r.startsWith('❌'))

    return NextResponse.json({
      success: !hasErrors,
      message: hasErrors ? 'Reset partiellement réussi' : 'Reset complet effectué',
      results,
      preserved: ['profiles', 'groups', 'user_profiles'],
      deleted: ['budget_transfers', 'real_expenses', 'real_income_entries', 'estimated_budgets', 'estimated_incomes', 'monthly_recaps'],
      reset: ['piggy_bank → 0€', 'bank_balances → 0€', 'recap_snapshots → inactive', 'remaining_to_live → 0€ (calculé)']
    })

  } catch (error) {
    console.error('❌ [RESET ALL] Erreur:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne' },
      { status: 500 }
    )
  }
}
