import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/populate-negative-surplus-only
 *
 * Scénario: Reste à vivre négatif compensé uniquement par les excédents des budgets
 * Simule un utilisateur qui n'a pas d'économies ce mois-ci mais qui a des excédents
 * accumulés des mois précédents qui peuvent compenser le déficit du reste à vivre
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
    console.log(`🏗️ [Negative Surplus Only] Création scénario excédents uniquement pour userId: ${userId}`)

    // 1. Supprimer les données existantes
    console.log('🗑️ [Negative Surplus Only] Nettoyage des données existantes...')

    await supabaseServer.from('budget_transfers').delete().eq('profile_id', userId)
    await supabaseServer.from('real_expenses').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_budgets').delete().eq('profile_id', userId)

    // 2. Désactiver les snapshots
    await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('profile_id', userId)
      .eq('is_active', true)

    // 3. Créer un profil où seuls les excédents peuvent compenser
    // Objectif: Pas d'économies actuelles, mais ~600€ d'excédents pour compenser -600€ de reste à vivre
    const budgetData = [
      // === BUDGETS ÉQUILIBRÉS OU LÉGERS DÉFICITS (pas d'économies actuelles) ===
      { name: 'Courses', estimated: 400, spent: 410, description: 'Légère hausse des prix', monthlyExcess: 200 }, // -10€ + 200€ excédent
      { name: 'Essence', estimated: 180, spent: 180, description: 'Budget respecté', monthlyExcess: 150 }, // 0€ + 150€ excédent
      { name: 'Loisirs', estimated: 250, spent: 270, description: 'Sorties de fin d\'année', monthlyExcess: 120 }, // -20€ + 120€ excédent
      { name: 'Vêtements', estimated: 120, spent: 120, description: 'Achats nécessaires', monthlyExcess: 80 }, // 0€ + 80€ excédent
      { name: 'Transport', estimated: 100, spent: 105, description: 'Trajets supplémentaires', monthlyExcess: 60 }, // -5€ + 60€ excédent

      // === BUDGETS FIXES (incompressibles) ===
      { name: 'Loyer', estimated: 1100, spent: 1100, description: 'Charges fixes' }, // 0€
      { name: 'Assurances', estimated: 140, spent: 140, description: 'Assurance auto + habitation' }, // 0€
      { name: 'Électricité', estimated: 85, spent: 85, description: 'Facture EDF' }, // 0€
      { name: 'Internet', estimated: 45, spent: 45, description: 'Box internet' }, // 0€
      { name: 'Téléphone', estimated: 50, spent: 50, description: 'Forfait mobile' }, // 0€

      // === BUDGETS AVEC DÉFICITS ACTUELS (créent le besoin) ===
      { name: 'Santé', estimated: 100, spent: 180, description: 'Consultation spécialiste' }, // -80€
      { name: 'Réparations Maison', estimated: 150, spent: 220, description: 'Fuite d\'eau réparée' }, // -70€
      { name: 'Cadeaux Famille', estimated: 80, spent: 150, description: 'Anniversaires du mois' }, // -70€
      { name: 'Restaurants', estimated: 160, spent: 200, description: 'Sorties professionnelles' }, // -40€

      // === BUDGET SANS EXCÉDENT MAIS AVEC LÉGÈRE ÉCONOMIE ===
      { name: 'Formation', estimated: 200, spent: 180, description: 'Cours en ligne' } // +20€ (seule vraie économie)
    ]

    // Calcul théorique:
    // Déficits actuels: -10 - 20 - 5 - 80 - 70 - 70 - 40 = -295€
    // Économies actuelles: +20€
    // Balance actuelle: -275€
    // Excédents disponibles: 200 + 150 + 120 + 80 + 60 = +610€
    // Compensation totale: 610 - 275 = +335€

    console.log(`📊 [Negative Surplus Only] Création de ${budgetData.length} budgets avec excédents`)

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
      console.error('❌ [Negative Surplus Only] Erreur création budgets:', budgetError)
      return NextResponse.json({ error: 'Erreur création budgets' }, { status: 500 })
    }

    console.log(`✅ [Negative Surplus Only] ${createdBudgets.length} budgets créés`)

    // 5. Créer les dépenses réelles
    const expenseInserts = []
    const summary = []

    for (const budget of createdBudgets) {
      const budgetConfig = budgetData.find(b => b.name === budget.name)
      if (!budgetConfig) continue

      // Créer des dépenses réalistes
      const numExpenses = budgetConfig.spent > 200 ? 2 : 1
      let totalSpent = 0

      for (let i = 0; i < numExpenses; i++) {
        let expenseAmount

        if (i === numExpenses - 1) {
          // Dernière dépense : ajuster pour atteindre le total exact
          expenseAmount = budgetConfig.spent - totalSpent
        } else {
          // Première dépense
          expenseAmount = Math.floor(budgetConfig.spent * 0.6)
        }

        if (expenseAmount > 0) {
          expenseInserts.push({
            profile_id: userId,
            estimated_budget_id: budget.id,
            amount: expenseAmount,
            description: `${budgetConfig.description} - Achat ${i + 1}`,
            expense_date: '2025-09-22',
            is_exceptional: budgetConfig.spent > budgetConfig.estimated * 1.3
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
        hasExcess: availableExcess > 0
      })

      const symbol = currentDifference > 0 ? '+' : ''
      const excessInfo = availableExcess > 0 ? ` (+ ${availableExcess}€ excédent disponible)` : ''
      console.log(`📝 [Negative Surplus Only] ${budget.name}: ${spent}€ / ${estimated}€ → ${symbol}${currentDifference}€${excessInfo}`)
    }

    // 6. Insérer toutes les dépenses
    const { error: expenseError } = await supabaseServer
      .from('real_expenses')
      .insert(expenseInserts)

    if (expenseError) {
      console.error('❌ [Negative Surplus Only] Erreur création dépenses:', expenseError)
      return NextResponse.json({ error: 'Erreur création dépenses' }, { status: 500 })
    }

    console.log(`✅ [Negative Surplus Only] ${expenseInserts.length} dépenses créées`)

    // 7. Calculer les statistiques de compensation
    const currentSurplus = summary.reduce((sum, item) => sum + item.currentSurplus, 0)
    const currentDeficit = summary.reduce((sum, item) => sum + item.currentDeficit, 0)
    const totalExcess = summary.reduce((sum, item) => sum + item.availableExcess, 0)
    const netCurrent = currentSurplus - currentDeficit

    // Dans ce scénario, seuls les excédents comptent pour la compensation
    const effectiveCompensation = totalExcess + Math.min(0, netCurrent) // Si netCurrent est négatif, il s'ajoute au problème

    // Simulation d'un reste à vivre négatif
    const simulatedNegativeRemainder = -500 // 500€ de déficit sur le reste à vivre

    const budgetsByStatus = {
      surplus: summary.filter(b => b.status === 'surplus'),
      deficit: summary.filter(b => b.status === 'deficit'),
      balanced: summary.filter(b => b.status === 'balanced'),
      withExcess: summary.filter(b => b.hasExcess)
    }

    console.log('📊 [Negative Surplus Only] Statistiques générées:')
    console.log(`💚 Économies actuelles: ${currentSurplus}€`)
    console.log(`❤️ Déficits actuels: ${currentDeficit}€`)
    console.log(`💰 Balance actuelle: ${netCurrent}€`)
    console.log(`🏦 Excédents disponibles: ${totalExcess}€`)
    console.log(`📈 Compensation effective: ${effectiveCompensation}€`)
    console.log(`🔴 Reste à vivre simulé: ${simulatedNegativeRemainder}€`)
    console.log(`⚖️ Balance finale: ${effectiveCompensation + simulatedNegativeRemainder}€`)

    return NextResponse.json({
      success: true,
      message: 'Scénario "Reste négatif compensé par excédents uniquement" créé avec succès',
      scenario: 'negative-remainder-surplus-only',
      description: 'Le reste à vivre négatif est compensé uniquement par les excédents accumulés, pas d\'économies actuelles significatives',
      statistics: {
        totalBudgets: createdBudgets.length,
        totalExpenses: expenseInserts.length,
        budgetsByStatus,
        compensation: {
          currentSavings: currentSurplus,
          currentDeficits: currentDeficit,
          netCurrent: netCurrent,
          availableExcess: totalExcess,
          effectiveCompensation: effectiveCompensation,
          simulatedNegativeRemainder: simulatedNegativeRemainder,
          finalBalance: effectiveCompensation + simulatedNegativeRemainder,
          canFullyCompensate: effectiveCompensation >= Math.abs(simulatedNegativeRemainder)
        }
      },
      summary: summary.sort((a, b) => {
        // Trier d'abord par excédents disponibles, puis par différence actuelle
        if (b.availableExcess !== a.availableExcess) {
          return b.availableExcess - a.availableExcess
        }
        return b.currentDifference - a.currentDifference
      }),
      testScenario: {
        remainderToLive: simulatedNegativeRemainder,
        compensationType: 'surplus-only',
        availableExcess: totalExcess,
        currentBalance: netCurrent,
        totalCompensation: effectiveCompensation,
        isFullyCompensated: effectiveCompensation >= Math.abs(simulatedNegativeRemainder),
        budgetsWithExcess: summary.filter(b => b.hasExcess).length
      },
      actions: {
        budgetsCreated: createdBudgets.length,
        expensesCreated: expenseInserts.length,
        previousDataDeleted: true,
        snapshotsDeactivated: true
      }
    })

  } catch (error) {
    console.error('❌ [Negative Surplus Only] Erreur générale:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}