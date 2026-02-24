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
    await supabaseServer.from('estimated_incomes').delete().eq('profile_id', userId)
    await supabaseServer.from('monthly_recaps').delete().eq('profile_id', userId)

    // 2. Désactiver les snapshots
    await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('profile_id', userId)
      .eq('is_active', true)

    // 3. Créer des revenus - IMPORTANT pour avoir un RAV budgétaire positif
    // Total budgets estimés = 3415€, donc revenus estimés > 3415€
    // Mais revenus réels < revenus estimés pour créer un déficit sur le RAV actuel
    const incomeData = [
      { name: 'Salaire', estimated: 2800, real: 2200 }, // Baisse de salaire inattendue
      { name: 'Freelance', estimated: 600, real: 300 }, // Moins de missions que prévu
      { name: 'Autres revenus', estimated: 200, real: 100 } // Revenus ponctuels réduits
    ]
    // Total estimé: 3600€, Total réel: 2600€
    // RAV budgétaire = 3600 - 3415 = +185€ (positif ✓)
    // RAV actuel = 2600 - 2670 = -70€ (négatif, mais les économies sur budgets compensent)

    console.log('💰 [Negative Savings Only] Création des revenus...')

    const incomeInserts = incomeData.map(income => ({
      profile_id: userId,
      name: income.name,
      estimated_amount: income.estimated,
      is_monthly_recurring: true
    }))

    const { data: createdIncomes, error: incomeError } = await supabaseServer
      .from('estimated_incomes')
      .insert(incomeInserts)
      .select('id, name, estimated_amount')

    if (incomeError) {
      console.error('❌ [Negative Savings Only] Erreur création revenus:', incomeError)
      return NextResponse.json({ error: 'Erreur création revenus' }, { status: 500 })
    }

    // Créer les revenus réels (inférieurs aux estimés pour créer le déficit)
    for (const income of createdIncomes!) {
      const realData = incomeData.find(i => i.name === income.name)!
      await supabaseServer.from('real_income_entries').insert({
        profile_id: userId,
        estimated_income_id: income.id,
        amount: realData.real,
        income_date: '2025-09-22'
      })
    }

    const totalEstimatedIncome = incomeData.reduce((sum, i) => sum + i.estimated, 0)
    const totalRealIncome = incomeData.reduce((sum, i) => sum + i.real, 0)
    console.log(`✅ [Negative Savings Only] Revenus créés: estimé ${totalEstimatedIncome}€, réel ${totalRealIncome}€`)

    // 5. Définir les budgets stratégiquement
    // Objectif: Créer des économies pour compenser le déficit du RAV actuel
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

    console.log(`📊 [Negative Savings Only] Création de ${budgetData.length} budgets`)

    // 6. Créer les budgets estimés
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

    // 7. Créer les dépenses réelles
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

    // 8. Insérer toutes les dépenses
    const { error: expenseError } = await supabaseServer
      .from('real_expenses')
      .insert(expenseInserts)

    if (expenseError) {
      console.error('❌ [Negative Savings Only] Erreur création dépenses:', expenseError)
      return NextResponse.json({ error: 'Erreur création dépenses' }, { status: 500 })
    }

    console.log(`✅ [Negative Savings Only] ${expenseInserts.length} dépenses créées`)

    // 9. Calculer les statistiques globales
    const totalSurplus = summary.reduce((sum, item) => sum + item.surplus, 0)
    const totalDeficit = summary.reduce((sum, item) => sum + item.deficit, 0)
    const netBudgetSavings = totalSurplus - totalDeficit

    const budgetsByStatus = {
      surplus: summary.filter(b => b.status === 'surplus'),
      deficit: summary.filter(b => b.status === 'deficit'),
      balanced: summary.filter(b => b.status === 'balanced')
    }

    // Calcul des RAV
    const totalEstimatedBudgets = summary.reduce((sum, item) => sum + item.estimated, 0)
    const totalRealExpenses = summary.reduce((sum, item) => sum + item.spent, 0)

    const ravBudgetaire = totalEstimatedIncome - totalEstimatedBudgets
    const ravActuel = totalRealIncome - totalRealExpenses
    const gap = ravActuel - ravBudgetaire

    console.log('📊 [Negative Savings Only] Statistiques générées:')
    console.log(`💰 Revenus estimés: ${totalEstimatedIncome}€`)
    console.log(`💸 Revenus réels: ${totalRealIncome}€`)
    console.log(`📋 Budgets estimés: ${totalEstimatedBudgets}€`)
    console.log(`💳 Dépenses réelles: ${totalRealExpenses}€`)
    console.log(`🎯 RAV Budgétaire: ${ravBudgetaire}€`)
    console.log(`📊 RAV Actuel: ${ravActuel}€`)
    console.log(`⚠️ Gap (RAV Actuel - RAV Budgétaire): ${gap}€`)
    console.log(`💚 Économies sur budgets: ${netBudgetSavings}€`)
    console.log(`⚖️ Compensation possible: ${netBudgetSavings >= Math.abs(gap) ? 'OUI ✅' : 'NON ❌'}`)

    return NextResponse.json({
      success: true,
      message: 'Scénario "Reste négatif compensé par économies uniquement" créé avec succès',
      scenario: 'negative-remainder-savings-only',
      description: 'Le RAV actuel est inférieur au RAV budgétaire, les économies sur budgets compensent le gap',
      statistics: {
        totalBudgets: createdBudgets!.length,
        totalExpenses: expenseInserts.length,
        totalIncomes: createdIncomes!.length,
        budgetsByStatus,
        totals: {
          estimatedIncome: totalEstimatedIncome,
          realIncome: totalRealIncome,
          estimatedBudgets: totalEstimatedBudgets,
          realExpenses: totalRealExpenses,
          budgetSurplus: totalSurplus,
          budgetDeficit: totalDeficit,
          netBudgetSavings: netBudgetSavings
        }
      },
      summary: summary.sort((a, b) => b.difference - a.difference),
      testScenario: {
        ravBudgetaire: ravBudgetaire,
        ravActuel: ravActuel,
        gap: gap,
        budgetSavings: netBudgetSavings,
        compensation: 'savings-only',
        canCompensate: netBudgetSavings >= Math.abs(gap)
      },
      actions: {
        budgetsCreated: createdBudgets!.length,
        expensesCreated: expenseInserts.length,
        incomesCreated: createdIncomes!.length,
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