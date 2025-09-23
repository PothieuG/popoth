import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/populate-positive-rav-savings
 *
 * Scénario: RAV TRÈS POSITIF - Gestion financière excellente
 * - Revenus élevés et stables (4500€)
 * - Budgets bien maîtrisés avec grosses économies
 * - RAV fortement positif permettant investissements
 * - Situation financière optimale
 */
export async function POST(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }

    const userId = sessionData.userId
    console.log(`🟢 [Positive RAV] Création scénario RAV très positif pour userId: ${userId}`)

    // 1. Nettoyage complet
    console.log('🗑️ [Positive RAV] Nettoyage des données existantes...')
    await supabaseServer.from('budget_transfers').delete().eq('profile_id', userId)
    await supabaseServer.from('real_expenses').delete().eq('profile_id', userId)
    await supabaseServer.from('real_income_entries').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_budgets').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_incomes').delete().eq('profile_id', userId)
    await supabaseServer.from('monthly_recaps').delete().eq('profile_id', userId)
    await supabaseServer.from('recap_snapshots').update({ is_active: false }).eq('profile_id', userId)

    // 2. Mettre à jour le solde bancaire - Excellente situation
    await supabaseServer
      .from('user_profiles')
      .update({ bank_balance: 25000 }) // Solde très confortable
      .eq('id', userId)

    // 3. Créer des revenus élevés et stables
    const incomeData = [
      { name: 'Salaire Senior Dev', estimated: 3200, real: 3350 }, // Bonus performance
      { name: 'Freelance Consulting', estimated: 800, real: 950 }, // Projets supplémentaires
      { name: 'Investissements', estimated: 300, real: 420 }, // Dividendes et plus-values
      { name: 'Revenus Passifs', estimated: 200, real: 280 } // Location ou autre
    ]

    const incomeInserts = incomeData.map(income => ({
      profile_id: userId,
      name: income.name,
      estimated_amount: income.estimated,
      is_monthly_recurring: true
    }))

    const { data: createdIncomes } = await supabaseServer
      .from('estimated_incomes')
      .insert(incomeInserts)
      .select('id, name, estimated_amount')

    // Créer les revenus réels
    for (const income of createdIncomes!) {
      const realData = incomeData.find(i => i.name === income.name)!
      await supabaseServer.from('real_income_entries').insert({
        profile_id: userId,
        estimated_income_id: income.id,
        amount: realData.real,
        income_date: '2025-09-22'
      })
    }

    // 4. Budgets avec GROSSES ÉCONOMIES - Gestion exemplaire
    const budgetData = [
      // Logement - Bien maîtrisé
      { name: 'Loyer/Prêt', estimated: 1200, spent: 1200, description: 'Logement fixe bien négocié' },
      { name: 'Charges Logement', estimated: 150, spent: 120, description: 'Économies énergie' },

      // Transport - Économies massives (télétravail)
      { name: 'Essence', estimated: 300, spent: 80, description: 'Télétravail 4j/5 - énormes économies' },
      { name: 'Transport Public', estimated: 150, spent: 30, description: 'Abonnement occasionnel uniquement' },
      { name: 'Entretien Véhicule', estimated: 200, spent: 45, description: 'Peu de kilomètres, entretien minimal' },

      // Alimentation - Optimisée
      { name: 'Courses', estimated: 400, spent: 280, description: 'Cuisine maison + marchés locaux' },
      { name: 'Restaurants', estimated: 250, spent: 120, description: 'Sorties réduites mais de qualité' },

      // Projets et économies massives
      { name: 'Vacances Été', estimated: 2000, spent: 650, description: 'Vacances chez amis + camping' },
      { name: 'Équipement Tech', estimated: 800, spent: 200, description: 'Matériel pro remboursé par employeur' },
      { name: 'Mobilier Maison', estimated: 600, spent: 150, description: 'Achats d\'occasion et DIY' },
      { name: 'Électroménager', estimated: 500, spent: 0, description: 'Aucun achat nécessaire cette année' },

      // Formation et développement
      { name: 'Formation Pro', estimated: 400, spent: 180, description: 'Formations en ligne pas chères' },
      { name: 'Livres & Cours', estimated: 100, spent: 35, description: 'Bibliothèque et ressources gratuites' },

      // Loisirs optimisés
      { name: 'Sport & Fitness', estimated: 180, spent: 45, description: 'Course outdoor + musculation maison' },
      { name: 'Loisirs Culture', estimated: 200, spent: 85, description: 'Activités gratuites et événements gratuits' },
      { name: 'Hobbies', estimated: 150, spent: 60, description: 'Projets créatifs peu coûteux' },

      // Vie quotidienne maîtrisée
      { name: 'Vêtements', estimated: 200, spent: 80, description: 'Achats réfléchis et de qualité' },
      { name: 'Produits Beauté', estimated: 80, spent: 35, description: 'Produits naturels économiques' },
      { name: 'Téléphone', estimated: 50, spent: 50, description: 'Forfait optimal sans excès' },
      { name: 'Internet', estimated: 45, spent: 45, description: 'Connexion nécessaire pour télétravail' },

      // Santé et assurances
      { name: 'Santé', estimated: 100, spent: 60, description: 'Bonne santé, peu de frais' },
      { name: 'Assurances', estimated: 180, spent: 160, description: 'Assurances bien négociées' },

      // Épargne et investissements - Objectifs atteints
      { name: 'Épargne Urgence', estimated: 500, spent: 500, description: 'Constitution fonds d\'urgence' },
      { name: 'Investissements PEA', estimated: 800, spent: 800, description: 'Investissement mensuel régulier' },
      { name: 'Épargne Projets', estimated: 400, spent: 400, description: 'Épargne pour futurs projets' },

      // Quelques postes avec de légères économies
      { name: 'Cadeaux Famille', estimated: 150, spent: 120, description: 'Cadeaux faits main et personnalisés' },
      { name: 'Sorties Amis', estimated: 120, spent: 90, description: 'Activités conviviales peu chères' }
    ]

    console.log(`📊 [Positive RAV] Création de ${budgetData.length} budgets avec grosses économies`)

    // 5. Créer les budgets
    const budgetInserts = budgetData.map(budget => ({
      profile_id: userId,
      name: budget.name,
      estimated_amount: budget.estimated,
      is_monthly_recurring: true,
      monthly_surplus: 0,
      monthly_deficit: 0,
      cumulated_savings: 0
    }))

    const { data: createdBudgets } = await supabaseServer
      .from('estimated_budgets')
      .insert(budgetInserts)
      .select('id, name, estimated_amount')

    // 6. Créer les dépenses réelles
    const expenseInserts = []
    const summary = []

    for (const budget of createdBudgets!) {
      const budgetConfig = budgetData.find(b => b.name === budget.name)!

      if (budgetConfig.spent > 0) {
        // Créer 1-2 dépenses par budget (gestion simple et organisée)
        const numExpenses = budgetConfig.spent > 300 ? 2 : 1
        let totalSpent = 0

        for (let i = 0; i < numExpenses; i++) {
          let expenseAmount
          if (i === numExpenses - 1) {
            expenseAmount = budgetConfig.spent - totalSpent
          } else {
            expenseAmount = Math.floor(budgetConfig.spent / numExpenses)
          }

          if (expenseAmount > 0) {
            expenseInserts.push({
              profile_id: userId,
              estimated_budget_id: budget.id,
              amount: expenseAmount,
              description: `${budgetConfig.description} - Paiement ${i + 1}`,
              expense_date: '2025-09-22',
              is_exceptional: false
            })
            totalSpent += expenseAmount
          }
        }
      }

      const difference = budget.estimated_amount - budgetConfig.spent
      const savingsRate = budgetConfig.estimated > 0 ? Math.round((difference / budgetConfig.estimated) * 100) : 0

      summary.push({
        name: budget.name,
        estimated: budget.estimated_amount,
        spent: budgetConfig.spent,
        difference,
        savingsRate,
        surplus: Math.max(0, difference),
        deficit: Math.max(0, -difference),
        status: difference < 0 ? 'deficit' : difference > 0 ? 'surplus' : 'balanced'
      })

      const statusEmoji = difference > 100 ? '💚' : difference > 0 ? '🟢' : difference === 0 ? '⚪' : '🔴'
      const savingsText = savingsRate > 0 ? ` (${savingsRate}% économie)` : ''
      console.log(`${statusEmoji} [Positive RAV] ${budget.name}: ${budgetConfig.spent}€ / ${budget.estimated_amount}€ → +${difference}€${savingsText}`)
    }

    await supabaseServer.from('real_expenses').insert(expenseInserts)

    // 7. Calculer les statistiques excellentes
    const totalEstimated = summary.reduce((sum, item) => sum + item.estimated, 0)
    const totalSpent = summary.reduce((sum, item) => sum + item.spent, 0)
    const totalSavings = totalEstimated - totalSpent
    const savingsRate = Math.round((totalSavings / totalEstimated) * 100)

    const totalRealIncome = incomeData.reduce((sum, income) => sum + income.real, 0)
    const estimatedRAV = 25000 + totalRealIncome - totalSpent // Solde + revenus - dépenses
    const monthlyRAVIncrease = totalRealIncome - totalSpent

    const bigSaversBudgets = summary.filter(b => b.savingsRate >= 50)
    const totalBigSavings = bigSaversBudgets.reduce((sum, b) => sum + b.surplus, 0)

    console.log('📊 [Positive RAV] === SITUATION FINANCIÈRE EXCELLENTE ===')
    console.log(`💰 Solde bancaire: 25000€`)
    console.log(`💚 Revenus réels: ${totalRealIncome}€`)
    console.log(`💸 Dépenses totales: ${totalSpent}€`)
    console.log(`💎 Économies totales: ${totalSavings}€ (${savingsRate}%)`)
    console.log(`🚀 RAV estimé: ${estimatedRAV}€ (EXCELLENT!)`)
    console.log(`📈 Progression RAV mensuelle: +${monthlyRAVIncrease}€`)
    console.log(`🎯 Budgets avec >50% économies: ${bigSaversBudgets.length} (${totalBigSavings}€)`)

    return NextResponse.json({
      success: true,
      scenario: 'POSITIVE_RAV_SAVINGS',
      message: '💚 Scénario RAV très positif créé - Gestion financière excellente',
      financial_impact: {
        bankBalance: 25000,
        totalRealIncome: totalRealIncome,
        totalSpent: totalSpent,
        totalSavings: totalSavings,
        savingsRate: savingsRate,
        estimatedRAV: estimatedRAV,
        monthlyRAVIncrease: monthlyRAVIncrease,
        status: 'EXCELLENT'
      },
      achievements: {
        bigSaversBudgets: bigSaversBudgets.length,
        totalBigSavings: totalBigSavings,
        averageSavingsRate: Math.round(summary.reduce((sum, b) => sum + b.savingsRate, 0) / summary.length),
        sustainableGrowth: monthlyRAVIncrease > 1000
      },
      statistics: {
        totalBudgets: createdBudgets.length,
        totalExpenses: expenseInserts.length,
        budgetsInSurplus: summary.filter(b => b.status === 'surplus').length,
        budgetsInDeficit: summary.filter(b => b.status === 'deficit').length,
        budgetsBalanced: summary.filter(b => b.status === 'balanced').length
      },
      success_message: '🎉 RAV TRÈS POSITIF - Situation financière optimale pour investissements',
      summary: summary.sort((a, b) => b.savingsRate - a.savingsRate)
    })

  } catch (error) {
    console.error('❌ [Positive RAV] Erreur:', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
}