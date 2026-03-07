import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

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
 * GET /api/finances/expenses/preview-breakdown
 *
 * Previews how an expense will be allocated without actually creating it
 * Query params:
 * - amount: expense amount
 * - budget_id: estimated budget ID
 * - context: 'profile' or 'group'
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const amount = parseFloat(searchParams.get('amount') || '0')
    const budgetId = searchParams.get('budget_id')
    const context = searchParams.get('context') || 'profile'
    const expenseId = searchParams.get('expense_id') // Optionnel: pour le mode edition

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Montant invalide' },
        { status: 400 }
      )
    }

    if (!budgetId) {
      return NextResponse.json(
        { error: 'Budget ID requis' },
        { status: 400 }
      )
    }

    // Determine context filter
    const isGroup = context === 'group'
    let contextFilter: any

    if (isGroup) {
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', session.userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json(
          { error: 'Groupe non trouvé' },
          { status: 404 }
        )
      }
      contextFilter = { group_id: profile.group_id }
    } else {
      contextFilter = { profile_id: session.userId }
    }

    // Get piggy bank
    const { data: piggyBankData } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .match(contextFilter)
      .maybeSingle()

    let piggyBankBefore = piggyBankData?.amount || 0

    // En mode edition: restaurer virtuellement l'allocation de la depense existante
    let existingExpense: { amount_from_piggy_bank: number, amount_from_budget_savings: number, amount_from_budget: number } | null = null
    if (expenseId) {
      const { data: expData } = await supabaseServer
        .from('real_expenses')
        .select('amount_from_piggy_bank, amount_from_budget_savings, amount_from_budget')
        .eq('id', expenseId)
        .single()

      if (expData) {
        existingExpense = {
          amount_from_piggy_bank: expData.amount_from_piggy_bank || 0,
          amount_from_budget_savings: expData.amount_from_budget_savings || 0,
          amount_from_budget: expData.amount_from_budget || 0
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
      return NextResponse.json(
        { error: 'Budget non trouvé' },
        { status: 404 }
      )
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

    let budgetSpentBefore = expenses?.reduce((sum, e) => {
      // Use amount_from_budget if available, otherwise use amount (backward compatibility)
      const amountFromBudget = e.amount_from_budget !== null && e.amount_from_budget !== undefined
        ? e.amount_from_budget
        : e.amount
      return sum + amountFromBudget
    }, 0) || 0

    // En mode edition: exclure le budget depense par la depense existante
    if (existingExpense) {
      budgetSpentBefore -= existingExpense.amount_from_budget
    }

    // Calculate breakdown
    let remainingToAllocate = amount
    let fromPiggyBank = 0
    let fromBudgetSavings = 0
    let fromBudget = 0

    // Priority 1: Piggy bank
    if (piggyBankBefore > 0) {
      fromPiggyBank = Math.min(remainingToAllocate, piggyBankBefore)
      remainingToAllocate -= fromPiggyBank
    }

    // Priority 2: Budget savings
    if (remainingToAllocate > 0 && savingsBefore > 0) {
      fromBudgetSavings = Math.min(remainingToAllocate, savingsBefore)
      remainingToAllocate -= fromBudgetSavings
    }

    // Priority 3: Budget itself
    if (remainingToAllocate > 0) {
      fromBudget = remainingToAllocate
    }

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
      budget_spent_after: budgetSpentBefore + fromBudget,
      budget_estimated: budgetData.estimated_amount,
      budget_name: budgetData.name
    }

    return NextResponse.json({ breakdown })

  } catch (error) {
    console.error('❌ Error in GET /api/finances/expenses/preview-breakdown:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
