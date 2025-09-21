import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/monthly-recap/transfer
 *
 * Effectue un transfert d'économies entre budgets
 * Body: {
 *   context: 'profile' | 'group',
 *   from_budget_id: string,
 *   to_budget_id: string,
 *   amount: number,
 *   monthly_recap_id?: string (optionnel pour l'instant)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Validation de la session
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json(
        { error: 'Session invalide' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      context = 'profile',
      from_budget_id,
      to_budget_id,
      amount,
      monthly_recap_id
    } = body

    // Validations
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    if (!from_budget_id || !to_budget_id || !amount) {
      return NextResponse.json(
        { error: 'from_budget_id, to_budget_id et amount sont requis' },
        { status: 400 }
      )
    }

    if (from_budget_id === to_budget_id) {
      return NextResponse.json(
        { error: 'Les budgets source et destination doivent être différents' },
        { status: 400 }
      )
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Le montant doit être positif' },
        { status: 400 }
      )
    }

    const userId = sessionData.userId

    // Récupérer le profil utilisateur
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profil utilisateur non trouvé' },
        { status: 404 }
      )
    }

    const contextId = context === 'profile' ? profile.id : profile.group_id

    if (context === 'group' && !profile.group_id) {
      return NextResponse.json(
        { error: 'Utilisateur ne fait partie d\'aucun groupe' },
        { status: 400 }
      )
    }

    // Vérifier que les deux budgets appartiennent au bon propriétaire
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'

    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, monthly_surplus, monthly_deficit')
      .eq(ownerField, contextId)
      .in('id', [from_budget_id, to_budget_id])

    if (budgetsError || !budgets || budgets.length !== 2) {
      return NextResponse.json(
        { error: 'Un ou plusieurs budgets non trouvés ou non autorisés' },
        { status: 404 }
      )
    }

    const fromBudget = budgets.find(b => b.id === from_budget_id)
    const toBudget = budgets.find(b => b.id === to_budget_id)

    if (!fromBudget || !toBudget) {
      return NextResponse.json(
        { error: 'Budgets non trouvés' },
        { status: 404 }
      )
    }

    // Vérifier que le budget source a suffisamment d'économies
    const fromBudgetSurplus = fromBudget.monthly_surplus || 0
    if (fromBudgetSurplus < amount) {
      return NextResponse.json(
        {
          error: `Budget source "${fromBudget.name}" n'a que ${fromBudgetSurplus}€ d'économies disponibles`
        },
        { status: 400 }
      )
    }

    // Effectuer le transfert
    console.log(`💸 [Budget Transfer] ${fromBudget.name} → ${toBudget.name}: ${amount}€`)

    // Démarrer une transaction
    const { error: transactionError } = await supabaseServer.rpc('execute_budget_transfer', {
      p_from_budget_id: from_budget_id,
      p_to_budget_id: to_budget_id,
      p_amount: amount,
      p_monthly_recap_id: monthly_recap_id
    })

    if (transactionError) {
      // Si la fonction RPC n'existe pas, faire le transfert manuellement
      console.log('⚠️ Fonction RPC non disponible, transfert manuel...')

      // Mettre à jour les surplus/déficits des budgets
      const updates = []

      // Réduire le surplus du budget source
      updates.push(
        supabaseServer
          .from('estimated_budgets')
          .update({
            monthly_surplus: fromBudgetSurplus - amount,
            updated_at: new Date().toISOString()
          })
          .eq('id', from_budget_id)
      )

      // Augmenter le surplus du budget destination ou réduire son déficit
      const toBudgetSurplus = toBudget.monthly_surplus || 0
      const toBudgetDeficit = toBudget.monthly_deficit || 0

      if (toBudgetDeficit > 0) {
        // Si le budget destination a un déficit, on le réduit d'abord
        const deficitReduction = Math.min(amount, toBudgetDeficit)
        const surplusIncrease = amount - deficitReduction

        updates.push(
          supabaseServer
            .from('estimated_budgets')
            .update({
              monthly_deficit: toBudgetDeficit - deficitReduction,
              monthly_surplus: toBudgetSurplus + surplusIncrease,
              updated_at: new Date().toISOString()
            })
            .eq('id', to_budget_id)
        )
      } else {
        // Sinon, augmenter directement le surplus
        updates.push(
          supabaseServer
            .from('estimated_budgets')
            .update({
              monthly_surplus: toBudgetSurplus + amount,
              updated_at: new Date().toISOString()
            })
            .eq('id', to_budget_id)
        )
      }

      // Exécuter toutes les mises à jour
      const results = await Promise.all(updates)
      const hasErrors = results.some(result => result.error)

      if (hasErrors) {
        console.error('❌ Erreur lors du transfert:', results.map(r => r.error).filter(Boolean))
        return NextResponse.json(
          { error: 'Erreur lors du transfert entre budgets' },
          { status: 500 }
        )
      }

      // Enregistrer le transfert dans l'historique si on a un recap_id
      if (monthly_recap_id) {
        await supabaseServer
          .from('budget_transfers')
          .insert({
            monthly_recap_id,
            from_budget_id,
            to_budget_id,
            transfer_amount: amount,
            transfer_reason: 'Manual transfer via monthly recap'
          })
      }
    }

    console.log(`✅ [Budget Transfer] Transfert terminé: ${amount}€ de "${fromBudget.name}" vers "${toBudget.name}"`)

    return NextResponse.json({
      success: true,
      message: `${amount}€ transférés de "${fromBudget.name}" vers "${toBudget.name}"`,
      transfer: {
        from_budget: {
          id: fromBudget.id,
          name: fromBudget.name,
          new_surplus: fromBudgetSurplus - amount
        },
        to_budget: {
          id: toBudget.id,
          name: toBudget.name,
          previous_surplus: toBudget.monthly_surplus || 0,
          previous_deficit: toBudget.monthly_deficit || 0
        },
        amount
      }
    })

  } catch (error) {
    console.error('❌ Erreur lors du transfert entre budgets:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}