import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { saveRemainingToLiveSnapshot } from '@/lib/finance'
import { calculateBreakdown } from '@/lib/expense-allocation'
import { addExpenseWithBreakdown, addExpenseWithCrossBudgetCascade } from '@/lib/finance/expenses'
import type { ContextFilter as FinanceContextFilter } from '@/lib/finance/context'
import type { Database } from '@/lib/database.types'
import { withAuth } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { addExpenseWithLogicBodySchema } from '@/lib/schemas/expense'
import { logger } from '@/lib/logger'

type RealExpenseInsert = Database['public']['Tables']['real_expenses']['Insert']

export interface AddExpenseWithLogicRequest {
  amount: number
  description: string
  expense_date?: string
  estimated_budget_id?: string
  is_for_group?: boolean
  /** Sprint P4-P5-P6 / P5 toggle — see `addExpenseWithLogicBodySchema`. */
  use_savings?: boolean
  /** Sprint P4-P5-P6 / P4 Phase 2 — see `addExpenseWithLogicBodySchema`. */
  cross_budget_cascade?: Array<{ budget_id: string; amount: number }>
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
 * POST /api/finance/expenses/add-with-logic
 *
 * Adds an expense with the following priority logic:
 * 1. First, deplete piggy bank
 * 2. Then, deplete budget savings (cumulated_savings)
 * 3. Finally, use the budget itself
 *
 * Returns a detailed breakdown of how the expense was allocated.
 *
 * Atomic since Sprint Atomicity-Expenses: the piggy debit, savings
 * debit and INSERT real_expenses live inside a single Postgres tx
 * (composite RPC `add_expense_with_breakdown`). Overdraft or INSERT
 * failure rolls back all three operations together — no partial
 * state, no compensating action needed.
 */
export const POST = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const body = await parseBody(request, addExpenseWithLogicBodySchema)
    const {
      amount,
      description,
      expense_date,
      estimated_budget_id,
      use_savings,
      cross_budget_cascade,
    } = body
    const is_for_group = body.is_for_group ?? false

    // Determine profile_id or group_id
    let profile_id: string | undefined = undefined
    let group_id: string | undefined = undefined

    if (is_for_group) {
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json(
          { error: 'Vous devez appartenir à un groupe pour ajouter des dépenses de groupe' },
          { status: 400 },
        )
      }
      group_id = profile.group_id
    } else {
      profile_id = userId
    }

    const contextFilter = is_for_group ? { group_id } : { profile_id }

    // If exceptional (no budget), just create the expense directly
    if (!estimated_budget_id) {
      const todayIsoExceptional = new Date().toISOString().split('T')[0] as string
      const insertData: RealExpenseInsert = {
        amount,
        description,
        expense_date: expense_date || todayIsoExceptional,
        is_exceptional: true,
        ...contextFilter,
      }

      const { data, error } = await supabaseServer
        .from('real_expenses')
        .insert(insertData)
        .select(
          `
          *,
          estimated_budget:estimated_budgets(name)
        `,
        )
        .single()

      if (error) {
        logger.error('Erreur création dépense exceptionnelle:', error)
        return NextResponse.json(
          { error: 'Erreur lors de la création de la dépense' },
          { status: 500 },
        )
      }

      // Save snapshot for exceptional expense
      await saveRemainingToLiveSnapshot({
        profileId: profile_id,
        groupId: group_id,
        reason: 'exceptional_expense_created',
      })

      return NextResponse.json({
        real_expense: data,
        breakdown: null, // No breakdown for exceptional expenses
        message: 'Dépense exceptionnelle créée avec succès',
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
      return NextResponse.json({ error: 'Budget estimé introuvable' }, { status: 404 })
    }

    const savingsBefore = budgetData.cumulated_savings || 0

    // Step 3: Get current spent amount for this budget
    // Only count amount_from_budget (not piggy bank or savings amounts)
    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select('amount, amount_from_budget')
      .eq('estimated_budget_id', estimated_budget_id)
      .match(contextFilter)

    const budgetSpentBefore =
      expenses?.reduce((sum, e) => {
        // Use amount_from_budget if available, otherwise use amount (backward compatibility)
        return (
          sum +
          (e.amount_from_budget !== null && e.amount_from_budget !== undefined
            ? e.amount_from_budget
            : e.amount)
        )
      }, 0) || 0

    // Step 4: Calculate the breakdown. P5 toggle (use_savings) opts in to
    // savings-first ; otherwise P4 strict (budget first, savings cascade
    // on overflow). Piggy never auto-debited in either mode.
    const budgetRemaining = (budgetData.estimated_amount || 0) - budgetSpentBefore
    const { fromPiggyBank, fromBudgetSavings, fromBudget, overflow } = calculateBreakdown(
      amount,
      budgetRemaining,
      savingsBefore,
      { useSavingsToggle: use_savings },
    )

    // Cross-budget cascade (P4 Phase 2): if the client provided sources to
    // draw from, dispatch to the multi-budget composite RPC. The cross-budget
    // total covers part of the overflow; any remainder is absorbed as
    // additional fromBudget (budget deficit, RAV impact). Without
    // cross-budget cascade, all overflow goes to fromBudget.
    const crossBudgetTotal = (cross_budget_cascade ?? []).reduce((s, x) => s + x.amount, 0)
    const uncoveredOverflow = Math.max(0, overflow - crossBudgetTotal)
    const fromBudgetWithOverflow = fromBudget + uncoveredOverflow

    const piggyBankAfter = piggyBankBefore - fromPiggyBank
    const savingsAfter = savingsBefore - fromBudgetSavings
    const budgetSpentAfter = budgetSpentBefore + fromBudgetWithOverflow

    // Step 5: Single atomic op. Two paths depending on whether the client
    // provided a cross-budget cascade:
    //   - With cross-budget: `add_expense_with_cross_budget_cascade` debits
    //     local savings + each cross-budget source + INSERTs in one tx.
    //   - Without: `add_expense_with_breakdown` debits piggy + local savings
    //     + INSERTs in one tx (piggy always 0 in P4 strict).
    const todayIso = new Date().toISOString().split('T')[0] as string
    let expenseId: string
    try {
      if (cross_budget_cascade && cross_budget_cascade.length > 0) {
        const result = await addExpenseWithCrossBudgetCascade(
          contextFilter as unknown as FinanceContextFilter,
          {
            amount,
            description,
            expenseDate: expense_date || todayIso,
            estimatedBudgetId: estimated_budget_id,
            amountFromPiggyBank: fromPiggyBank,
            amountFromLocalSavings: fromBudgetSavings,
            amountFromBudget: fromBudgetWithOverflow,
            crossBudgetDebits: cross_budget_cascade,
          },
        )
        expenseId = result.expense_id
      } else {
        const result = await addExpenseWithBreakdown(
          contextFilter as unknown as FinanceContextFilter,
          {
            amount,
            description,
            expenseDate: expense_date || todayIso,
            estimatedBudgetId: estimated_budget_id,
            amountFromPiggyBank: fromPiggyBank,
            amountFromBudgetSavings: fromBudgetSavings,
            amountFromBudget: fromBudgetWithOverflow,
          },
        )
        expenseId = result.expense_id
      }
    } catch (rpcError) {
      logger.error('Erreur création dépense atomique:', rpcError)
      return NextResponse.json(
        { error: 'Erreur lors de la création de la dépense' },
        { status: 500 },
      )
    }

    // Step 6: Re-fetch the inserted row + estimated_budget relation to
    // preserve the response shape (the RPC returns only expense_id;
    // the join is cheaper as a follow-up SELECT than as plpgsql JSON).
    const { data: expenseData, error: fetchError } = await supabaseServer
      .from('real_expenses')
      .select(
        `
        *,
        estimated_budget:estimated_budgets(name)
      `,
      )
      .eq('id', expenseId)
      .single()

    if (fetchError || !expenseData) {
      logger.error('Erreur récupération dépense créée:', fetchError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération de la dépense créée' },
        { status: 500 },
      )
    }

    const breakdown: ExpenseBreakdown = {
      total_amount: amount,
      from_piggy_bank: fromPiggyBank,
      from_budget_savings: fromBudgetSavings,
      from_budget: fromBudgetWithOverflow,
      piggy_bank_before: piggyBankBefore,
      piggy_bank_after: piggyBankAfter,
      savings_before: savingsBefore,
      savings_after: savingsAfter,
      budget_spent_before: budgetSpentBefore,
      budget_spent_after: budgetSpentAfter,
    }

    return NextResponse.json({
      real_expense: expenseData,
      breakdown,
      message: 'Dépense créée avec succès',
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
