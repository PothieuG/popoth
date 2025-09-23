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

    // NOUVEAU: Supprimer les monthly recaps pour forcer le recalcul
    await supabaseServer.from('monthly_recaps').delete().eq('profile_id', userId)
    console.log('🧹 [Massive Savings] Monthly recaps supprimés pour forcer le recalcul')

    // 2. Désactiver les snapshots
    await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('profile_id', userId)
      .eq('is_active', true)

    // 3. Définir les budgets avec énormes économies
    const budgetData = [
      // Budgets avec énormes économies (70-90% d'économies)
      { name: 'Vacances Été', estimated: 1500, spent: 200, description: 'Vacances annulées - grosse économie' },
      { name: 'Équipement Maison', estimated: 2000, spent: 300, description: 'Achats reportés à l\'année prochaine' },
      { name: 'Voiture Neuve', estimated: 3000, spent: 150, description: 'Finalement gardé l\'ancienne voiture' },
      { name: 'Travaux Cuisine', estimated: 2500, spent: 400, description: 'Travaux fait soi-même au lieu d\'artisan' },
      { name: 'Formation Pro', estimated: 1200, spent: 180, description: 'Formation gratuite trouvée en ligne' },
      { name: 'Électroménager', estimated: 800, spent: 120, description: 'Réparé au lieu de remplacer' },
      { name: 'Mobilier Salon', estimated: 1800, spent: 250, description: 'Trouvé d\'occasion à prix réduit' },
      { name: 'Ordinateur Gaming', estimated: 1500, spent: 200, description: 'Finalement pas acheté cette année' },
      { name: 'Équipement Sport', estimated: 600, spent: 80, description: 'Acheté d\'occasion' },
      { name: 'Vêtements Hiver', estimated: 500, spent: 75, description: 'Soldes exceptionnelles' },

      // Quelques budgets avec économies modérées (30-50% d'économies)
      { name: 'Loisirs Famille', estimated: 400, spent: 250, description: 'Activités gratuites privilégiées' },
      { name: 'Restaurants', estimated: 300, spent: 180, description: 'Plus de repas maison' },
      { name: 'Essence', estimated: 250, spent: 150, description: 'Télétravail plus fréquent' },

      // Budgets incompressibles (fixes)
      { name: 'Loyer', estimated: 1200, spent: 1200, description: 'Charges fixes' },
      { name: 'Assurances', estimated: 180, spent: 180, description: 'Assurance obligatoire' },
      { name: 'Téléphone', estimated: 60, spent: 60, description: 'Forfait fixe' },
      { name: 'Internet', estimated: 45, spent: 45, description: 'Abonnement internet' },

      // Un petit déficit pour contraster
      { name: 'Santé Urgence', estimated: 150, spent: 280, description: 'Soins dentaires imprévus' }
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

    // 7. Calculer les statistiques globales
    const totalEstimated = summary.reduce((sum, item) => sum + item.estimated, 0)
    const totalSpent = summary.reduce((sum, item) => sum + item.spent, 0)
    const totalSavings = totalEstimated - totalSpent
    const globalSavingsPercent = ((totalSavings / totalEstimated) * 100).toFixed(1)

    const budgetsByStatus = {
      surplus: summary.filter(b => b.status === 'surplus'),
      deficit: summary.filter(b => b.status === 'deficit'),
      balanced: summary.filter(b => b.status === 'balanced')
    }

    console.log('📊 [Massive Savings] Statistiques générées:')
    console.log(`💰 Total estimé: ${totalEstimated}€`)
    console.log(`💸 Total dépensé: ${totalSpent}€`)
    console.log(`💚 Total économies: ${totalSavings}€ (${globalSavingsPercent}%)`)
    console.log(`📈 Budgets en surplus: ${budgetsByStatus.surplus.length}`)
    console.log(`📉 Budgets en déficit: ${budgetsByStatus.deficit.length}`)

    return NextResponse.json({
      success: true,
      message: 'Scénario "Énormes économies" créé avec succès',
      scenario: 'massive-savings',
      statistics: {
        totalBudgets: createdBudgets.length,
        totalExpenses: expenseInserts.length,
        budgetsByStatus,
        totals: {
          estimated: totalEstimated,
          spent: totalSpent,
          savings: totalSavings,
          savingsPercent: `${globalSavingsPercent}%`
        }
      },
      summary: summary.sort((a, b) => b.difference - a.difference),
      actions: {
        budgetsCreated: createdBudgets.length,
        expensesCreated: expenseInserts.length,
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