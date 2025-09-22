import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/populate-negative-uncompensated
 *
 * Scénario: Reste à vivre négatif qui ne peut PAS être compensé
 * Simule un utilisateur avec un gros déficit de reste à vivre et des budgets
 * qui n'ont pas assez d'économies ni d'excédents pour compenser
 * Teste le cas critique où l'utilisateur est vraiment en difficulté financière
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
    console.log(`🏗️ [Negative Uncompensated] Création scénario déficit non compensable pour userId: ${userId}`)

    // 1. Supprimer les données existantes
    console.log('🗑️ [Negative Uncompensated] Nettoyage des données existantes...')

    await supabaseServer.from('budget_transfers').delete().eq('profile_id', userId)
    await supabaseServer.from('real_expenses').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_budgets').delete().eq('profile_id', userId)

    // 2. Désactiver les snapshots
    await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('profile_id', userId)
      .eq('is_active', true)

    // 3. Créer un profil de crise financière
    // Objectif: Déficit important (~1500€) avec très peu de compensation possible (~400€)
    const budgetData = [
      // === BUDGETS AVEC GROS DÉFICITS (urgences, imprévus) ===
      { name: 'Santé Urgence', estimated: 150, spent: 800, description: 'Hospitalisation + soins dentaires urgents' }, // -650€
      { name: 'Réparation Voiture', estimated: 200, spent: 1200, description: 'Accident + grosse réparation moteur' }, // -1000€
      { name: 'Frais Juridiques', estimated: 50, spent: 350, description: 'Avocat pour litige imprévu' }, // -300€
      { name: 'Logement Urgent', estimated: 100, spent: 400, description: 'Réparation chauffage en urgence' }, // -300€

      // === BUDGETS AVEC DÉFICITS MOYENS (dépassements) ===
      { name: 'Courses', estimated: 400, spent: 520, description: 'Inflation + invités famille' }, // -120€
      { name: 'Essence', estimated: 180, spent: 250, description: 'Trajets supplémentaires pour travail' }, // -70€
      { name: 'Vêtements', estimated: 100, spent: 180, description: 'Vêtements travail obligatoires' }, // -80€
      { name: 'Restaurants', estimated: 120, spent: 200, description: 'Repas professionnels imposés' }, // -80€

      // === BUDGETS INCOMPRESSIBLES (charges fixes) ===
      { name: 'Loyer', estimated: 1200, spent: 1200, description: 'Charges fixes' }, // 0€
      { name: 'Assurances', estimated: 160, spent: 160, description: 'Assurance auto + habitation' }, // 0€
      { name: 'Électricité', estimated: 95, spent: 95, description: 'Facture EDF' }, // 0€
      { name: 'Internet', estimated: 45, spent: 45, description: 'Box internet' }, // 0€
      { name: 'Téléphone', estimated: 55, spent: 55, description: 'Forfait mobile' }, // 0€

      // === QUELQUES PETITES ÉCONOMIES (insuffisantes) ===
      { name: 'Loisirs', estimated: 200, spent: 120, description: 'Annulation sorties par manque de budget', monthlyExcess: 50 }, // +80€ + 50€ excédent
      { name: 'Formation', estimated: 150, spent: 100, description: 'Formation gratuite trouvée' }, // +50€
      { name: 'Transport Public', estimated: 80, spent: 60, description: 'Marche plus souvent' }, // +20€
      { name: 'Abonnements', estimated: 60, spent: 40, description: 'Résiliation Netflix', monthlyExcess: 30 }, // +20€ + 30€ excédent

      // === BUDGET AVEC EXCÉDENT MINIMAL ===
      { name: 'Équipement Tech', estimated: 100, spent: 120, description: 'Réparation ordinateur obligatoire', monthlyExcess: 80 } // -20€ + 80€ excédent
    ]

    // Calcul théorique des déficits:
    // Gros déficits: -650 - 1000 - 300 - 300 = -2250€
    // Déficits moyens: -120 - 70 - 80 - 80 = -350€
    // Total déficits: -2600€
    //
    // Économies actuelles: +80 + 50 + 20 + 20 - 20 = +150€
    // Excédents disponibles: 50 + 30 + 80 = +160€
    // Total compensation: +310€
    //
    // Balance: -2600 + 310 = -2290€ (gros déficit non compensable)

    console.log(`📊 [Negative Uncompensated] Création de ${budgetData.length} budgets en crise`)

    // 4. Créer les budgets estimés
    const budgetInserts = budgetData.map(budget => ({
      profile_id: userId,
      name: budget.name,
      estimated_amount: budget.estimated,
      is_monthly_recurring: true,
      monthly_surplus: budget.monthlyExcess || 0,
      monthly_deficit: 0,
      cumulated_savings: budget.monthlyExcess || 0
    }))

    const { data: createdBudgets, error: budgetError } = await supabaseServer
      .from('estimated_budgets')
      .insert(budgetInserts)
      .select('id, name, estimated_amount, monthly_surplus')

    if (budgetError) {
      console.error('❌ [Negative Uncompensated] Erreur création budgets:', budgetError)
      return NextResponse.json({ error: 'Erreur création budgets' }, { status: 500 })
    }

    console.log(`✅ [Negative Uncompensated] ${createdBudgets.length} budgets créés`)

    // 5. Créer les dépenses réelles avec beaucoup d'urgences
    const expenseInserts = []
    const summary = []

    for (const budget of createdBudgets) {
      const budgetConfig = budgetData.find(b => b.name === budget.name)
      if (!budgetConfig) continue

      // Créer des dépenses avec marqueurs d'urgence
      const numExpenses = budgetConfig.spent > 500 ? 4 : budgetConfig.spent > 200 ? 3 : budgetConfig.spent > 100 ? 2 : 1
      let totalSpent = 0

      for (let i = 0; i < numExpenses; i++) {
        let expenseAmount

        if (i === numExpenses - 1) {
          // Dernière dépense : ajuster pour atteindre le total exact
          expenseAmount = budgetConfig.spent - totalSpent
        } else {
          // Répartir les grosses dépenses en premier
          if (budgetConfig.spent > 500) {
            expenseAmount = i === 0 ? Math.floor(budgetConfig.spent * 0.6) : Math.floor((budgetConfig.spent - totalSpent) / (numExpenses - i))
          } else {
            expenseAmount = Math.floor(budgetConfig.spent / numExpenses)
          }
        }

        if (expenseAmount > 0) {
          const isUrgent = budgetConfig.spent > budgetConfig.estimated * 2
          expenseInserts.push({
            profile_id: userId,
            estimated_budget_id: budget.id,
            amount: expenseAmount,
            description: `${budgetConfig.description} - ${isUrgent ? 'URGENCE' : 'Dépense'} ${i + 1}`,
            expense_date: '2025-09-22',
            is_exceptional: isUrgent
          })

          totalSpent += expenseAmount
        }
      }

      // Calculs pour le résumé
      const estimated = budget.estimated_amount
      const spent = budgetConfig.spent
      const currentDifference = estimated - spent
      const availableExcess = budgetConfig.monthlyExcess || 0

      summary.push({
        name: budget.name,
        estimated,
        spent,
        currentDifference,
        availableExcess,
        totalAvailable: currentDifference + availableExcess,
        currentSurplus: Math.max(0, currentDifference),
        currentDeficit: Math.max(0, -currentDifference),
        status: currentDifference > 0 ? 'surplus' : currentDifference < 0 ? 'deficit' : 'balanced',
        hasExcess: availableExcess > 0,
        isEmergency: spent > estimated * 2,
        overrunPercent: spent > estimated ? Math.round(((spent - estimated) / estimated) * 100) : 0
      })

      const symbol = currentDifference > 0 ? '+' : ''
      const urgencyFlag = spent > estimated * 2 ? ' 🚨 URGENCE' : ''
      const excessInfo = availableExcess > 0 ? ` (+ ${availableExcess}€ excédent)` : ''
      console.log(`📝 [Negative Uncompensated] ${budget.name}: ${spent}€ / ${estimated}€ → ${symbol}${currentDifference}€${excessInfo}${urgencyFlag}`)
    }

    // 6. Insérer toutes les dépenses
    const { error: expenseError } = await supabaseServer
      .from('real_expenses')
      .insert(expenseInserts)

    if (expenseError) {
      console.error('❌ [Negative Uncompensated] Erreur création dépenses:', expenseError)
      return NextResponse.json({ error: 'Erreur création dépenses' }, { status: 500 })
    }

    console.log(`✅ [Negative Uncompensated] ${expenseInserts.length} dépenses créées`)

    // 7. Calculer les statistiques critiques
    const currentSurplus = summary.reduce((sum, item) => sum + item.currentSurplus, 0)
    const currentDeficit = summary.reduce((sum, item) => sum + item.currentDeficit, 0)
    const totalExcess = summary.reduce((sum, item) => sum + item.availableExcess, 0)
    const netCurrent = currentSurplus - currentDeficit
    const totalCompensation = Math.max(0, netCurrent) + totalExcess // Seules les compensations positives comptent

    // Simulation d'un reste à vivre très négatif
    const simulatedNegativeRemainder = -1200 // 1200€ de déficit sur le reste à vivre

    const totalNeeded = Math.abs(simulatedNegativeRemainder) + Math.abs(Math.min(0, netCurrent))
    const shortfall = totalNeeded - totalCompensation

    const budgetsByStatus = {
      surplus: summary.filter(b => b.status === 'surplus'),
      deficit: summary.filter(b => b.status === 'deficit'),
      balanced: summary.filter(b => b.status === 'balanced'),
      withExcess: summary.filter(b => b.hasExcess),
      emergencies: summary.filter(b => b.isEmergency)
    }

    console.log('📊 [Negative Uncompensated] Statistiques CRITIQUES:')
    console.log(`💚 Économies actuelles: ${currentSurplus}€`)
    console.log(`❤️ Déficits actuels: ${currentDeficit}€`)
    console.log(`💰 Balance actuelle: ${netCurrent}€`)
    console.log(`🏦 Excédents disponibles: ${totalExcess}€`)
    console.log(`📈 Compensation totale: ${totalCompensation}€`)
    console.log(`🔴 Reste à vivre simulé: ${simulatedNegativeRemainder}€`)
    console.log(`⛔ MANQUE TOTAL: ${shortfall}€`)
    console.log(`🚨 Budgets d'urgence: ${budgetsByStatus.emergencies.length}`)

    return NextResponse.json({
      success: true,
      message: 'Scénario "Déficit non compensable" créé avec succès',
      scenario: 'negative-remainder-uncompensated',
      description: 'Situation critique: le reste à vivre négatif ne peut pas être compensé par les budgets disponibles',
      warning: '🚨 Ce scénario simule une situation financière critique nécessitant des mesures d\'urgence',
      statistics: {
        totalBudgets: createdBudgets.length,
        totalExpenses: expenseInserts.length,
        budgetsByStatus,
        crisis: {
          currentSavings: currentSurplus,
          currentDeficits: currentDeficit,
          netCurrent: netCurrent,
          availableExcess: totalExcess,
          totalCompensation: totalCompensation,
          simulatedNegativeRemainder: simulatedNegativeRemainder,
          totalNeeded: totalNeeded,
          shortfall: shortfall,
          cannotCompensate: shortfall > 0,
          emergencyBudgets: budgetsByStatus.emergencies.length
        }
      },
      summary: summary.sort((a, b) => {
        // Trier par déficit décroissant pour montrer les problèmes en premier
        return b.currentDeficit - a.currentDeficit
      }),
      testScenario: {
        remainderToLive: simulatedNegativeRemainder,
        compensationType: 'insufficient',
        availableCompensation: totalCompensation,
        totalNeeded: totalNeeded,
        shortfall: shortfall,
        isFullyCompensated: false,
        emergencyLevel: 'critical',
        budgetsInCrisis: budgetsByStatus.emergencies.map(b => ({
          name: b.name,
          deficit: b.currentDeficit,
          overrun: `${b.overrunPercent}%`
        }))
      },
      recommendations: [
        'Réviser immédiatement les budgets prioritaires',
        'Chercher des sources de revenus supplémentaires',
        'Reporter ou annuler les dépenses non essentielles',
        'Consulter un conseiller financier',
        'Étudier la possibilité d\'un crédit d\'urgence'
      ],
      actions: {
        budgetsCreated: createdBudgets.length,
        expensesCreated: expenseInserts.length,
        previousDataDeleted: true,
        snapshotsDeactivated: true
      }
    })

  } catch (error) {
    console.error('❌ [Negative Uncompensated] Erreur générale:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}