import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { transferBudgetToPiggyBank, transferSavingsBetweenBudgets } from '@/lib/finance/savings'
import { withAuthAndProfile, type AuthedProfile } from '@/lib/api/with-auth'
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { isBudgetToPiggyBank, transferSavingsBodySchema } from '@/lib/schemas/savings'
import type { Context } from '@/lib/schemas/common'
import { logger } from '@/lib/logger'

/**
 * API Transfer Savings Between Budgets OR Budget → Piggy Bank
 * POST /api/savings/transfer
 *
 * Body shapes validated by `transferSavingsBodySchema` (lib/schemas/savings.ts).
 * See CLAUDE.md §6 "Validation Zod (parseBody)" for the convention.
 */
export const POST = withAuthAndProfile(async (request, { profile }) => {
  try {
    const body = await parseBody(request, transferSavingsBodySchema)

    // Transfert budget → tirelire
    if (isBudgetToPiggyBank(body)) {
      return handleBudgetToPiggyBank(profile, body.context, body.from_budget_id, body.amount)
    }

    // Transfert budget → budget (action absent, narrowed by union)
    const { context, from_budget_id, to_budget_id, amount } = body

    // Determine context filter
    const contextFilter =
      context === 'group' && profile.group_id
        ? { group_id: profile.group_id }
        : { profile_id: profile.id }

    // 1. Get FROM budget with current savings
    const { data: fromBudget, error: fromError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq('id', from_budget_id)
      .match(contextFilter)
      .single()

    if (fromError || !fromBudget) {
      return NextResponse.json({ error: 'Budget source non trouvé' }, { status: 404 })
    }

    // 2. Get TO budget
    const { data: toBudget, error: toError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq('id', to_budget_id)
      .match(contextFilter)
      .single()

    if (toError || !toBudget) {
      return NextResponse.json({ error: 'Budget destination non trouvé' }, { status: 404 })
    }

    // 3. Validate that source budget has enough savings (UX-friendly 400
    //    instead of 500 from the atomic RPC)
    const currentSavings = fromBudget.cumulated_savings || 0
    if (amount > currentSavings) {
      return NextResponse.json(
        {
          error: `Le budget ${fromBudget.name} n'a que ${currentSavings}€ d'économies disponibles`,
          available: currentSavings,
        },
        { status: 400 },
      )
    }

    // 4. Atomic transfer (debit FROM + credit TO in one tx) — overdraft
    //    or any raise rolls back BOTH legs (Sprint Atomicity-Savings).
    let from_savings: number
    let to_savings: number
    try {
      const result = await transferSavingsBetweenBudgets(contextFilter, {
        fromBudgetId: from_budget_id,
        toBudgetId: to_budget_id,
        amount,
      })
      from_savings = result.from_savings
      to_savings = result.to_savings
    } catch (transferError) {
      logger.error('❌ Erreur transfert entre budgets:', transferError)
      return NextResponse.json({ error: 'Erreur lors du transfert entre budgets' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `Transfert de ${amount}€ effectué`,
      from: {
        budget_id: from_budget_id,
        budget_name: fromBudget.name,
        old_savings: currentSavings,
        new_savings: from_savings,
      },
      to: {
        budget_id: to_budget_id,
        budget_name: toBudget.name,
        old_savings: toBudget.cumulated_savings || 0,
        new_savings: to_savings,
      },
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: 'Erreur serveur lors du transfert' }, { status: 500 })
  }
})

/**
 * Handle Budget → Piggy Bank Transfer
 * Removes savings from a budget and adds them to the piggy bank
 * atomically via the composite RPC `transfer_budget_to_piggy_bank`
 * (Sprint Atomicity-Savings). The UPSERT handles both "piggy exists"
 * and "piggy missing" cases in a single SQL statement.
 */
async function handleBudgetToPiggyBank(
  profile: AuthedProfile,
  context: Context,
  fromBudgetId: string,
  amount: number,
) {
  const contextFilter =
    context === 'group' && profile.group_id
      ? { group_id: profile.group_id }
      : { profile_id: profile.id }

  // 1. Get source budget (validates ownership + provides UX-friendly
  //    error messages before the atomic RPC).
  const { data: fromBudget, error: fromError } = await supabaseServer
    .from('estimated_budgets')
    .select('id, name, cumulated_savings')
    .eq('id', fromBudgetId)
    .match(contextFilter)
    .single()

  if (fromError || !fromBudget) {
    return NextResponse.json({ error: 'Budget source non trouvé' }, { status: 404 })
  }

  const currentSavings = fromBudget.cumulated_savings || 0
  if (amount > currentSavings) {
    return NextResponse.json(
      { error: `Le budget ${fromBudget.name} n'a que ${currentSavings}€ d'économies disponibles` },
      { status: 400 },
    )
  }

  // 2. Read current piggy_bank amount for the response shape (pre-state).
  //    The atomic RPC returns the post-state; we surface both.
  const piggyMatchFilter =
    context === 'group' && profile.group_id
      ? { group_id: profile.group_id }
      : { profile_id: profile.id }

  const { data: currentPiggyBank } = await supabaseServer
    .from('piggy_bank')
    .select('amount')
    .match(piggyMatchFilter)
    .maybeSingle()

  const currentPiggyAmount = currentPiggyBank?.amount || 0

  // 3. Atomic transfer (debit budget + UPSERT piggy in one tx) — any
  //    raise rolls back BOTH legs (Sprint Atomicity-Savings).
  let from_savings: number
  let piggy_bank_amount: number
  try {
    const result = await transferBudgetToPiggyBank(contextFilter, {
      fromBudgetId,
      amount,
    })
    from_savings = result.from_savings
    piggy_bank_amount = result.piggy_bank_amount
  } catch (transferError) {
    logger.error('❌ Erreur transfert budget → tirelire:', transferError)
    return NextResponse.json(
      { error: 'Erreur lors du transfert vers la tirelire' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success: true,
    action: 'budget_to_piggy_bank',
    from_budget: {
      name: fromBudget.name,
      old_savings: currentSavings,
      new_savings: from_savings,
    },
    piggy_bank: { old_amount: currentPiggyAmount, new_amount: piggy_bank_amount },
  })
}
