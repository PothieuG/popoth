import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

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
export async function POST(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId

    if (!userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await request.json()
    const { context = 'profile', action, from_budget_id, to_budget_id, amount } = body

    // Si c'est une action tirelire, déléguer à la fonction appropriée
    if (action && ['set_piggy_bank', 'add_to_piggy_bank', 'remove_from_piggy_bank'].includes(action)) {
      return handlePiggyBankAction(userId, context, action, amount)
    }

    // Transfert budget → tirelire
    if (action === 'budget_to_piggy_bank') {
      return handleBudgetToPiggyBank(userId, context, from_budget_id, amount)
    }

    // Sinon, c'est un transfert entre budgets
    if (!context || !from_budget_id || !to_budget_id || !amount) {
      return NextResponse.json(
        { error: 'Paramètres manquants' },
        { status: 400 }
      )
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Le montant doit être positif' },
        { status: 400 }
      )
    }

    if (from_budget_id === to_budget_id) {
      return NextResponse.json(
        { error: 'Les budgets source et destination doivent être différents' },
        { status: 400 }
      )
    }

    console.log(``)
    console.log(`💸💸💸 ========================================================`)
    console.log(`💸💸💸 [SAVINGS TRANSFER] DÉBUT DU TRANSFERT`)
    console.log(`💸💸💸 ========================================================`)
    console.log(`💸 Contexte: ${context}`)
    console.log(`💸 De budget: ${from_budget_id}`)
    console.log(`💸 Vers budget: ${to_budget_id}`)
    console.log(`💸 Montant: ${amount}€`)
    console.log(`💸💸💸 ========================================================`)

    // Get user profile to determine context
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      console.error('❌ Erreur récupération profil:', profileError)
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }

    // Determine context filter
    const contextFilter = context === 'group' && profile.group_id
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
      console.error('❌ Budget source non trouvé:', fromError)
      return NextResponse.json(
        { error: 'Budget source non trouvé' },
        { status: 404 }
      )
    }

    // 2. Get TO budget
    const { data: toBudget, error: toError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings')
      .eq('id', to_budget_id)
      .match(contextFilter)
      .single()

    if (toError || !toBudget) {
      console.error('❌ Budget destination non trouvé:', toError)
      return NextResponse.json(
        { error: 'Budget destination non trouvé' },
        { status: 404 }
      )
    }

    // 3. Validate that source budget has enough savings
    const currentSavings = fromBudget.cumulated_savings || 0
    if (amount > currentSavings) {
      return NextResponse.json(
        {
          error: `Le budget ${fromBudget.name} n'a que ${currentSavings}€ d'économies disponibles`,
          available: currentSavings
        },
        { status: 400 }
      )
    }

    console.log(`✅ Validation OK:`)
    console.log(`   - Budget source: ${fromBudget.name} - ${currentSavings}€ disponibles`)
    console.log(`   - Budget destination: ${toBudget.name} - ${toBudget.cumulated_savings || 0}€ actuels`)

    // 4. Update FROM budget (subtract savings)
    const newFromSavings = currentSavings - amount
    const { error: updateFromError } = await supabaseServer
      .from('estimated_budgets')
      .update({
        cumulated_savings: newFromSavings,
        last_savings_update: new Date().toISOString()
      })
      .eq('id', from_budget_id)

    if (updateFromError) {
      console.error('❌ Erreur mise à jour budget source:', updateFromError)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du budget source' },
        { status: 500 }
      )
    }

    // 5. Update TO budget (add savings)
    const newToSavings = (toBudget.cumulated_savings || 0) + amount
    const { error: updateToError } = await supabaseServer
      .from('estimated_budgets')
      .update({
        cumulated_savings: newToSavings,
        last_savings_update: new Date().toISOString()
      })
      .eq('id', to_budget_id)

    if (updateToError) {
      console.error('❌ Erreur mise à jour budget destination:', updateToError)
      // Rollback from budget
      await supabaseServer
        .from('estimated_budgets')
        .update({ cumulated_savings: currentSavings })
        .eq('id', from_budget_id)

      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour du budget destination' },
        { status: 500 }
      )
    }

    console.log(``)
    console.log(`✅✅✅ TRANSFERT RÉUSSI`)
    console.log(`   - ${fromBudget.name}: ${currentSavings}€ → ${newFromSavings}€`)
    console.log(`   - ${toBudget.name}: ${toBudget.cumulated_savings || 0}€ → ${newToSavings}€`)
    console.log(`💸💸💸 ========================================================`)
    console.log(``)

    return NextResponse.json({
      success: true,
      message: `Transfert de ${amount}€ effectué`,
      from: {
        budget_id: from_budget_id,
        budget_name: fromBudget.name,
        old_savings: currentSavings,
        new_savings: newFromSavings
      },
      to: {
        budget_id: to_budget_id,
        budget_name: toBudget.name,
        old_savings: toBudget.cumulated_savings || 0,
        new_savings: newToSavings
      }
    })

  } catch (error) {
    console.error('❌ Erreur dans POST /api/savings/transfer:', error)
    return NextResponse.json(
      { error: 'Erreur serveur lors du transfert' },
      { status: 500 }
    )
  }
}

/**
 * Handle Piggy Bank Actions (set, add, remove)
 */
async function handlePiggyBankAction(
  userId: string,
  context: string,
  action: string,
  amount: number
) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return NextResponse.json(
      { error: 'Montant invalide' },
      { status: 400 }
    )
  }

  console.log(``)
  console.log(`🐷🐷🐷 ========================================================`)
  console.log(`🐷🐷🐷 [PIGGY BANK] ${action.toUpperCase()}`)
  console.log(`🐷🐷🐷 ========================================================`)
  console.log(`🐷 Action: ${action}`)
  console.log(`🐷 Montant: ${amount}€`)
  console.log(`🐷 Contexte: ${context}`)
  console.log(`🐷 User ID: ${userId}`)

  // Get user profile
  const { data: profile, error: profileError } = await supabaseServer
    .from('profiles')
    .select('id, group_id')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    console.error('❌ Erreur récupération profil:', profileError)
    return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
  }

  // Determine context filter
  const contextFilter = context === 'group' && profile.group_id
    ? { group_id: profile.group_id, profile_id: null }
    : { profile_id: profile.id, group_id: null }

  const matchFilter = context === 'group' && profile.group_id
    ? { group_id: profile.group_id }
    : { profile_id: profile.id }

  console.log(`🐷 Filtre appliqué:`, matchFilter)

  // Get current piggy bank
  const { data: currentPiggyBank, error: getPiggyError } = await supabaseServer
    .from('piggy_bank')
    .select('id, amount')
    .match(matchFilter)
    .maybeSingle()

  if (getPiggyError) {
    console.error('❌ Erreur récupération tirelire:', getPiggyError)
    return NextResponse.json(
      { error: 'Erreur lors de la récupération de la tirelire' },
      { status: 500 }
    )
  }

  const currentAmount = currentPiggyBank?.amount || 0
  console.log(`🐷 Montant actuel tirelire: ${currentAmount}€`)

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
      return NextResponse.json(
        { error: `Action inconnue: ${action}` },
        { status: 400 }
      )
  }

  console.log(`🐷 Nouveau montant tirelire: ${newAmount}€`)

  // Update or insert piggy bank
  if (currentPiggyBank) {
    // Update existing
    const { error: updateError } = await supabaseServer
      .from('piggy_bank')
      .update({
        amount: newAmount,
        last_updated: new Date().toISOString()
      })
      .eq('id', currentPiggyBank.id)

    if (updateError) {
      console.error('❌ Erreur mise à jour tirelire:', updateError)
      return NextResponse.json(
        { error: 'Erreur lors de la mise à jour de la tirelire' },
        { status: 500 }
      )
    }
  } else {
    // Insert new
    const { error: insertError } = await supabaseServer
      .from('piggy_bank')
      .insert({
        ...contextFilter,
        amount: newAmount,
        last_updated: new Date().toISOString()
      })

    if (insertError) {
      console.error('❌ Erreur création tirelire:', insertError)
      return NextResponse.json(
        { error: 'Erreur lors de la création de la tirelire' },
        { status: 500 }
      )
    }
  }

  console.log(`✅ Tirelire mise à jour avec succès`)
  console.log(`🐷🐷🐷 ========================================================`)
  console.log(``)

  return NextResponse.json({
    success: true,
    action,
    previous_amount: currentAmount,
    new_amount: newAmount,
    difference: newAmount - currentAmount,
    context
  })
}

/**
 * Handle Budget → Piggy Bank Transfer
 * Removes savings from a budget and adds them to the piggy bank
 */
async function handleBudgetToPiggyBank(
  userId: string,
  context: string,
  fromBudgetId: string,
  amount: number
) {
  if (!fromBudgetId || typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    return NextResponse.json(
      { error: 'Paramètres manquants ou invalides' },
      { status: 400 }
    )
  }

  // Get user profile
  const { data: profile, error: profileError } = await supabaseServer
    .from('profiles')
    .select('id, group_id')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
  }

  const contextFilter = context === 'group' && profile.group_id
    ? { group_id: profile.group_id }
    : { profile_id: profile.id }

  // 1. Get source budget
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
      { status: 400 }
    )
  }

  // 2. Remove from budget
  const newBudgetSavings = currentSavings - amount
  const { error: updateBudgetError } = await supabaseServer
    .from('estimated_budgets')
    .update({
      cumulated_savings: newBudgetSavings,
      last_savings_update: new Date().toISOString()
    })
    .eq('id', fromBudgetId)

  if (updateBudgetError) {
    return NextResponse.json({ error: 'Erreur mise à jour du budget' }, { status: 500 })
  }

  // 3. Add to piggy bank (upsert)
  const piggyContextFilter = context === 'group' && profile.group_id
    ? { group_id: profile.group_id, profile_id: null }
    : { profile_id: profile.id, group_id: null }

  const piggyMatchFilter = context === 'group' && profile.group_id
    ? { group_id: profile.group_id }
    : { profile_id: profile.id }

  const { data: currentPiggyBank } = await supabaseServer
    .from('piggy_bank')
    .select('id, amount')
    .match(piggyMatchFilter)
    .maybeSingle()

  const currentPiggyAmount = currentPiggyBank?.amount || 0
  const newPiggyAmount = currentPiggyAmount + amount

  if (currentPiggyBank) {
    const { error: updateError } = await supabaseServer
      .from('piggy_bank')
      .update({ amount: newPiggyAmount, last_updated: new Date().toISOString() })
      .eq('id', currentPiggyBank.id)

    if (updateError) {
      // Rollback budget
      await supabaseServer
        .from('estimated_budgets')
        .update({ cumulated_savings: currentSavings })
        .eq('id', fromBudgetId)
      return NextResponse.json({ error: 'Erreur mise à jour tirelire' }, { status: 500 })
    }
  } else {
    const { error: insertError } = await supabaseServer
      .from('piggy_bank')
      .insert({ ...piggyContextFilter, amount: newPiggyAmount, last_updated: new Date().toISOString() })

    if (insertError) {
      // Rollback budget
      await supabaseServer
        .from('estimated_budgets')
        .update({ cumulated_savings: currentSavings })
        .eq('id', fromBudgetId)
      return NextResponse.json({ error: 'Erreur création tirelire' }, { status: 500 })
    }
  }

  return NextResponse.json({
    success: true,
    action: 'budget_to_piggy_bank',
    from_budget: { name: fromBudget.name, old_savings: currentSavings, new_savings: newBudgetSavings },
    piggy_bank: { old_amount: currentPiggyAmount, new_amount: newPiggyAmount }
  })
}
