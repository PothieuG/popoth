import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'
import { saveRemainingToLiveSnapshot } from '@/lib/financial-calculations'
import { calculateBreakdown } from '@/lib/expense-allocation'

export interface AddExpenseWithLogicRequest {
  amount: number
  description: string
  expense_date?: string
  estimated_budget_id?: string
  is_for_group?: boolean
}

export interface ExpenseBreakdown {
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
}

/**
 * POST /api/finances/expenses/add-with-logic
 *
 * Adds an expense with the following priority logic:
 * 1. First, deplete piggy bank
 * 2. Then, deplete budget savings (cumulated_savings)
 * 3. Finally, use the budget itself
 *
 * Returns a detailed breakdown of how the expense was allocated
 */
export async function POST(request: NextRequest) {
  try {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const body: AddExpenseWithLogicRequest = await request.json()
    const {
      amount,
      description,
      expense_date,
      estimated_budget_id,
      is_for_group = false
    } = body

    // Validation
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { error: 'Le montant doit être un nombre positif' },
        { status: 400 }
      )
    }

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json(
        { error: 'La description est requise' },
        { status: 400 }
      )
    }

    console.log('')
    console.log('💳💳💳 ========================================================')
    console.log('💳 [ADD EXPENSE WITH LOGIC] NOUVELLE DÉPENSE')
    console.log('💳💳💳 ========================================================')
    console.log(`💳 Montant: ${amount}€`)
    console.log(`💳 Description: ${description}`)
    console.log(`💳 Budget ID: ${estimated_budget_id || 'Exceptionnel'}`)
    console.log(`💳 Contexte: ${is_for_group ? 'Groupe' : 'Profil'}`)

    // Determine profile_id or group_id
    let profile_id: string | undefined = undefined
    let group_id: string | undefined = undefined

    if (is_for_group) {
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', session.userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json(
          { error: 'Vous devez appartenir à un groupe pour ajouter des dépenses de groupe' },
          { status: 400 }
        )
      }
      group_id = profile.group_id
    } else {
      profile_id = session.userId
    }

    const contextFilter = is_for_group ? { group_id } : { profile_id }

    // If exceptional (no budget), just create the expense directly
    if (!estimated_budget_id) {
      const insertData: any = {
        amount,
        description: description.trim(),
        expense_date: expense_date || new Date().toISOString().split('T')[0],
        is_exceptional: true,
        ...contextFilter
      }

      const { data, error } = await supabaseServer
        .from('real_expenses')
        .insert(insertData)
        .select(`
          *,
          estimated_budget:estimated_budgets(name)
        `)
        .single()

      if (error) {
        console.error('❌ Erreur création dépense exceptionnelle:', error)
        return NextResponse.json(
          { error: 'Erreur lors de la création de la dépense' },
          { status: 500 }
        )
      }

      // Save snapshot for exceptional expense
      await saveRemainingToLiveSnapshot({
        profileId: profile_id,
        groupId: group_id,
        reason: 'exceptional_expense_created'
      })

      console.log('✅ Dépense exceptionnelle créée avec succès')
      console.log('💳💳💳 ========================================================')
      console.log('')

      return NextResponse.json({
        real_expense: data,
        breakdown: null, // No breakdown for exceptional expenses
        message: 'Dépense exceptionnelle créée avec succès'
      })
    }

    // For budgeted expenses, apply the logic
    // Step 1: Get current piggy bank
    const { data: piggyBankData } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .match(contextFilter)
      .maybeSingle()

    const piggyBankBefore = piggyBankData?.amount || 0

    // Step 2: Get budget info
    const { data: budgetData, error: budgetError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq('id', estimated_budget_id)
      .match(contextFilter)
      .single()

    if (budgetError || !budgetData) {
      return NextResponse.json(
        { error: 'Budget estimé introuvable' },
        { status: 404 }
      )
    }

    const savingsBefore = budgetData.cumulated_savings || 0

    // Step 3: Get current spent amount for this budget
    // Only count amount_from_budget (not piggy bank or savings amounts)
    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, amount_from_budget')
      .eq('estimated_budget_id', estimated_budget_id)
      .match(contextFilter)

    const budgetSpentBefore = expenses?.reduce((sum, e) => {
      // Use amount_from_budget if available, otherwise use amount (backward compatibility)
      return sum + (e.amount_from_budget !== null && e.amount_from_budget !== undefined ? e.amount_from_budget : e.amount)
    }, 0) || 0

    console.log('')
    console.log('📊 ÉTAT AVANT:')
    console.log(`   - Tirelire: ${piggyBankBefore}€`)
    console.log(`   - Savings du budget: ${savingsBefore}€`)
    console.log(`   - Budget dépensé: ${budgetSpentBefore}€ / ${budgetData.estimated_amount}€`)
    console.log('')

    // Step 4: Calculate the breakdown
    const { fromPiggyBank, fromBudgetSavings, fromBudget } = calculateBreakdown(
      amount,
      piggyBankBefore,
      savingsBefore
    )

    const piggyBankAfter = piggyBankBefore - fromPiggyBank
    const savingsAfter = savingsBefore - fromBudgetSavings
    const budgetSpentAfter = budgetSpentBefore + fromBudget

    console.log('💡 RÉPARTITION:')
    console.log(`   - De la tirelire: ${fromPiggyBank}€`)
    console.log(`   - Des savings: ${fromBudgetSavings}€`)
    console.log(`   - Du budget: ${fromBudget}€`)
    console.log('')
    console.log('📊 ÉTAT APRÈS:')
    console.log(`   - Tirelire: ${piggyBankAfter}€`)
    console.log(`   - Savings du budget: ${savingsAfter}€`)
    console.log(`   - Budget dépensé: ${budgetSpentAfter}€ / ${budgetData.estimated_amount}€`)
    console.log('')

    // Step 5: Update piggy bank if needed
    if (fromPiggyBank > 0) {
      if (piggyBankData) {
        // Update existing piggy bank
        const { error: piggyError } = await supabaseServer
          .from('piggy_bank')
          .update({ amount: piggyBankAfter })
          .match(contextFilter)

        if (piggyError) {
          console.error('❌ Erreur mise à jour tirelire:', piggyError)
          return NextResponse.json(
            { error: 'Erreur lors de la mise à jour de la tirelire' },
            { status: 500 }
          )
        }
      }
    }

    // Step 6: Update budget savings if needed
    if (fromBudgetSavings > 0) {
      const { error: savingsError } = await supabaseServer
        .from('estimated_budgets')
        .update({
          cumulated_savings: savingsAfter,
          last_savings_update: new Date().toISOString()
        })
        .eq('id', estimated_budget_id)

      if (savingsError) {
        console.error('❌ Erreur mise à jour savings:', savingsError)
        return NextResponse.json(
          { error: 'Erreur lors de la mise à jour des économies' },
          { status: 500 }
        )
      }
    }

    // Step 7: Create the real expense with FULL amount and breakdown tracking
    // The expense always appears in the list, but we track where the money came from
    const insertData: any = {
      amount: amount, // Full amount for display
      description: description.trim(),
      expense_date: expense_date || new Date().toISOString().split('T')[0],
      is_exceptional: false,
      estimated_budget_id,
      amount_from_piggy_bank: fromPiggyBank,
      amount_from_budget_savings: fromBudgetSavings,
      amount_from_budget: fromBudget,
      ...contextFilter
    }

    const { data: expenseData, error: expenseError } = await supabaseServer
      .from('real_expenses')
      .insert(insertData)
      .select(`
        *,
        estimated_budget:estimated_budgets(name)
      `)
      .single()

    if (expenseError) {
      console.error('❌ Erreur création dépense:', expenseError)
      return NextResponse.json(
        { error: 'Erreur lors de la création de la dépense' },
        { status: 500 }
      )
    }

    const breakdown: ExpenseBreakdown = {
      total_amount: amount,
      from_piggy_bank: fromPiggyBank,
      from_budget_savings: fromBudgetSavings,
      from_budget: fromBudget,
      piggy_bank_before: piggyBankBefore,
      piggy_bank_after: piggyBankAfter,
      savings_before: savingsBefore,
      savings_after: savingsAfter,
      budget_spent_before: budgetSpentBefore,
      budget_spent_after: budgetSpentAfter
    }

    console.log('✅ Dépense créée avec succès')
    console.log('💳💳💳 ========================================================')
    console.log('')

    return NextResponse.json({
      real_expense: expenseData,
      breakdown,
      message: 'Dépense créée avec succès'
    })

  } catch (error) {
    console.error('❌ Error in POST /api/finances/expenses/add-with-logic:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}
