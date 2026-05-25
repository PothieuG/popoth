import { supabaseServer } from '@/lib/supabase-server'
import type { Json } from '@/lib/database.types'

import { resolveContextIds, type ContextFilter } from './context'

/**
 * Composite atomic helper for the smart-allocation expense path —
 * combines the piggy_bank debit, the cumulated_savings debit and the
 * real_expenses INSERT into a single Postgres transaction. Closes the
 * pre-Sprint Atomicity-Expenses gap where the route performed the 3
 * ops separately and a failed INSERT left both debits committed
 * (user perceived a money loss with no expense row to show for it).
 *
 * On overdraft (piggy or savings would go negative) the underlying
 * RPCs raise and the whole tx (including any prior debit) rolls back —
 * no partial state.
 *
 * Pattern mirrors `transferWithSavingsDebit` in budget-transfers.ts.
 * Not exposed via the `lib/finance` barrel — consumers import directly
 * (convention C3, same as the other RPC helpers).
 */
export async function addExpenseWithBreakdown(
  filter: ContextFilter,
  args: {
    amount: number
    description: string
    expenseDate: string
    estimatedBudgetId: string
    amountFromPiggyBank: number
    amountFromBudgetSavings: number
    amountFromBudget: number
    createdByProfileId: string
  },
): Promise<{ expense_id: string }> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('add_expense_with_breakdown', {
    p_amount: args.amount,
    p_description: args.description,
    p_expense_date: args.expenseDate,
    p_estimated_budget_id: args.estimatedBudgetId,
    p_amount_from_piggy_bank: args.amountFromPiggyBank,
    p_amount_from_budget_savings: args.amountFromBudgetSavings,
    p_amount_from_budget: args.amountFromBudget,
    p_profile_id: profile_id,
    p_group_id: group_id,
    p_created_by_profile_id: args.createdByProfileId,
  })
  if (error) throw error
  return data as { expense_id: string }
}

export interface CrossBudgetDebit {
  budget_id: string
  amount: number
}

/**
 * Composite atomic helper for the P4 Phase 2 cross-budget cascade expense path
 * (Sprint P4-P5-P6 / Phase C2). Extends `addExpenseWithBreakdown` with the
 * ability to draw from OTHER budgets' cumulated_savings in addition to the
 * destination budget's local funds.
 *
 * All ops (piggy debit + local savings debit + each cross-budget source debit
 * + INSERT real_expenses) happen in a SINGLE Postgres transaction. Any RAISE
 * (insufficient cross-budget savings, sum mismatch, etc.) rolls back the WHOLE
 * tx — partial cross-budget debits cannot leak.
 *
 * Sum invariant : `piggy + local_savings + budget + sum(cross_budget_debits) = amount`.
 *
 * The inserted `real_expenses` row stores `amount_from_budget_savings` as
 * `local_savings + cross_total` (consolidated). Per-source provenance is
 * recoverable via the source budgets' cumulated_savings delta + expense
 * `created_at` correlation.
 *
 * Convention C3 mirror : direct submodule import (not exposed in barrel).
 */
export async function addExpenseWithCrossBudgetCascade(
  filter: ContextFilter,
  args: {
    amount: number
    description: string
    expenseDate: string
    estimatedBudgetId: string
    amountFromPiggyBank: number
    amountFromLocalSavings: number
    amountFromBudget: number
    crossBudgetDebits: CrossBudgetDebit[]
    createdByProfileId: string
  },
): Promise<{ expense_id: string; cross_budget_total: number; consolidated_savings: number }> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('add_expense_with_cross_budget_cascade', {
    p_amount: args.amount,
    p_description: args.description,
    p_expense_date: args.expenseDate,
    p_estimated_budget_id: args.estimatedBudgetId,
    p_amount_from_piggy_bank: args.amountFromPiggyBank,
    p_amount_from_local_savings: args.amountFromLocalSavings,
    p_amount_from_budget: args.amountFromBudget,
    // The RPC's jsonb param is typed `Json` in the generated types; our
    // structured CrossBudgetDebit[] lacks the index signature `[key: string]:
    // Json | undefined` so a cast via unknown is the standard supabase-js
    // workaround (also see budget-transfers.ts pattern).
    p_cross_budget_debits: args.crossBudgetDebits as unknown as Json,
    p_profile_id: profile_id,
    p_group_id: group_id,
    p_created_by_profile_id: args.createdByProfileId,
  })
  if (error) throw error
  return data as {
    expense_id: string
    cross_budget_total: number
    consolidated_savings: number
  }
}

/**
 * Composite atomic helper pour SUPPRIMER une dépense avec refund précis
 * vers chaque source d'origine via la trace `expense_savings_sources`.
 * Sprint Auto-Cascade-Piggy / Traceability (2026-05-26).
 *
 * Legacy fallback : si la dépense n'a aucune row trace (créée avant le
 * sprint), refund selon les colonnes consolidées comme avant.
 */
export async function deleteExpenseWithSourcesRefund(
  expenseId: string,
): Promise<{ expense_id: string; sources_refunded: number }> {
  const { data, error } = await supabaseServer.rpc('delete_expense_with_sources_refund', {
    p_expense_id: expenseId,
  })
  if (error) throw error
  return data as { expense_id: string; sources_refunded: number }
}

/**
 * Composite atomic helper pour MODIFIER une dépense via reverse-then-reapply
 * complet. Crédite toutes les sources d'origine, débite toutes les nouvelles
 * sources passées en args, UPDATE consolidé sur `real_expenses`, remplace
 * les rows `expense_savings_sources`.
 *
 * Le destination budget reste immutable via cette RPC. Pour changer de
 * budget destination, le call site doit faire delete + add fresh.
 */
export async function updateExpenseWithSourcesReapply(args: {
  expenseId: string
  newAmount: number
  newDescription: string
  newExpenseDate: string
  newAmountFromPiggyBank: number
  newAmountFromLocalSavings: number
  newAmountFromBudget: number
  newCrossBudgetDebits: CrossBudgetDebit[]
}): Promise<{ expense_id: string; cross_budget_total: number; consolidated_savings: number }> {
  const { data, error } = await supabaseServer.rpc('update_expense_with_sources_reapply', {
    p_expense_id: args.expenseId,
    p_new_amount: args.newAmount,
    p_new_description: args.newDescription,
    p_new_expense_date: args.newExpenseDate,
    p_new_amount_from_piggy_bank: args.newAmountFromPiggyBank,
    p_new_amount_from_local_savings: args.newAmountFromLocalSavings,
    p_new_amount_from_budget: args.newAmountFromBudget,
    p_new_cross_budget_debits: args.newCrossBudgetDebits as unknown as Json,
  })
  if (error) throw error
  return data as {
    expense_id: string
    cross_budget_total: number
    consolidated_savings: number
  }
}
