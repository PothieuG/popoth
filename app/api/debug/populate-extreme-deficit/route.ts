import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/populate-extreme-deficit
 *
 * Scénario: DÉFICIT EXTRÊME - Crise financière majeure
 * - Revenus très faibles ou irréguliers (1800€)
 * - Urgences et imprévus multiples
 * - Déficits massifs sur la plupart des budgets
 * - RAV extrêmement négatif - Situation d'urgence
 */
export async function POST(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }

    const userId = sessionData.userId
    console.log(`🚨 [Extreme Deficit] Création scénario déficit extrême pour userId: ${userId}`)

    // 1. Nettoyage complet
    console.log('🗑️ [Extreme Deficit] Nettoyage des données existantes...')
    await supabaseServer.from('budget_transfers').delete().eq('profile_id', userId)
    await supabaseServer.from('real_expenses').delete().eq('profile_id', userId)
    await supabaseServer.from('real_income_entries').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_budgets').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_incomes').delete().eq('profile_id', userId)
    await supabaseServer.from('monthly_recaps').delete().eq('profile_id', userId)
    await supabaseServer.from('recap_snapshots').update({ is_active: false }).eq('profile_id', userId)

    // 2. Mettre à jour le solde bancaire - Situation critique
    await supabaseServer
      .from('user_profiles')
      .update({ bank_balance: -450 }) // Découvert important
      .eq('id', userId)

    // 3. Créer des revenus très faibles et irréguliers
    const incomeData = [
      { name: 'Emploi Partiel', estimated: 1200, real: 950 }, // Heures réduites
      { name: 'Allocations', estimated: 400, real: 320 }, // Réductions d'aides
      { name: 'Petits Boulots', estimated: 300, real: 180 } // Travail irrégulier
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

    // 4. Budgets avec DÉFICITS CATASTROPHIQUES - Crise complète
    const budgetData = [
      // Logement - Situation d'urgence
      { name: 'Loyer', estimated: 600, spent: 750, description: 'Loyer + pénalités de retard' },
      { name: 'Charges Logement', estimated: 120, spent: 200, description: 'Factures impayées + régularisations' },
      { name: 'Électricité/Gaz', estimated: 100, spent: 280, description: 'Rattrapage factures + frais coupure évitée' },

      // Transport - Urgences multiples
      { name: 'Réparations Auto', estimated: 150, spent: 650, description: 'Panne majeure + courroie + freins' },
      { name: 'Essence', estimated: 180, spent: 220, description: 'Trajets urgents hôpital/administrations' },
      { name: 'Assurance Auto', estimated: 75, spent: 95, description: 'Malus + frais de dossier' },

      // Santé - Urgences médicales multiples
      { name: 'Urgences Médicales', estimated: 50, spent: 420, description: 'Hospitalisation + soins non remboursés' },
      { name: 'Pharmacie', estimated: 40, spent: 180, description: 'Traitements longs + lunettes' },
      { name: 'Dentiste Urgence', estimated: 0, spent: 300, description: 'Soins dentaires d\'urgence' },

      // Alimentation - Difficultés d'approvisionnement
      { name: 'Courses', estimated: 250, spent: 380, description: 'Prix élevés + achats d\'urgence' },
      { name: 'Restaurants/Livraisons', estimated: 50, spent: 180, description: 'Pas de cuisine (panne électroménager)' },

      // Crédits et dettes - Spirale négative
      { name: 'Crédit Consommation', estimated: 200, spent: 280, description: 'Mensualités + pénalités retard' },
      { name: 'Découvert Bancaire', estimated: 0, spent: 150, description: 'Frais et agios découvert' },
      { name: 'Huissier/Contentieux', estimated: 0, spent: 120, description: 'Frais de recouvrement' },

      // Famille et urgences sociales
      { name: 'Aide Famille Urgence', estimated: 0, spent: 250, description: 'Aide parents en difficulté' },
      { name: 'Garde Enfants', estimated: 150, spent: 200, description: 'Frais garde supplémentaires' },
      { name: 'Fournitures Scolaires', estimated: 80, spent: 120, description: 'Rentrée scolaire + sorties obligatoires' },

      // Services essentiels
      { name: 'Téléphone', estimated: 50, spent: 85, description: 'Forfait + communications urgentes' },
      { name: 'Internet', estimated: 35, spent: 60, description: 'Rétablissement après suspension' },

      // Urgences logement et équipement
      { name: 'Électroménager Urgence', estimated: 0, spent: 350, description: 'Remplacement lave-linge en panne' },
      { name: 'Vêtements Urgents', estimated: 50, spent: 120, description: 'Vêtements travail + enfants' },

      // Frais administratifs et légaux
      { name: 'Frais Administratifs', estimated: 20, spent: 80, description: 'Papiers d\'identité + démarches' },
      { name: 'Amendes/Contraventions', estimated: 0, spent: 135, description: 'PV + majorations' },

      // Transport d'urgence
      { name: 'Transport Urgence', estimated: 30, spent: 90, description: 'Taxis urgences médicales' },

      // Aucun budget épargne possible
      { name: 'Épargne', estimated: 100, spent: 0, description: 'Impossible dans cette situation' },
      { name: 'Loisirs', estimated: 80, spent: 15, description: 'Activités gratuites uniquement' }
    ]

    console.log(`📊 [Extreme Deficit] Création de ${budgetData.length} budgets en déficit extrême`)

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

    // 6. Créer les dépenses réelles (urgences multiples)
    const expenseInserts = []
    const summary = []

    for (const budget of createdBudgets!) {
      const budgetConfig = budgetData.find(b => b.name === budget.name)!

      if (budgetConfig.spent > 0) {
        // Créer 1-4 dépenses par budget (situation chaotique)
        const numExpenses = budgetConfig.spent > 300 ? Math.min(4, Math.floor(budgetConfig.spent / 80)) : Math.min(2, Math.floor(budgetConfig.spent / 50) + 1)
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
              description: `${budgetConfig.description} - Urgence ${i + 1}`,
              expense_date: '2025-09-22',
              is_exceptional: budgetConfig.spent > budgetConfig.estimated * 1.2 || budgetConfig.estimated === 0
            })
            totalSpent += expenseAmount
          }
        }
      }

      const difference = budget.estimated_amount - budgetConfig.spent
      const overrunRate = budgetConfig.estimated > 0 ? Math.round(((budgetConfig.spent - budgetConfig.estimated) / budgetConfig.estimated) * 100) : 100

      summary.push({
        name: budget.name,
        estimated: budget.estimated_amount,
        spent: budgetConfig.spent,
        difference,
        overrunRate: Math.max(0, overrunRate),
        surplus: Math.max(0, difference),
        deficit: Math.max(0, -difference),
        status: difference < 0 ? 'deficit' : difference > 0 ? 'surplus' : 'balanced',
        severity: budgetConfig.spent > budgetConfig.estimated * 2 ? 'critical' : budgetConfig.spent > budgetConfig.estimated * 1.5 ? 'severe' : budgetConfig.spent > budgetConfig.estimated ? 'moderate' : 'normal'
      })

      const severityEmoji = {
        'critical': '🚨',
        'severe': '🔴',
        'moderate': '🟠',
        'normal': difference > 0 ? '🟢' : '⚪'
      }[summary[summary.length - 1].severity]

      console.log(`${severityEmoji} [Extreme Deficit] ${budget.name}: ${budgetConfig.spent}€ / ${budget.estimated_amount}€ → ${difference}€ (${overrunRate > 0 ? '+' : ''}${overrunRate}% dépassement)`)
    }

    await supabaseServer.from('real_expenses').insert(expenseInserts)

    // 7. Calculer les statistiques catastrophiques
    const totalEstimated = summary.reduce((sum, item) => sum + item.estimated, 0)
    const totalSpent = summary.reduce((sum, item) => sum + item.spent, 0)
    const totalDeficit = summary.reduce((sum, item) => sum + item.deficit, 0)
    const totalSurplus = summary.reduce((sum, item) => sum + item.surplus, 0)
    const netDeficit = totalDeficit - totalSurplus
    const overrunTotal = ((totalSpent - totalEstimated) / totalEstimated) * 100

    const totalRealIncome = incomeData.reduce((sum, income) => sum + income.real, 0)
    const estimatedRAV = -450 + totalRealIncome - totalSpent // Découvert + revenus - dépenses
    const monthlyDeficit = totalSpent - totalRealIncome

    const criticalBudgets = summary.filter(b => b.severity === 'critical')
    const severeBudgets = summary.filter(b => b.severity === 'severe')
    const budgetsInDeficit = summary.filter(b => b.status === 'deficit')

    const crisisScore = Math.min(100, (netDeficit / totalEstimated) * 100)

    console.log('📊 [Extreme Deficit] === CRISE FINANCIÈRE MAJEURE ===')
    console.log(`💰 Solde bancaire: -450€ (DÉCOUVERT)`)
    console.log(`💚 Revenus réels: ${totalRealIncome}€`)
    console.log(`💸 Dépenses totales: ${totalSpent}€`)
    console.log(`🚨 Déficit mensuel: ${monthlyDeficit}€`)
    console.log(`⚠️ RAV estimé: ${estimatedRAV}€ (CRITIQUE!)`)
    console.log(`📈 Dépassement global: ${Math.round(overrunTotal)}%`)
    console.log(`🚨 Budgets critiques: ${criticalBudgets.length}`)
    console.log(`🔴 Budgets sévères: ${severeBudgets.length}`)
    console.log(`📊 Score de crise: ${Math.round(crisisScore)}/100`)

    return NextResponse.json({
      success: true,
      scenario: 'EXTREME_DEFICIT',
      message: '🚨 Scénario déficit extrême créé - CRISE FINANCIÈRE MAJEURE',
      financial_impact: {
        bankBalance: -450,
        totalRealIncome: totalRealIncome,
        totalSpent: totalSpent,
        monthlyDeficit: monthlyDeficit,
        netDeficit: netDeficit,
        estimatedRAV: estimatedRAV,
        overrunTotal: Math.round(overrunTotal),
        crisisScore: Math.round(crisisScore),
        status: 'CRITICAL_EMERGENCY'
      },
      crisis_analysis: {
        criticalBudgets: criticalBudgets.length,
        severeBudgets: severeBudgets.length,
        totalBudgetsInDeficit: budgetsInDeficit.length,
        averageOverrun: Math.round(summary.reduce((sum, b) => sum + b.overrunRate, 0) / summary.length),
        emergencyActionsNeeded: estimatedRAV < -1000,
        debtSpiral: monthlyDeficit > totalRealIncome * 0.5
      },
      statistics: {
        totalBudgets: createdBudgets.length,
        totalExpenses: expenseInserts.length,
        exceptionalExpenses: expenseInserts.filter(e => e.is_exceptional).length,
        budgetsInSurplus: summary.filter(b => b.status === 'surplus').length,
        budgetsInDeficit: budgetsInDeficit.length
      },
      emergency_alerts: [
        '🚨 SITUATION D\'URGENCE FINANCIÈRE',
        '⚠️ RAV extrêmement négatif - Action immédiate requise',
        '💰 Découvert bancaire - Risque de surendettement',
        '📞 Contact urgents: assistante sociale, médiateur bancaire',
        '🏥 Prioriser: logement, santé, alimentation de base'
      ],
      immediate_actions: [
        'Contacter immédiatement un conseiller en économie sociale',
        'Faire le point sur les aides sociales disponibles',
        'Négocier un échéancier avec la banque',
        'Identifier les dépenses à suspendre absolument',
        'Chercher des solutions d\'aide alimentaire/vestimentaire'
      ],
      summary: summary.sort((a, b) => b.deficit - a.deficit)
    })

  } catch (error) {
    console.error('❌ [Extreme Deficit] Erreur:', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
}