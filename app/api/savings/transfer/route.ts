import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { updatePiggyBank } from '@/lib/finance/piggy-bank'
import {
  transferBudgetToPiggyBank,
  transferSavingsBetweenBudgets,
} from '@/lib/finance/savings'
import { withAuthAndProfile, type AuthedProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'

/**
 * API Transfer Savings Between Budgets OR Manipulate Piggy Bank
 * POST /api/savings/transfer
 *
 * Body for budget transfer: {
 *   context: 'profile' | 'group',
 *   from_budget_id: string,
 *   to_budget_id: string,
 *   amount: number
 * }
 *
 * Body for piggy bank actions: {
 *   context: 'profile' | 'group',
 *   action: 'set_piggy_bank' | 'add_to_piggy_bank' | 'remove_from_piggy_bank',
 *   amount: number
 * }
 */
export const POST = withAuthAndProfile(async (request, { profile }) => {
  try {
    const body = await request.json()
    const { context = 'profile', action, from_budget_id, to_budget_id, amount } = body

    // Si c'est une action tirelire, déléguer à la fonction appropriée
    if (
      action &&
      ['set_piggy_bank', 'add_to_piggy_bank', 'remove_from_piggy_bank'].includes(action)
    ) {
      return handlePiggyBankAction(profile, context, action, amount)
    }

    // Transfert budget → tirelire
    if (action === 'budget_to_piggy_bank') {
      return handleBudgetToPiggyBank(profile, context, from_budget_id, amount)
    }

    // Sinon, c'est un transfert entre budgets
    if (!context || !from_budget_id || !to_budget_id || !amount) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
    }

    if (amount <= 0) {
      return NextResponse.json({ error: 'Le montant doit être positif' }, { status: 400 })
    }

    if (from_budget_id === to_budget_id) {
      return NextResponse.json(
        { error: 'Les budgets source et destination doivent être différents' },
        { status: 400 },
      )
    }

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
      return NextResponse.json(
        { error: 'Erreur lors du transfert entre budgets' },
        { status: 500 },
      )
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
  } catch {
    return NextResponse.json({ error: 'Erreur serveur lors du transfert' }, { status: 500 })
  }
})

/**
 * Handle Piggy Bank Actions (set, add, remove)
 *
 * TODO Sprint Atomicity-Savings v2: this function still does a manual
 * SELECT-then-UPDATE/INSERT sequence (L195-207 switch + updatePiggyBank
 * OR direct INSERT). It is NOT atomic across the read+write. Wire onto
 * the existing `transferFromPiggyToBudget` RPC OR introduce a new RPC
 * (`set_piggy_bank_amount`?) that handles the 3 action types in one tx.
 * Out of scope this sprint (single-target focus on the 3 cleanup-attempts).
 */
async function handlePiggyBankAction(
  profile: AuthedProfile,
  context: string,
  action: string,
  amount: number,
) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
  }

  // Determine context filter
  const contextFilter =
    context === 'group' && profile.group_id
      ? { group_id: profile.group_id, profile_id: null }
      : { profile_id: profile.id, group_id: null }

  const matchFilter =
    context === 'group' && profile.group_id
      ? { group_id: profile.group_id }
      : { profile_id: profile.id }

  // Get current piggy bank
  const { data: currentPiggyBank, error: getPiggyError } = await supabaseServer
    .from('piggy_bank')
    .select('id, amount')
    .match(matchFilter)
    .maybeSingle()

  if (getPiggyError) {
    return NextResponse.json(
      { error: 'Erreur lors de la récupération de la tirelire' },
      { status: 500 },
    )
  }

  const currentAmount = currentPiggyBank?.amount || 0

  let newAmount: number

  switch (action) {
    case 'set_piggy_bank':
      newAmount = Math.max(0, amount)
      break
    case 'add_to_piggy_bank':
      newAmount = currentAmount + Math.max(0, amount)
      break
    case 'remove_from_piggy_bank':
      newAmount = Math.max(0, currentAmount - Math.max(0, amount))
      break
    default:
      return NextResponse.json({ error: `Action inconnue: ${action}` }, { status: 400 })
  }

  // Update or insert piggy bank (RPC atomique sur le delta)
  if (currentPiggyBank) {
    try {
      const delta = newAmount - currentAmount
      newAmount = await updatePiggyBank(matchFilter as Parameters<typeof updatePiggyBank>[0], delta)
    } catch {
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour de la tirelire' },
        { status: 500 },
      )
    }
  } else {
    // Insert new
    const { error: insertError } = await supabaseServer.from('piggy_bank').insert({
      ...contextFilter,
      amount: newAmount,
      last_updated: new Date().toISOString(),
    })

    if (insertError) {
      return NextResponse.json(
        { error: 'Erreur lors de la création de la tirelire' },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({
    success: true,
    action,
    previous_amount: currentAmount,
    new_amount: newAmount,
    difference: newAmount - currentAmount,
    context,
  })
}

/**
 * Handle Budget → Piggy Bank Transfer
 * Removes savings from a budget and adds them to the piggy bank
 * atomically via the composite RPC `transfer_budget_to_piggy_bank`
 * (Sprint Atomicity-Savings). The UPSERT handles both "piggy exists"
 * and "piggy missing" cases in a single SQL statement.
 */
async function handleBudgetToPiggyBank(
  profile: AuthedProfile,
  context: string,
  fromBudgetId: string,
  amount: number,
) {
  if (!fromBudgetId || typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Paramètres manquants ou invalides' }, { status: 400 })
  }

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
