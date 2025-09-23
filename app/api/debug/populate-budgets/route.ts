import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/populate-budgets
 *
 * Endpoint pour créer des budgets estimés variés avec des dépenses réalistes
 * Simule un profil financier complet avec différents types de dépenses
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
    console.log(`🏗️ [Populate Budgets] Création de budgets variés pour userId: ${userId}`)

    // 1. Supprimer les budgets et dépenses existants
    console.log('🗑️ [Populate Budgets] Nettoyage des données existantes...')

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

    // 3. Définir les budgets avec des montants variés
    const budgetData = [
      // Budgets avec surplus modéré (bien gérés)
      { name: 'Courses', estimated: 400, spent: 320, description: 'Alimentation et produits ménagers' },
      { name: 'Essence', estimated: 200, spent: 150, description: 'Carburant et entretien véhicule' },
      { name: 'Loisirs', estimated: 250, spent: 180, description: 'Sorties et divertissements' },

      // Budgets avec GROSSES économies (très bien gérés ou événements annulés)
      { name: 'Épargne Vacances', estimated: 500, spent: 80, description: 'Économies pour vacances d\'été' },
      { name: 'Équipement Tech', estimated: 350, spent: 45, description: 'Ordinateurs et gadgets' },
      { name: 'Formation', estimated: 300, spent: 60, description: 'Cours et certifications en ligne' },
      { name: 'Travaux Maison', estimated: 600, spent: 120, description: 'Rénovations et bricolage' },
      { name: 'Sport & Fitness', estimated: 180, spent: 35, description: 'Salle de sport et équipements' },
      { name: 'Sorties Culture', estimated: 220, spent: 50, description: 'Cinéma, théâtre, musées' },

      // Budgets équilibrés (parfaitement gérés)
      { name: 'Téléphone', estimated: 50, spent: 50, description: 'Forfait mobile' },
      { name: 'Assurances', estimated: 120, spent: 120, description: 'Assurance auto et habitation' },
      { name: 'Internet', estimated: 45, spent: 45, description: 'Box internet et streaming' },

      // Budgets avec surplus léger (économies modestes)
      { name: 'Transport Public', estimated: 75, spent: 60, description: 'Métro et bus' },
      { name: 'Produits Beauté', estimated: 80, spent: 55, description: 'Cosmétiques et soins' },
      { name: 'Livres & Magazines', estimated: 40, spent: 25, description: 'Lecture et abonnements' },

      // Budgets avec déficit léger (dépassements mineurs)
      { name: 'Vêtements', estimated: 150, spent: 190, description: 'Garde-robe et accessoires' },
      { name: 'Santé', estimated: 100, spent: 135, description: 'Pharmacie et soins médicaux' },
      { name: 'Restaurants', estimated: 180, spent: 230, description: 'Sorties restaurant et livraisons' },

      // Budgets avec déficit important (urgences ou imprévus)
      { name: 'Logement', estimated: 800, spent: 950, description: 'Loyer et charges locatives' },
      { name: 'Voiture Réparation', estimated: 200, spent: 380, description: 'Entretien et réparations auto' },
      { name: 'Cadeaux', estimated: 120, spent: 280, description: 'Anniversaires et fêtes de famille' },

      // Budgets saisonniers avec économies
      { name: 'Chauffage', estimated: 150, spent: 45, description: 'Énergie et chauffage (été)' },
      { name: 'Jardinage', estimated: 90, spent: 25, description: 'Plantes et outils de jardin' }
    ]

    console.log(`📊 [Populate Budgets] Création de ${budgetData.length} budgets variés`)

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
      console.error('❌ [Populate Budgets] Erreur création budgets:', budgetError)
      return NextResponse.json({ error: 'Erreur création budgets' }, { status: 500 })
    }

    console.log(`✅ [Populate Budgets] ${createdBudgets.length} budgets créés`)

    // 5. Créer les dépenses réelles avec variation
    const expenseInserts = []
    const summary = []

    for (const budget of createdBudgets) {
      const budgetConfig = budgetData.find(b => b.name === budget.name)
      if (!budgetConfig) continue

      // Créer plusieurs dépenses pour simuler des achats réels
      const numExpenses = Math.floor(Math.random() * 4) + 1 // 1 à 4 dépenses par budget
      let totalSpent = 0

      for (let i = 0; i < numExpenses; i++) {
        let expenseAmount

        if (i === numExpenses - 1) {
          // Dernière dépense : ajuster pour atteindre le total exact
          expenseAmount = budgetConfig.spent - totalSpent
        } else {
          // Dépenses intermédiaires : répartition aléatoire
          const remaining = budgetConfig.spent - totalSpent
          const maxForThisExpense = remaining - (numExpenses - i - 1) * 10 // Garder au moins 10€ pour les suivantes
          expenseAmount = Math.max(10, Math.min(maxForThisExpense, Math.floor(Math.random() * remaining * 0.6) + 10))
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

      console.log(`📝 [Populate Budgets] ${budget.name}: ${spent}€ / ${estimated}€ → ${difference > 0 ? '+' : ''}${difference}€`)
    }

    // 6. Insérer toutes les dépenses
    const { error: expenseError } = await supabaseServer
      .from('real_expenses')
      .insert(expenseInserts)

    if (expenseError) {
      console.error('❌ [Populate Budgets] Erreur création dépenses:', expenseError)
      return NextResponse.json({ error: 'Erreur création dépenses' }, { status: 500 })
    }

    console.log(`✅ [Populate Budgets] ${expenseInserts.length} dépenses créées`)

    // 7. Calculer les statistiques globales
    const totalSurplus = summary.reduce((sum, item) => sum + item.surplus, 0)
    const totalDeficit = summary.reduce((sum, item) => sum + item.deficit, 0)
    const generalRatio = totalSurplus - totalDeficit

    const budgetsByStatus = {
      surplus: summary.filter(b => b.status === 'surplus'),
      deficit: summary.filter(b => b.status === 'deficit'),
      balanced: summary.filter(b => b.status === 'balanced')
    }

    console.log('📊 [Populate Budgets] Statistiques générées:')
    console.log(`💚 Budgets en surplus: ${budgetsByStatus.surplus.length} (${totalSurplus}€)`)
    console.log(`❤️ Budgets en déficit: ${budgetsByStatus.deficit.length} (${totalDeficit}€)`)
    console.log(`⚖️ Budgets équilibrés: ${budgetsByStatus.balanced.length}`)
    console.log(`🎯 Ratio général: ${generalRatio}€`)

    return NextResponse.json({
      success: true,
      message: 'Budgets variés créés avec succès',
      statistics: {
        totalBudgets: createdBudgets.length,
        totalExpenses: expenseInserts.length,
        budgetsByStatus,
        totals: {
          surplus: totalSurplus,
          deficit: totalDeficit,
          ratio: generalRatio
        }
      },
      summary: summary.sort((a, b) => b.difference - a.difference), // Tri par différence décroissante
      actions: {
        budgetsCreated: createdBudgets.length,
        expensesCreated: expenseInserts.length,
        previousDataDeleted: true,
        snapshotsDeactivated: true
      }
    })

  } catch (error) {
    console.error('❌ [Populate Budgets] Erreur générale:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}