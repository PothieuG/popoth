import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuth } from '@/lib/api/with-auth'
import { parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { previewBreakdownQuerySchema } from '@/lib/schemas/expense'
import { calculateBreakdown } from '@/lib/expense-allocation'

export interface ExpenseBreakdownPreview {
  total_amount: number
  from_piggy_bank: number
  from_budget_savings: number
  from_budget: number
  piggy_bank_before: number
  piggy_bank_after: number
  savings_before: number
  savings_after: number
  budget_spent_before: number
  budget_spent_after: number
  budget_estimated: number
  budget_name: string
}

/**
 * GET /api/finance/expenses/preview-breakdown
 *
 * Previews how an expense will be allocated without actually creating it
 * Query params:
 * - amount: expense amount
 * - budget_id: estimated budget ID
 * - context: 'profile' or 'group'
 */
export const GET = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const {
      amount,
      budget_id: budgetId,
      context,
      expense_id: expenseId,
      use_savings: useSavings,
    } = parseQuery(request, previewBreakdownQuerySchema)

    // Determine context filter
    const isGroup = context === 'group'
    let contextFilter: { group_id: string } | { profile_id: string }

    if (isGroup) {
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json({ error: 'Groupe non trouvé' }, { status: 404 })
      }
      contextFilter = { group_id: profile.group_id }
    } else {
      contextFilter = { profile_id: userId }
    }

    // Get piggy bank
    const { data: piggyBankData } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .match(contextFilter)
      .maybeSingle()

    let piggyBankBefore = piggyBankData?.amount || 0

    // En mode edition: restaurer virtuellement l'allocation de la depense existante
    let existingExpense: {
      amount: number
      amount_from_piggy_bank: number
      amount_from_budget_savings: number
      amount_from_budget: number
    } | null = null
    if (expenseId) {
      const { data: expData } = await supabaseServer
        .from('real_expenses')
        .select('amount, amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget')
        .eq('id', expenseId)
        .single()

      if (expData) {
        existingExpense = {
          amount: expData.amount,
          amount_from_piggy_bank: expData.amount_from_piggy_bank || 0,
          amount_from_budget_savings: expData.amount_from_budget_savings || 0,
          amount_from_budget: expData.amount_from_budget || 0,
        }
        // Simuler le reverse: rendre les montants aux pools
        piggyBankBefore += existingExpense.amount_from_piggy_bank
      }
    }

    // Get budget info
    const { data: budgetData, error: budgetError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq('id', budgetId)
      .match(contextFilter)
      .single()

    if (budgetError || !budgetData) {
      return NextResponse.json({ error: 'Budget non trouvé' }, { status: 404 })
    }

    let savingsBefore = budgetData.cumulated_savings || 0

    // En mode edition: restaurer virtuellement les economies
    if (existingExpense) {
      savingsBefore += existingExpense.amount_from_budget_savings
    }

    // Get current spent amount - only count amount_from_budget
    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select('id, amount, amount_from_budget')
      .eq('estimated_budget_id', budgetId)
      .match(contextFilter)

    // Sum d'amount_from_budget across TOUTES les dépenses du budget — y compris
    // celle en cours d'édition (NE PAS soustraire). Ce un-reverted budget pool
    // miroir le comportement du PUT serveur : `applyAllocation` lit la table
    // `real_expenses` AVANT que la nouvelle valeur soit écrite, donc l'ancienne
    // amount_from_budget de la dépense éditée est toujours dans la somme.
    // Sprint 2026-05-21 fix : le subtract précédent (`-= existingExpense.amount_from_budget`)
    // donnait des `budgetRemaining` virtuellement plus grands → l'allocation
    // P4-strict mettait tout sur le budget et négligeait la cascade savings.
    // Bug remonté : édition d'une dépense de 123€→130€ affichait `-130€ budget`
    // alors que le serveur stocke `-105€ budget + -25€ savings` (existing 98+25
    // → delta +7 absorbé par budget cap-105, savings cascade resorbé overflow).
    const budgetSpentBefore =
      expenses?.reduce((sum, e) => {
        // Use amount_from_budget if available, otherwise use amount (backward compatibility)
        const amountFromBudget =
          e.amount_from_budget !== null && e.amount_from_budget !== undefined
            ? e.amount_from_budget
            : e.amount
        return sum + amountFromBudget
      }, 0) || 0

    // Mode EDIT (existingExpense fourni) : algorithme « delta-based cascade »
    // Sprint 2026-05-21 (refinement). Le serveur PUT (applyAllocation) applique
    // le même algorithme — duplication inline car la route ne peut pas importer
    // la version server (qui fait des UPDATE). Toute modif doit toucher les
    // deux endroits. Mode ADD : P4-strict (ou P5 toggle) — budget first,
    // savings cascade.
    let fromPiggyBank: number
    let fromBudgetSavings: number
    let fromBudget: number
    if (existingExpense) {
      const eP = existingExpense.amount_from_piggy_bank
      const eS = existingExpense.amount_from_budget_savings
      const eB = existingExpense.amount_from_budget
      const existingAmount = existingExpense.amount
      const delta = Math.round((amount - existingAmount) * 100) / 100

      if (delta === 0) {
        fromPiggyBank = eP
        fromBudgetSavings = eS
        fromBudget = eB
      } else if (delta > 0) {
        // Le delta supplémentaire pioche d'abord dans les économies libres
        // (savingsBefore est le pool post-virtual-revert, donc on retire `eS`
        // pour obtenir l'extra room non-claimed). Budget absorbe le reste.
        // Piggy stays at `eP` — jamais auto-débitée même en EDIT (P4 strict).
        const extraSavings = Math.max(0, savingsBefore - eS)
        let remaining = delta
        const addSavings = Math.min(remaining, extraSavings)
        remaining -= addSavings
        const addBudget = remaining
        fromPiggyBank = eP
        fromBudgetSavings = eS + addSavings
        fromBudget = eB + addBudget
      } else {
        // delta < 0 : refund priorité reverse — budget vidé d'abord, puis
        // savings (préserve la portion savings tant que le budget peut
        // absorber le refund), puis piggy en dernier recours.
        let remainingRefund = -delta
        const refundFromBudget = Math.min(remainingRefund, eB)
        remainingRefund -= refundFromBudget
        const refundFromSavings = Math.min(remainingRefund, eS)
        remainingRefund -= refundFromSavings
        const refundFromPiggy = Math.min(remainingRefund, eP)
        fromPiggyBank = eP - refundFromPiggy
        fromBudgetSavings = eS - refundFromSavings
        fromBudget = eB - refundFromBudget
      }
    } else {
      const budgetRemaining = budgetData.estimated_amount - budgetSpentBefore
      const allocation = calculateBreakdown(amount, budgetRemaining, savingsBefore, {
        useSavingsToggle: useSavings,
      })
      fromPiggyBank = allocation.fromPiggyBank
      fromBudgetSavings = allocation.fromBudgetSavings
      fromBudget = allocation.fromBudget + allocation.overflow
    }

    // Pour le `budget_spent_after` (état post-édit affiché côté UI) on DOIT
    // soustraire la contribution de l'existing (qui va être remplacée par
    // `fromBudget`). Cf. server flow : applyAllocation calcule la nouvelle
    // amount_from_budget, puis l'UPDATE remplace l'ancienne sur la ligne en DB.
    // Donc total spent post-save = budgetSpentBefore - existing.amount_from_budget + fromBudget.
    const existingBudgetPortion = existingExpense?.amount_from_budget ?? 0
    const budgetSpentAfter = budgetSpentBefore - existingBudgetPortion + fromBudget

    const breakdown: ExpenseBreakdownPreview = {
      total_amount: amount,
      from_piggy_bank: fromPiggyBank,
      from_budget_savings: fromBudgetSavings,
      from_budget: fromBudget,
      piggy_bank_before: piggyBankBefore,
      piggy_bank_after: piggyBankBefore - fromPiggyBank,
      savings_before: savingsBefore,
      savings_after: savingsBefore - fromBudgetSavings,
      budget_spent_before: budgetSpentBefore,
      budget_spent_after: budgetSpentAfter,
      budget_estimated: budgetData.estimated_amount,
      budget_name: budgetData.name,
    }

    return NextResponse.json({ breakdown })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
