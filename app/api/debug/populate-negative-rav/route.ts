import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/populate-negative-rav
 *
 * Scénario: RAV NÉGATIF - Situation financière critique
 * - Revenus modestes (2200€)
 * - Budgets estimés trop optimistes
 * - Dépenses réelles excessives
 * - RAV théoriquement négatif à terme
 */
export async function POST(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }

    const userId = sessionData.userId
    console.log(`🔴 [Negative RAV] Création scénario RAV négatif pour userId: ${userId}`)

    // 1. Nettoyage complet
    console.log('🗑️ [Negative RAV] Nettoyage des données existantes...')
    await supabaseServer.from('budget_transfers').delete().eq('profile_id', userId)
    await supabaseServer.from('real_expenses').delete().eq('profile_id', userId)
    await supabaseServer.from('real_income_entries').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_budgets').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_incomes').delete().eq('profile_id', userId)
    await supabaseServer.from('monthly_recaps').delete().eq('profile_id', userId)
    await supabaseServer.from('recap_snapshots').update({ is_active: false }).eq('profile_id', userId)

    // 2. Mettre à jour le solde bancaire - Situation précaire
    await supabaseServer
      .from('user_profiles')
      .update({ bank_balance: 850 }) // Très faible solde
      .eq('id', userId)

    // 3. Créer des revenus modestes
    const incomeData = [
      { name: 'Salaire Principal', estimated: 1800, real: 1750 }, // Salaire en baisse
      { name: 'Allocation Logement', estimated: 300, real: 280 }, // Aide réduite
      { name: 'Freelance Occasionnel', estimated: 200, real: 120 } // Travail irrégulier
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

    // 4. Budgets avec dépenses EXCESSIVES - RAV négatif garanti
    const budgetData = [
      // Logement - Dépenses ÉNORMES (loyer cher + charges)
      { name: 'Loyer', estimated: 900, spent: 1200, description: 'Loyer trop cher + charges imprévues' },
      { name: 'Électricité/Gaz', estimated: 150, spent: 280, description: 'Factures énergétiques explosées' },

      // Transport - Dépenses critiques
      { name: 'Essence', estimated: 200, spent: 350, description: 'Prix du carburant + longs trajets' },
      { name: 'Réparations Auto', estimated: 100, spent: 450, description: 'Panne moteur majeure' },
      { name: 'Assurance Auto', estimated: 80, spent: 120, description: 'Malus après accident' },

      // Alimentation - Dépenses excessives
      { name: 'Courses', estimated: 300, spent: 480, description: 'Courses chères + gaspillage' },
      { name: 'Restaurants', estimated: 150, spent: 320, description: 'Trop de sorties restaurant' },

      // Santé - Urgences médicales
      { name: 'Santé Urgence', estimated: 80, spent: 380, description: 'Hospitalisation non remboursée' },
      { name: 'Pharmacie', estimated: 50, spent: 150, description: 'Médicaments coûteux' },

      // Crédits et dettes
      { name: 'Crédit Consommation', estimated: 250, spent: 250, description: 'Remboursement crédit fixe' },
      { name: 'Découvert Bancaire', estimated: 0, spent: 120, description: 'Frais de découvert accumulés' },

      // Vie quotidienne - Dépenses compulsives
      { name: 'Vêtements', estimated: 100, spent: 280, description: 'Achats compulsifs mode' },
      { name: 'Loisirs', estimated: 120, spent: 250, description: 'Sorties et divertissements' },
      { name: 'Téléphone', estimated: 50, spent: 90, description: 'Forfait premium + hors forfait' },

      // Imprévus catastrophiques
      { name: 'Urgences Famille', estimated: 0, spent: 300, description: 'Aide financière famille' },
      { name: 'Amendes/Contraventions', estimated: 0, spent: 180, description: 'PV parking + excès vitesse' },

      // Quelques budgets avec légers surplus (rares)
      { name: 'Internet', estimated: 45, spent: 45, description: 'Seul poste maîtrisé' },
      { name: 'Épargne', estimated: 100, spent: 0, description: 'Impossible d\'épargner' }
    ]

    console.log(`📊 [Negative RAV] Création de ${budgetData.length} budgets avec dépenses excessives`)

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
        // Créer 1-3 dépenses par budget
        const numExpenses = Math.min(3, Math.floor(budgetConfig.spent / 50) + 1)
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
              description: `${budgetConfig.description} - Transaction ${i + 1}`,
              expense_date: '2025-09-22',
              is_exceptional: budgetConfig.spent > budgetConfig.estimated * 1.5
            })
            totalSpent += expenseAmount
          }
        }
      }

      const difference = budget.estimated_amount - budgetConfig.spent
      summary.push({
        name: budget.name,
        estimated: budget.estimated_amount,
        spent: budgetConfig.spent,
        difference,
        deficit: Math.max(0, -difference),
        surplus: Math.max(0, difference),
        status: difference < 0 ? 'deficit' : difference > 0 ? 'surplus' : 'balanced'
      })

      const statusEmoji = difference < 0 ? '🔴' : difference > 0 ? '🟢' : '⚪'
      console.log(`${statusEmoji} [Negative RAV] ${budget.name}: ${budgetConfig.spent}€ / ${budget.estimated_amount}€ → ${difference > 0 ? '+' : ''}${difference}€`)
    }

    await supabaseServer.from('real_expenses').insert(expenseInserts)

    // 7. Calculer les statistiques catastrophiques
    const totalEstimated = summary.reduce((sum, item) => sum + item.estimated, 0)
    const totalSpent = summary.reduce((sum, item) => sum + item.spent, 0)
    const totalDeficit = summary.reduce((sum, item) => sum + item.deficit, 0)
    const totalSurplus = summary.reduce((sum, item) => sum + item.surplus, 0)
    const netDeficit = totalDeficit - totalSurplus

    const totalRealIncome = incomeData.reduce((sum, income) => sum + income.real, 0)
    const estimatedRAV = 850 + totalRealIncome - totalSpent // Solde + revenus - dépenses

    console.log('📊 [Negative RAV] === SITUATION FINANCIÈRE CRITIQUE ===')
    console.log(`💰 Solde bancaire: 850€`)
    console.log(`💚 Revenus réels: ${totalRealIncome}€`)
    console.log(`💸 Dépenses totales: ${totalSpent}€`)
    console.log(`🔴 Déficit net: ${netDeficit}€`)
    console.log(`⚠️ RAV estimé: ${estimatedRAV}€ (NÉGATIF!)`)
    console.log(`📈 Budgets en déficit: ${summary.filter(b => b.status === 'deficit').length}`)
    console.log(`📉 Budgets en surplus: ${summary.filter(b => b.status === 'surplus').length}`)

    return NextResponse.json({
      success: true,
      scenario: 'NEGATIVE_RAV',
      message: '🔴 Scénario RAV négatif créé - Situation financière critique',
      financial_impact: {
        bankBalance: 850,
        totalRealIncome: totalRealIncome,
        totalSpent: totalSpent,
        estimatedRAV: estimatedRAV,
        netDeficit: netDeficit,
        crisis_level: estimatedRAV < 0 ? 'CRITICAL' : 'WARNING'
      },
      statistics: {
        totalBudgets: createdBudgets.length,
        totalExpenses: expenseInserts.length,
        budgetsInDeficit: summary.filter(b => b.status === 'deficit').length,
        budgetsInSurplus: summary.filter(b => b.status === 'surplus').length,
        averageDeficitAmount: Math.round(totalDeficit / Math.max(1, summary.filter(b => b.status === 'deficit').length))
      },
      warning: '⚠️ RAV NÉGATIF - Situation financière non viable à terme',
      summary: summary.sort((a, b) => a.difference - b.difference)
    })

  } catch (error) {
    console.error('❌ [Negative RAV] Erreur:', error)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
}