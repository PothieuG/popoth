import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { manualTransferBodySchema } from '@/lib/schemas/recap'
import { logger } from '@/lib/logger'

/**
 * API POST /api/monthly-recap/transfer
 *
 * Effectue un transfert manuel entre budgets
 *
 * FONCTIONNEMENT :
 * - Valide que le budget source a assez de surplus disponible
 * - Enregistre le transfert dans la table budget_transfers
 * - Les calculs de surplus/déficit sont automatiquement ajustés
 *   dans l'API step2-data qui prend en compte les transferts
 *
 * VALIDATION :
 * - Le montant ne peut pas dépasser le surplus du budget source
 * - Les deux budgets doivent appartenir au même propriétaire (profile/group)
 *
 * Body: {
 *   context: 'profile' | 'group',
 *   from_budget_id: string,
 *   to_budget_id: string,
 *   amount: number,
 *   monthly_recap_id?: string (optionnel)
 * }
 *
 * Returns: {
 *   success: true,
 *   transfer: {
 *     from_budget: { id, name, new_spent, new_surplus, new_deficit },
 *     to_budget: { id, name, new_spent, new_surplus, new_deficit },
 *     amount: number
 *   }
 * }
 */
export const POST = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { context, from_budget_id, to_budget_id, amount, monthly_recap_id } = await parseBody(
      request,
      manualTransferBodySchema,
    )

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: "Utilisateur ne fait partie d'aucun groupe" },
        { status: 400 },
      )
    }

    const contextId: string = context === 'profile' ? profile.id : profile.group_id!

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
        { status: 404 },
      )
    }

    const fromBudget = budgets.find((b) => b.id === from_budget_id)
    const toBudget = budgets.find((b) => b.id === to_budget_id)

    if (!fromBudget || !toBudget) {
      return NextResponse.json({ error: 'Budgets non trouvés' }, { status: 404 })
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
      return NextResponse.json({ error: 'Erreur lors du calcul des dépenses' }, { status: 500 })
    }

    // Calculer les montants dépensés réels
    const fromSpentAmount = (fromExpenses || []).reduce((sum, expense) => sum + expense.amount, 0)
    const toSpentAmount = (toExpenses || []).reduce((sum, expense) => sum + expense.amount, 0)

    // Calculer le surplus disponible du budget source
    const fromBudgetSurplus = Math.max(0, fromBudget.estimated_amount - fromSpentAmount)

    if (fromBudgetSurplus < amount) {
      return NextResponse.json(
        {
          error: `Budget source "${fromBudget.name}" n'a que ${fromBudgetSurplus.toFixed(2)}€ de surplus disponible`,
        },
        { status: 400 },
      )
    }

    // Enregistrer le transfert dans la table budget_transfers
    // Cela nous permet de calculer les ajustements sans modifier real_expenses
    const { error: transferInsertError } = await supabaseServer.from('budget_transfers').insert({
      [ownerField]: contextId,
      from_budget_id,
      to_budget_id,
      transfer_amount: amount,
      transfer_reason: 'Manual transfer via monthly recap',
      transfer_date: new Date().toISOString().split('T')[0],
      monthly_recap_id: monthly_recap_id || null,
    })

    if (transferInsertError) {
      logger.error("Erreur lors de l'enregistrement du transfert:", transferInsertError)
      return NextResponse.json(
        { error: "Erreur lors de l'enregistrement du transfert" },
        { status: 500 },
      )
    }

    // Calculer les nouveaux montants après transfert
    const newFromSpentAmount = fromSpentAmount + amount
    const newToSpentAmount = toSpentAmount - amount
    const newFromSurplus = Math.max(0, fromBudget.estimated_amount - newFromSpentAmount)
    const newToSurplus = Math.max(0, toBudget.estimated_amount - newToSpentAmount)
    const newFromDeficit = Math.max(0, newFromSpentAmount - fromBudget.estimated_amount)
    const newToDeficit = Math.max(0, newToSpentAmount - toBudget.estimated_amount)

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
          new_deficit: newFromDeficit,
        },
        to_budget: {
          id: toBudget.id,
          name: toBudget.name,
          previous_spent: toSpentAmount,
          new_spent: newToSpentAmount,
          estimated_amount: toBudget.estimated_amount,
          new_surplus: newToSurplus,
          new_deficit: newToDeficit,
        },
        amount,
      },
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
