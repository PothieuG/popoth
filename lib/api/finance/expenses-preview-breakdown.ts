import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuth } from '@/lib/api/with-auth'
import { parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { previewBreakdownQuerySchema } from '@/lib/schemas/expense'
import { calculateBreakdownWithAutoCascade } from '@/lib/expense-allocation'

export interface CrossBudgetDebitPreview {
  budget_id: string
  budget_name: string
  amount: number
  available_before: number
  available_after: number
}

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
  cross_budget_debits: CrossBudgetDebitPreview[]
}

/**
 * GET /api/finance/expenses/preview-breakdown
 *
 * Previews the breakdown of a budgeted expense — ADD mode (no expense_id) or
 * EDIT mode (with expense_id). Sprint Auto-Cascade-Piggy / Traceability
 * (2026-05-26) — les deux modes utilisent désormais
 * `calculateBreakdownWithAutoCascade` :
 *   - ADD : cascade fresh sur l'état DB courant.
 *   - EDIT : cascade fresh sur l'état post-reverse virtuel (sources d'origine
 *     restaurées dans les pools courants, lecture via expense_savings_sources
 *     ou fallback colonnes consolidées si pas de trace).
 */
export const GET = withAuth(async (request: NextRequest, { userId }) => {
  try {
    const {
      amount,
      budget_id: budgetId,
      context,
      expense_id: expenseId,
    } = parseQuery(request, previewBreakdownQuerySchema)

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

    const { data: piggyBankData } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .match(contextFilter)
      .maybeSingle()
    const piggyBankCurrent = piggyBankData?.amount || 0

    let existingExpense: {
      amount: number
      amount_from_piggy_bank: number
      amount_from_budget_savings: number
      amount_from_budget: number
    } | null = null
    const oldSourcesByBudget = new Map<string, number>()
    let oldPiggyFromSources = 0
    let hasTrace = false

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

        const { data: sources } = await supabaseServer
          .from('expense_savings_sources')
          .select('source_type, source_budget_id, amount')
          .eq('real_expense_id', expenseId)

        hasTrace = (sources?.length ?? 0) > 0
        for (const s of sources ?? []) {
          if (s.source_type === 'piggy') {
            oldPiggyFromSources += s.amount
          } else if (s.source_type === 'budget_savings' && s.source_budget_id) {
            oldSourcesByBudget.set(
              s.source_budget_id,
              (oldSourcesByBudget.get(s.source_budget_id) ?? 0) + s.amount,
            )
          }
        }
      }
    }

    const piggyBankBefore =
      piggyBankCurrent +
      (existingExpense
        ? hasTrace
          ? oldPiggyFromSources
          : existingExpense.amount_from_piggy_bank
        : 0)

    const { data: budgetData, error: budgetError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq('id', budgetId)
      .match(contextFilter)
      .single()

    if (budgetError || !budgetData) {
      return NextResponse.json({ error: 'Budget non trouvé' }, { status: 404 })
    }

    const destinationOldClaim = existingExpense
      ? hasTrace
        ? (oldSourcesByBudget.get(budgetId) ?? 0)
        : existingExpense.amount_from_budget_savings
      : 0
    const savingsBefore = (budgetData.cumulated_savings || 0) + destinationOldClaim

    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select('id, amount, amount_from_budget')
      .eq('estimated_budget_id', budgetId)
      .match(contextFilter)

    const budgetSpentCurrent =
      expenses?.reduce((sum, e) => {
        const amountFromBudget =
          e.amount_from_budget !== null && e.amount_from_budget !== undefined
            ? e.amount_from_budget
            : e.amount
        return sum + amountFromBudget
      }, 0) || 0

    // En EDIT : on soustrait la contribution budget de l'existing pour
    // simuler l'état post-reverse virtuel. En ADD : pas de soustraction.
    const budgetSpentBefore = existingExpense
      ? budgetSpentCurrent - existingExpense.amount_from_budget
      : budgetSpentCurrent
    const budgetRemaining = budgetData.estimated_amount - budgetSpentBefore

    // Lire les autres budgets avec savings (post-reverse en EDIT).
    const { data: otherBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, cumulated_savings')
      .match(contextFilter)
      .neq('id', budgetId)

    const otherBudgetsPostReverse = (otherBudgets ?? [])
      .map((b) => {
        const current = b.cumulated_savings ?? 0
        const oldClaim = existingExpense && hasTrace ? (oldSourcesByBudget.get(b.id) ?? 0) : 0
        return {
          budget_id: b.id,
          budget_name: b.name,
          available_before: current + oldClaim,
        }
      })
      .filter((b) => b.available_before > 0)

    const allocation = calculateBreakdownWithAutoCascade(
      amount,
      budgetRemaining,
      savingsBefore,
      piggyBankBefore,
      otherBudgetsPostReverse.map((b) => ({
        budget_id: b.budget_id,
        available: b.available_before,
      })),
    )
    const fromPiggyBank = allocation.fromPiggyBank
    const fromBudgetSavings = allocation.fromBudgetSavings
    const fromBudget = allocation.fromBudget

    const crossBudgetDebitsPreview: CrossBudgetDebitPreview[] = allocation.crossBudgetDebits.map(
      (d) => {
        const src = otherBudgetsPostReverse.find((b) => b.budget_id === d.budget_id)
        const availableBefore = src?.available_before ?? 0
        return {
          budget_id: d.budget_id,
          budget_name: src?.budget_name ?? '',
          amount: d.amount,
          available_before: availableBefore,
          available_after: Math.round((availableBefore - d.amount) * 100) / 100,
        }
      },
    )

    const budgetSpentAfter = budgetSpentBefore + fromBudget

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
      cross_budget_debits: crossBudgetDebitsPreview,
    }

    return NextResponse.json({ breakdown })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
})
