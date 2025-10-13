import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API Transfer Savings Between Budgets
 * Transfers cumulated savings from one estimated budget to another
 * POST /api/savings/transfer
 *
 * Body: {
 *   context: 'profile' | 'group',
 *   from_budget_id: string,
 *   to_budget_id: string,
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
    const { context, from_budget_id, to_budget_id, amount } = body

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
