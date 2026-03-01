import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/populate-massive-savings
 *
 * Scénario: Énormément d'économies sur les budgets
 * Teste le cas où l'utilisateur a fait beaucoup d'économies sur presque tous ses budgets
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
    console.log(`🏗️ [Massive Savings] Création de budgets avec énormes économies pour userId: ${userId}`)

    // 1. Supprimer les données existantes + MONTHLY RECAPS
    console.log('🗑️ [Massive Savings] Nettoyage des données existantes...')

    await supabaseServer.from('budget_transfers').delete().eq('profile_id', userId)
    await supabaseServer.from('real_expenses').delete().eq('profile_id', userId)
    await supabaseServer.from('real_income_entries').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_budgets').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_incomes').delete().eq('profile_id', userId)

    // NOUVEAU: Supprimer les monthly recaps pour forcer le recalcul
    await supabaseServer.from('monthly_recaps').delete().eq('profile_id', userId)
    console.log('🧹 [Massive Savings] Monthly recaps supprimés pour forcer le recalcul')

    // 2. Désactiver les snapshots
    await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('profile_id', userId)
      .eq('is_active', true)

    // 3. Définir les budgets avec énormes économies (budgets MENSUELS réalistes)
    // TOTAL ESTIMÉ: ~3800€ avec revenus de ~4200€ pour RAV positif
    const budgetData = [
      // Logement fixe (1350€)
      { name: 'Loyer', estimated: 1200, spent: 1200, description: 'Charges fixes' },
      { name: 'Charges', estimated: 150, spent: 130, description: 'Économies énergie' },

      // Transport avec grosses économies (250€ estimé → 80€ dépensé = 68% économie)
      { name: 'Essence', estimated: 180, spent: 50, description: 'Télétravail quasi total' },
      { name: 'Transport Public', estimated: 70, spent: 30, description: 'Trajets occasionnels' },

      // Alimentation optimisée (550€ estimé → 280€ = 49% économie)
      { name: 'Courses', estimated: 400, spent: 220, description: 'Anti-gaspi et promos' },
      { name: 'Restaurants', estimated: 150, spent: 60, description: 'Cuisine maison privilégiée' },

      // Loisirs avec énormes économies (400€ estimé → 100€ = 75% économie)
      { name: 'Sorties Culture', estimated: 120, spent: 25, description: 'Événements gratuits' },
      { name: 'Sport', estimated: 80, spent: 0, description: 'Sport outdoor gratuit' },
      { name: 'Hobbies', estimated: 100, spent: 35, description: 'Projets DIY récup' },
      { name: 'Streaming', estimated: 50, spent: 15, description: 'Abonnements partagés' },
      { name: 'Sorties Amis', estimated: 50, spent: 25, description: 'Apéros maison' },

      // Vie quotidienne très économe (350€ estimé → 120€ = 66% économie)
      { name: 'Vêtements', estimated: 150, spent: 40, description: 'Seconde main uniquement' },
      { name: 'Produits Beauté', estimated: 60, spent: 20, description: 'Produits naturels' },
      { name: 'Cadeaux', estimated: 80, spent: 30, description: 'Cadeaux faits main' },
      { name: 'Produits Ménage', estimated: 60, spent: 30, description: 'Produits écologiques' },

      // Fixes incompressibles (245€)
      { name: 'Téléphone', estimated: 25, spent: 25, description: 'Forfait mini' },
      { name: 'Internet', estimated: 40, spent: 40, description: 'Abonnement' },
      { name: 'Assurances', estimated: 180, spent: 180, description: 'Assurances obligatoires' },

      // Épargne (400€ - pas d'économie car c'est volontaire)
      { name: 'Épargne', estimated: 300, spent: 300, description: 'Épargne mensuelle' },
      { name: 'Investissement', estimated: 100, spent: 100, description: 'ETF mensuel' },

      // Un petit déficit pour le réalisme
      { name: 'Santé', estimated: 80, spent: 120, description: 'Frais dentaires imprévus' }
    ]

    console.log(`📊 [Massive Savings] Création de ${budgetData.length} budgets avec énormes économies`)

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
      console.error('❌ [Massive Savings] Erreur création budgets:', budgetError)
      return NextResponse.json({ error: 'Erreur création budgets' }, { status: 500 })
    }

    console.log(`✅ [Massive Savings] ${createdBudgets.length} budgets créés`)

    // 5. Créer les dépenses réelles
    const expenseInserts = []
    const summary = []

    for (const budget of createdBudgets) {
      const budgetConfig = budgetData.find(b => b.name === budget.name)
      if (!budgetConfig) continue

      // Créer 1-3 dépenses par budget
      const numExpenses = Math.floor(Math.random() * 3) + 1
      let totalSpent = 0

      for (let i = 0; i < numExpenses; i++) {
        let expenseAmount

        if (i === numExpenses - 1) {
          // Dernière dépense : ajuster pour atteindre le total exact
          expenseAmount = budgetConfig.spent - totalSpent
        } else {
          // Dépenses intermédiaires
          const remaining = budgetConfig.spent - totalSpent
          expenseAmount = Math.max(5, Math.floor(remaining / (numExpenses - i)))
        }

        if (expenseAmount > 0) {
          expenseInserts.push({
            profile_id: userId,
            estimated_budget_id: budget.id,
            amount: expenseAmount,
            description: `${budgetConfig.description} - Dépense ${i + 1}`,
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
      const savingsPercent = ((difference / estimated) * 100).toFixed(1)

      summary.push({
        name: budget.name,
        estimated,
        spent,
        difference,
        savingsPercent: `${savingsPercent}%`,
        surplus: Math.max(0, difference),
        deficit: Math.max(0, -difference),
        status: difference > 0 ? 'surplus' : difference < 0 ? 'deficit' : 'balanced'
      })

      console.log(`📝 [Massive Savings] ${budget.name}: ${spent}€ / ${estimated}€ → +${difference}€ (${savingsPercent}% économie)`)
    }

    // 6. Insérer toutes les dépenses
    const { error: expenseError } = await supabaseServer
      .from('real_expenses')
      .insert(expenseInserts)

    if (expenseError) {
      console.error('❌ [Massive Savings] Erreur création dépenses:', expenseError)
      return NextResponse.json({ error: 'Erreur création dépenses' }, { status: 500 })
    }

    console.log(`✅ [Massive Savings] ${expenseInserts.length} dépenses créées`)

    // 7. Créer des revenus estimés et réels (revenus > budgets pour RAV positif)
    const incomeData = [
      { name: 'Salaire', estimated: 3200, real: 3200 },
      { name: 'Prime Performance', estimated: 200, real: 350 },
      { name: 'Freelance', estimated: 400, real: 480 }
    ]

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
      console.error('❌ [Massive Savings] Erreur création revenus:', incomeError)
      return NextResponse.json({ error: 'Erreur création revenus' }, { status: 500 })
    }

    // Créer les revenus réels
    for (const income of createdIncomes!) {
      const incomeConfig = incomeData.find(i => i.name === income.name)!
      await supabaseServer.from('real_income_entries').insert({
        profile_id: userId,
        estimated_income_id: income.id,
        amount: incomeConfig.real,
        income_date: '2025-09-22'
      })
    }

    const totalEstimatedIncome = incomeData.reduce((sum, i) => sum + i.estimated, 0)
    const totalRealIncome = incomeData.reduce((sum, i) => sum + i.real, 0)
    console.log(`✅ [Massive Savings] Revenus créés: ${totalEstimatedIncome}€ estimé, ${totalRealIncome}€ réel`)

    // 9. Calculer les statistiques globales
    const totalEstimatedBudgets = summary.reduce((sum, item) => sum + item.estimated, 0)
    const totalSpent = summary.reduce((sum, item) => sum + item.spent, 0)
    const totalSavings = totalEstimatedBudgets - totalSpent
    const globalSavingsPercent = ((totalSavings / totalEstimatedBudgets) * 100).toFixed(1)

    const budgetaryRAV = totalEstimatedIncome - totalEstimatedBudgets
    const actualRAV = totalRealIncome - totalSpent

    const budgetsByStatus = {
      surplus: summary.filter(b => b.status === 'surplus'),
      deficit: summary.filter(b => b.status === 'deficit'),
      balanced: summary.filter(b => b.status === 'balanced')
    }

    console.log('📊 [Massive Savings] Statistiques générées:')
    console.log(`💰 Revenus estimés: ${totalEstimatedIncome}€`)
    console.log(`💰 Revenus réels: ${totalRealIncome}€`)
    console.log(`📊 Budgets estimés: ${totalEstimatedBudgets}€`)
    console.log(`💸 Total dépensé: ${totalSpent}€`)
    console.log(`💚 Total économies: ${totalSavings}€ (${globalSavingsPercent}%)`)
    console.log(`🎯 RAV Budgétaire: ${budgetaryRAV}€`)
    console.log(`🎯 RAV Actuel: ${actualRAV}€`)
    console.log(`📈 Budgets en surplus: ${budgetsByStatus.surplus.length}`)
    console.log(`📉 Budgets en déficit: ${budgetsByStatus.deficit.length}`)

    return NextResponse.json({
      success: true,
      message: 'Scénario "Énormes économies" créé avec succès',
      scenario: 'massive-savings',
      statistics: {
        totalBudgets: createdBudgets.length,
        totalExpenses: expenseInserts.length,
        totalIncomes: createdIncomes!.length,
        budgetsByStatus,
        totals: {
          estimatedIncome: totalEstimatedIncome,
          realIncome: totalRealIncome,
          estimatedBudgets: totalEstimatedBudgets,
          spent: totalSpent,
          savings: totalSavings,
          savingsPercent: `${globalSavingsPercent}%`,
          budgetaryRAV: budgetaryRAV,
          actualRAV: actualRAV
        }
      },
      summary: summary.sort((a, b) => b.difference - a.difference),
      financial_impact: {
        budgetaryRAV: budgetaryRAV,
        actualRAV: actualRAV,
        status: budgetaryRAV > 0 ? 'POSITIVE' : 'NEGATIVE'
      },
      actions: {
        budgetsCreated: createdBudgets.length,
        expensesCreated: expenseInserts.length,
        incomesCreated: createdIncomes!.length,
        previousDataDeleted: true,
        snapshotsDeactivated: true
      }
    })

  } catch (error) {
    console.error('❌ [Massive Savings] Erreur générale:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}