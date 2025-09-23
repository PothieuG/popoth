import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/populate-negative-savings-only
 *
 * Scénario: Reste à vivre négatif compensé uniquement par les économies des budgets
 * Simule un utilisateur avec un reste à vivre insuffisant mais des économies sur budgets
 * qui permettent exactement de compenser le déficit
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

    const userId = sessionData.userId
    console.log(`🏗️ [Negative Savings Only] Création scénario reste négatif + économies pour userId: ${userId}`)

    // 1. Supprimer les données existantes
    console.log('🗑️ [Negative Savings Only] Nettoyage des données existantes...')

    await supabaseServer.from('budget_transfers').delete().eq('profile_id', userId)
    await supabaseServer.from('real_expenses').delete().eq('profile_id', userId)
    await supabaseServer.from('real_income_entries').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_budgets').delete().eq('profile_id', userId)

    // 2. Désactiver les snapshots
    await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('profile_id', userId)
      .eq('is_active', true)

    // 3. Définir les budgets stratégiquement
    // Objectif: Créer ~800€ d'économies pour compenser un reste à vivre de -800€
    const budgetData = [
      // Budgets avec bonnes économies (total: ~800€ d'économies)
      { name: 'Vacances Reportées', estimated: 600, spent: 150, description: 'Vacances annulées' }, // +450€
      { name: 'Équipement Bureau', estimated: 400, spent: 120, description: 'Achat reporté' }, // +280€
      { name: 'Cours Particuliers', estimated: 200, spent: 130, description: 'Cours gratuits trouvés' }, // +70€

      // Budgets équilibrés ou légères économies
      { name: 'Courses', estimated: 350, spent: 350, description: 'Budget respecté' }, // 0€
      { name: 'Essence', estimated: 180, spent: 180, description: 'Déplacements nécessaires' }, // 0€
      { name: 'Loisirs', estimated: 150, spent: 120, description: 'Sorties réduites' }, // +30€

      // Budgets incompressibles (charges fixes)
      { name: 'Loyer', estimated: 1000, spent: 1000, description: 'Charges fixes' }, // 0€
      { name: 'Assurances', estimated: 120, spent: 120, description: 'Assurance obligatoire' }, // 0€
      { name: 'Électricité', estimated: 80, spent: 80, description: 'Facture EDF' }, // 0€
      { name: 'Internet', estimated: 45, spent: 45, description: 'Box internet' }, // 0€
      { name: 'Téléphone', estimated: 50, spent: 50, description: 'Forfait mobile' }, // 0€

      // Quelques déficits légers (pour réalisme mais compensés)
      { name: 'Santé', estimated: 100, spent: 140, description: 'Soins dentaires' }, // -40€
      { name: 'Vêtements', estimated: 80, spent: 110, description: 'Habits hiver nécessaires' }, // -30€
      { name: 'Transport', estimated: 60, spent: 75, description: 'Trajets supplémentaires' } // -15€
    ]

    // Total économies prévues: 450 + 280 + 70 + 30 - 40 - 30 - 15 = +745€
    // Cela devrait compenser un reste à vivre négatif d'environ -745€

    console.log(`📊 [Negative Savings Only] Création de ${budgetData.length} budgets pour compensation exacte`)

    // 4. Créer les budgets estimés
    const budgetInserts = budgetData.map(budget => ({
      profile_id: userId,
      name: budget.name,
      estimated_amount: budget.estimated,
      is_monthly_recurring: true,
      monthly_surplus: 0,
      monthly_deficit: 0,
      cumulated_savings: 0
    }))

    const { data: createdBudgets, error: budgetError } = await supabaseServer
      .from('estimated_budgets')
      .insert(budgetInserts)
      .select('id, name, estimated_amount')

    if (budgetError) {
      console.error('❌ [Negative Savings Only] Erreur création budgets:', budgetError)
      return NextResponse.json({ error: 'Erreur création budgets' }, { status: 500 })
    }

    console.log(`✅ [Negative Savings Only] ${createdBudgets.length} budgets créés`)

    // 5. Créer les dépenses réelles
    const expenseInserts = []
    const summary = []

    for (const budget of createdBudgets) {
      const budgetConfig = budgetData.find(b => b.name === budget.name)
      if (!budgetConfig) continue

      // Créer 1-2 dépenses par budget pour simplicité
      const numExpenses = budgetConfig.spent > 200 ? 2 : 1
      let totalSpent = 0

      for (let i = 0; i < numExpenses; i++) {
        let expenseAmount

        if (i === numExpenses - 1) {
          // Dernière dépense : ajuster pour atteindre le total exact
          expenseAmount = budgetConfig.spent - totalSpent
        } else {
          // Première dépense si il y en a 2
          expenseAmount = Math.floor(budgetConfig.spent * 0.7)
        }

        if (expenseAmount > 0) {
          expenseInserts.push({
            profile_id: userId,
            estimated_budget_id: budget.id,
            amount: expenseAmount,
            description: `${budgetConfig.description} - Achat ${i + 1}`,
            expense_date: '2025-09-22',
            is_exceptional: false
          })

          totalSpent += expenseAmount
        }
      }

      // Calculs pour le résumé
      const estimated = budget.estimated_amount
      const spent = budgetConfig.spent
      const difference = estimated - spent

      summary.push({
        name: budget.name,
        estimated,
        spent,
        difference,
        surplus: Math.max(0, difference),
        deficit: Math.max(0, -difference),
        status: difference > 0 ? 'surplus' : difference < 0 ? 'deficit' : 'balanced'
      })

      const symbol = difference > 0 ? '+' : ''
      console.log(`📝 [Negative Savings Only] ${budget.name}: ${spent}€ / ${estimated}€ → ${symbol}${difference}€`)
    }

    // 6. Insérer toutes les dépenses
    const { error: expenseError } = await supabaseServer
      .from('real_expenses')
      .insert(expenseInserts)

    if (expenseError) {
      console.error('❌ [Negative Savings Only] Erreur création dépenses:', expenseError)
      return NextResponse.json({ error: 'Erreur création dépenses' }, { status: 500 })
    }

    console.log(`✅ [Negative Savings Only] ${expenseInserts.length} dépenses créées`)

    // 7. Calculer les statistiques globales
    const totalSurplus = summary.reduce((sum, item) => sum + item.surplus, 0)
    const totalDeficit = summary.reduce((sum, item) => sum + item.deficit, 0)
    const netSavings = totalSurplus - totalDeficit

    const budgetsByStatus = {
      surplus: summary.filter(b => b.status === 'surplus'),
      deficit: summary.filter(b => b.status === 'deficit'),
      balanced: summary.filter(b => b.status === 'balanced')
    }

    // Simulation du reste à vivre négatif (approximatif)
    const simulatedNegativeRemainder = -netSavings // Pour que ça s'équilibre exactement

    console.log('📊 [Negative Savings Only] Statistiques générées:')
    console.log(`💚 Total économies: ${totalSurplus}€`)
    console.log(`❤️ Total déficits: ${totalDeficit}€`)
    console.log(`💰 Économies nettes: ${netSavings}€`)
    console.log(`🔴 Reste à vivre simulé: ${simulatedNegativeRemainder}€`)
    console.log(`⚖️ Compensation: ${netSavings + simulatedNegativeRemainder}€ (devrait être ~0)`)

    return NextResponse.json({
      success: true,
      message: 'Scénario "Reste négatif compensé par économies uniquement" créé avec succès',
      scenario: 'negative-remainder-savings-only',
      description: 'Le reste à vivre négatif est exactement compensé par les économies sur les budgets',
      statistics: {
        totalBudgets: createdBudgets.length,
        totalExpenses: expenseInserts.length,
        budgetsByStatus,
        totals: {
          surplus: totalSurplus,
          deficit: totalDeficit,
          netSavings: netSavings,
          simulatedNegativeRemainder: simulatedNegativeRemainder,
          finalBalance: netSavings + simulatedNegativeRemainder
        }
      },
      summary: summary.sort((a, b) => b.difference - a.difference),
      testScenario: {
        remainderToLive: simulatedNegativeRemainder,
        budgetSavings: netSavings,
        compensation: 'savings-only',
        balanced: Math.abs(netSavings + simulatedNegativeRemainder) < 10
      },
      actions: {
        budgetsCreated: createdBudgets.length,
        expensesCreated: expenseInserts.length,
        previousDataDeleted: true,
        snapshotsDeactivated: true
      }
    })

  } catch (error) {
    console.error('❌ [Negative Savings Only] Erreur générale:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}