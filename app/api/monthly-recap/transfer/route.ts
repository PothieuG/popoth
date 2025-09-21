import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/monthly-recap/transfer
 *
 * Effectue un transfert d'économies entre budgets
 * Body: {
 *   context: 'profile' | 'group',
 *   from_budget_id: string,
 *   to_budget_id: string,
 *   amount: number,
 *   monthly_recap_id?: string (optionnel pour l'instant)
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
      from_budget_id,
      to_budget_id,
      amount,
      monthly_recap_id
    } = body

    // Validations
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    if (!from_budget_id || !to_budget_id || !amount) {
      return NextResponse.json(
        { error: 'from_budget_id, to_budget_id et amount sont requis' },
        { status: 400 }
      )
    }

    if (from_budget_id === to_budget_id) {
      return NextResponse.json(
        { error: 'Les budgets source et destination doivent être différents' },
        { status: 400 }
      )
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Le montant doit être positif' },
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

    // Vérifier que les deux budgets appartiennent au bon propriétaire
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount')
      .eq(ownerField, contextId)
      .in('id', [from_budget_id, to_budget_id])

    if (budgetsError || !budgets || budgets.length !== 2) {
      return NextResponse.json(
        { error: 'Un ou plusieurs budgets non trouvés ou non autorisés' },
        { status: 404 }
      )
    }

    const fromBudget = budgets.find(b => b.id === from_budget_id)
    const toBudget = budgets.find(b => b.id === to_budget_id)

    if (!fromBudget || !toBudget) {
      return NextResponse.json(
        { error: 'Budgets non trouvés' },
        { status: 404 }
      )
    }

    // Calculer les montants dépensés réels pour chaque budget
    const { data: fromExpenses, error: fromExpensesError } = await supabaseServer
      .from('real_expenses')
      .select('amount')
      .eq('estimated_budget_id', from_budget_id)
      .eq(ownerField, contextId)

    const { data: toExpenses, error: toExpensesError } = await supabaseServer
      .from('real_expenses')
      .select('amount')
      .eq('estimated_budget_id', to_budget_id)
      .eq(ownerField, contextId)

    if (fromExpensesError || toExpensesError) {
      return NextResponse.json(
        { error: 'Erreur lors du calcul des dépenses' },
        { status: 500 }
      )
    }

    // Calculer les montants dépensés réels
    const fromSpentAmount = (fromExpenses || []).reduce((sum, expense) => sum + parseFloat(expense.amount), 0)
    const toSpentAmount = (toExpenses || []).reduce((sum, expense) => sum + parseFloat(expense.amount), 0)

    // Calculer le surplus disponible du budget source
    const fromBudgetSurplus = Math.max(0, fromBudget.estimated_amount - fromSpentAmount)

    if (fromBudgetSurplus < amount) {
      return NextResponse.json(
        {
          error: `Budget source "${fromBudget.name}" n'a que ${fromBudgetSurplus.toFixed(2)}€ de surplus disponible`
        },
        { status: 400 }
      )
    }

    // Effectuer le transfert
    console.log(`💸 [Budget Transfer] ${fromBudget.name} → ${toBudget.name}: ${amount}€`)
    console.log(`📊 [Transfer Debug] From: ${fromSpentAmount}€/${fromBudget.estimated_amount}€ (surplus: ${fromBudgetSurplus}€)`)
    console.log(`📊 [Transfer Debug] To: ${toSpentAmount}€/${toBudget.estimated_amount}€`)

    // Enregistrer le transfert dans la table budget_transfers
    // Cela nous permet de calculer les ajustements sans modifier real_expenses
    const { error: transferInsertError } = await supabaseServer
      .from('budget_transfers')
      .insert({
        [ownerField]: contextId,
        from_budget_id,
        to_budget_id,
        transfer_amount: amount,
        transfer_reason: 'Manual transfer via monthly recap',
        transfer_date: new Date().toISOString().split('T')[0],
        monthly_recap_id: monthly_recap_id || null
      })

    if (transferInsertError) {
      console.error('❌ Erreur lors de l\'enregistrement du transfert:', transferInsertError)
      return NextResponse.json(
        { error: 'Erreur lors de l\'enregistrement du transfert' },
        { status: 500 }
      )
    }

    console.log(`✅ Transfert enregistré: ${amount}€ de "${fromBudget.name}" vers "${toBudget.name}"`)

    // Calculer les nouveaux montants après transfert
    const newFromSpentAmount = fromSpentAmount + amount
    const newToSpentAmount = toSpentAmount - amount
    const newFromSurplus = Math.max(0, fromBudget.estimated_amount - newFromSpentAmount)
    const newToSurplus = Math.max(0, toBudget.estimated_amount - newToSpentAmount)
    const newFromDeficit = Math.max(0, newFromSpentAmount - fromBudget.estimated_amount)
    const newToDeficit = Math.max(0, newToSpentAmount - toBudget.estimated_amount)

    console.log(`✅ [Budget Transfer] Transfert terminé: ${amount}€ de "${fromBudget.name}" vers "${toBudget.name}"`)
    console.log(`📊 [Transfer Result] From: ${newFromSpentAmount}€/${fromBudget.estimated_amount}€ (surplus: ${newFromSurplus}€, deficit: ${newFromDeficit}€)`)
    console.log(`📊 [Transfer Result] To: ${newToSpentAmount}€/${toBudget.estimated_amount}€ (surplus: ${newToSurplus}€, deficit: ${newToDeficit}€)`)

    return NextResponse.json({
      success: true,
      message: `${amount}€ transférés de "${fromBudget.name}" vers "${toBudget.name}"`,
      transfer: {
        from_budget: {
          id: fromBudget.id,
          name: fromBudget.name,
          previous_spent: fromSpentAmount,
          new_spent: newFromSpentAmount,
          estimated_amount: fromBudget.estimated_amount,
          new_surplus: newFromSurplus,
          new_deficit: newFromDeficit
        },
        to_budget: {
          id: toBudget.id,
          name: toBudget.name,
          previous_spent: toSpentAmount,
          new_spent: newToSpentAmount,
          estimated_amount: toBudget.estimated_amount,
          new_surplus: newToSurplus,
          new_deficit: newToDeficit
        },
        amount
      }
    })

  } catch (error) {
    console.error('❌ Erreur lors du transfert entre budgets:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}