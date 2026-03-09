import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/populate-balanced-risky
 *
 * Scénario: RAV ÉQUILIBRÉ MAIS RISQUÉ - Situation en équilibre précaire
 * - Revenus moyens (2800€)
 * - Budgets serrés avec peu de marge d'erreur
 * - RAV faiblement positif mais volatile
 * - Un imprévu peut basculer en négatif
 */
export async function POST(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }

    const userId = sessionData.userId
    console.log(`🟡 [Balanced Risky] Création scénario équilibré risqué pour userId: ${userId}`)

    // 1. Nettoyage complet
    console.log('🗑️ [Balanced Risky] Nettoyage des données existantes...')
    await supabaseServer.from('budget_transfers').delete().eq('profile_id', userId)
    await supabaseServer.from('real_expenses').delete().eq('profile_id', userId)
    await supabaseServer.from('real_income_entries').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_budgets').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_incomes').delete().eq('profile_id', userId)
    await supabaseServer.from('monthly_recaps').delete().eq('profile_id', userId)
    await supabaseServer.from('recap_snapshots').update({ is_active: false }).eq('profile_id', userId)

    // 2. Mettre à jour le solde bancaire - Situation tendue
    await supabaseServer
      .from('user_profiles')
      .update({ bank_balance: 3200 }) // Solde correct mais sans marge
      .eq('id', userId)

    // 3. Créer des revenus moyens avec instabilité
    // TOTAL ESTIMÉ: 4050€ pour un RAV budgétaire d'environ +190€ (précaire)
    const incomeData = [
      { name: 'Salaire Principal', estimated: 3200, real: 3100 }, // Léger moins que prévu
      { name: 'Prime Variable', estimated: 450, real: 350 }, // Performance mitigée
      { name: 'Activité Secondaire', estimated: 400, real: 480 } // Compensé par extra
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

    // 4. Budgets SERRÉS - Peu de marge d'erreur
    const budgetData = [
      // Logement - Cher mais maîtrisé
      { name: 'Loyer', estimated: 850, spent: 850, description: 'Loyer fixe - aucune marge' },
      { name: 'Charges & Énergie', estimated: 180, spent: 195, description: 'Dépassement hivernal' },

      // Transport - Budget serré
      { name: 'Essence', estimated: 220, spent: 235, description: 'Prix fluctuants du carburant' },
      { name: 'Assurance Auto', estimated: 85, spent: 85, description: 'Contrat fixe optimisé' },
      { name: 'Entretien Véhicule', estimated: 150, spent: 85, description: 'Pas de grosse réparation ce mois' },

      // Alimentation - Gestion stricte
      { name: 'Courses', estimated: 320, spent: 340, description: 'Légère inflation sur produits de base' },
      { name: 'Restaurants', estimated: 120, spent: 80, description: 'Effort d\'économie sur sorties' },

      // Santé et obligations
      { name: 'Santé & Pharmacie', estimated: 90, spent: 125, description: 'Frais dentiste imprévus' },
      { name: 'Assurances Obligatoires', estimated: 120, spent: 120, description: 'Contrats fixes' },
      { name: 'Téléphone & Internet', estimated: 75, spent: 75, description: 'Forfaits essentiels' },

      // Crédits - Charges fixes importantes
      { name: 'Crédit Immo', estimated: 450, spent: 450, description: 'Mensualité fixe' },
      { name: 'Crédit Auto', estimated: 180, spent: 180, description: 'Remboursement régulier' },

      // Projets avec économies forcées
      { name: 'Épargne Obligatoire', estimated: 200, spent: 200, description: 'Épargne automatique maintenue' },
      { name: 'Vacances', estimated: 150, spent: 45, description: 'Report pour économiser' },
      { name: 'Équipement Maison', estimated: 120, spent: 30, description: 'Achats reportés' },

      // Vie quotidienne optimisée
      { name: 'Vêtements', estimated: 80, spent: 45, description: 'Achats limités au strict nécessaire' },
      { name: 'Loisirs', estimated: 100, spent: 65, description: 'Activités gratuites privilégiées' },
      { name: 'Cadeaux & Sorties', estimated: 90, spent: 110, description: 'Anniversaire famille important' },

      // Imprévus gérés de justesse
      { name: 'Réparations Urgentes', estimated: 50, spent: 120, description: 'Électroménager en panne' },
      { name: 'Frais Bancaires', estimated: 15, spent: 25, description: 'Dépassement suite à imprévu' },

      // Quelques postes équilibrés
      { name: 'Produits Entretien', estimated: 40, spent: 40, description: 'Gestion précise stocks' },
      { name: 'Abonnements', estimated: 35, spent: 35, description: 'Services essentiels uniquement' },

      // Économies de bout de chandelle
      { name: 'Transport Public', estimated: 60, spent: 25, description: 'Vélo quand possible' },
      { name: 'Formation', estimated: 80, spent: 15, description: 'Ressources gratuites en ligne' }
    ]

    console.log(`📊 [Balanced Risky] Création de ${budgetData.length} budgets en équilibre précaire`)

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
        // Créer 1-2 dépenses par budget
        const numExpenses = budgetConfig.spent > 200 ? 2 : 1
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
              is_exceptional: Math.abs(budgetConfig.spent - budgetConfig.estimated) > budgetConfig.estimated * 0.3
            })
            totalSpent += expenseAmount
          }
        }
      }

      const difference = budget.estimated_amount - budgetConfig.spent
      const marginRate = budgetConfig.estimated > 0 ? Math.round((Math.abs(difference) / budgetConfig.estimated) * 100) : 0

      summary.push({
        name: budget.name,
        estimated: budget.estimated_amount,
        spent: budgetConfig.spent,
        difference,
        marginRate,
        surplus: Math.max(0, difference),
        deficit: Math.max(0, -difference),
        status: difference < 0 ? 'deficit' : difference > 0 ? 'surplus' : 'balanced',
        riskLevel: marginRate > 20 ? 'high' : marginRate > 10 ? 'medium' : 'low'
      })

      const statusEmoji = difference < -20 ? '🔴' : difference < 0 ? '🟠' : difference === 0 ? '⚪' : difference < 50 ? '🟡' : '🟢'
      const riskEmoji = marginRate > 20 ? '⚠️' : marginRate > 10 ? '⚡' : '✅'
      console.log(`${statusEmoji}${riskEmoji} [Balanced Risky] ${budget.name}: ${budgetConfig.spent}€ / ${budget.estimated_amount}€ → ${difference > 0 ? '+' : ''}${difference}€`)
    }

    await supabaseServer.from('real_expenses').insert(expenseInserts)

    // 7. Calculer les statistiques de risque
    const totalEstimatedBudgets = summary.reduce((sum, item) => sum + item.estimated, 0)
    const totalSpent = summary.reduce((sum, item) => sum + item.spent, 0)
    const totalSurplus = summary.reduce((sum, item) => sum + item.surplus, 0)
    const totalDeficit = summary.reduce((sum, item) => sum + item.deficit, 0)
    const netBalance = totalSurplus - totalDeficit

    const totalEstimatedIncome = incomeData.reduce((sum, income) => sum + income.estimated, 0)
    const totalRealIncome = incomeData.reduce((sum, income) => sum + income.real, 0)
    const budgetaryRAV = totalEstimatedIncome - totalEstimatedBudgets
    const actualRAV = totalRealIncome - totalSpent
    const monthlyBalance = totalRealIncome - totalSpent

    const highRiskBudgets = summary.filter(b => b.riskLevel === 'high')
    const budgetsInDeficit = summary.filter(b => b.status === 'deficit')
    const marginForError = Math.round((netBalance / totalEstimatedBudgets) * 100)

    const stabilityScore = Math.max(0, 100 - (highRiskBudgets.length * 10) - (budgetsInDeficit.length * 15))

    console.log('📊 [Balanced Risky] === SITUATION ÉQUILIBRÉE MAIS PRÉCAIRE ===')
    console.log(`💰 Solde bancaire: 3200€`)
    console.log(`💚 Revenus estimés: ${totalEstimatedIncome}€`)
    console.log(`💚 Revenus réels: ${totalRealIncome}€`)
    console.log(`📊 Budgets estimés: ${totalEstimatedBudgets}€`)
    console.log(`💸 Dépenses totales: ${totalSpent}€`)
    console.log(`⚖️ Balance nette: ${netBalance}€`)
    console.log(`🎯 RAV Budgétaire: ${budgetaryRAV}€`)
    console.log(`🎯 RAV Actuel: ${actualRAV}€`)
    console.log(`📊 Balance mensuelle: ${monthlyBalance}€`)
    console.log(`⚠️ Budgets à haut risque: ${highRiskBudgets.length}`)
    console.log(`🔴 Budgets en déficit: ${budgetsInDeficit.length}`)
    console.log(`📈 Score de stabilité: ${stabilityScore}/100`)

    return NextResponse.json({
      success: true,
      scenario: 'BALANCED_RISKY',
      message: '🟡 Scénario équilibré mais risqué créé - Situation financière précaire',
      financial_impact: {
        bankBalance: 3200,
        totalEstimatedIncome: totalEstimatedIncome,
        totalRealIncome: totalRealIncome,
        totalEstimatedBudgets: totalEstimatedBudgets,
        totalSpent: totalSpent,
        netBalance: netBalance,
        budgetaryRAV: budgetaryRAV,
        actualRAV: actualRAV,
        monthlyBalance: monthlyBalance,
        marginForError: marginForError,
        stabilityScore: stabilityScore,
        status: stabilityScore > 70 ? 'STABLE' : stabilityScore > 50 ? 'RISKY' : 'PRECARIOUS'
      },
      risk_analysis: {
        highRiskBudgets: highRiskBudgets.length,
        budgetsInDeficit: budgetsInDeficit.length,
        totalDeficitAmount: totalDeficit,
        averageMarginRate: Math.round(summary.reduce((sum, b) => sum + b.marginRate, 0) / summary.length),
        vulnerabilityToShocks: budgetaryRAV < 300
      },
      statistics: {
        totalBudgets: createdBudgets?.length ?? 0,
        totalExpenses: expenseInserts.length,
        budgetsInSurplus: summary.filter(b => b.status === 'surplus').length,
        budgetsInDeficit: budgetsInDeficit.length,
        budgetsBalanced: summary.filter(b => b.status === 'balanced').length
      },
      warning: '⚠️ ÉQUILIBRE PRÉCAIRE - Un imprévu majeur peut basculer la situation',
      recommendations: [
        'Constituer un fonds d\'urgence rapidement',
        'Identifier les postes de dépenses à optimiser',
        'Surveiller les budgets à haut risque',
        'Prévoir des scénarios de réduction des coûts'
      ],
      summary: summary.sort((a, b) => b.marginRate - a.marginRate)
    })

  } catch (error) {
    console.error('❌ [Balanced Risky] Erreur:', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
}