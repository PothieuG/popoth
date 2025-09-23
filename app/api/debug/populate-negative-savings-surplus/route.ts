import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/populate-negative-savings-surplus
 *
 * Scénario: Reste à vivre négatif compensé d'abord par les économies puis par les excédents
 * Simule un utilisateur avec un gros déficit de reste à vivre qui nécessite:
 * 1. D'utiliser toutes les économies des budgets
 * 2. Puis d'utiliser les excédents des budgets précédents
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
    console.log(`🏗️ [Negative Savings+Surplus] Création scénario déficit important pour userId: ${userId}`)

    // 1. Supprimer les données existantes
    console.log('🗑️ [Negative Savings+Surplus] Nettoyage des données existantes...')

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

    // 3. Créer un profil où il faut d'abord utiliser les économies puis puiser dans les excédents
    // Objectif: Déficit de ~1200€ nécessitant économies (~500€) + excédents (~700€)
    const budgetData = [
      // === BUDGETS AVEC ÉCONOMIES ACTUELLES (month courant) ===
      { name: 'Vacances Annulées', estimated: 400, spent: 150, description: 'Voyage reporté' }, // +250€ économie
      { name: 'Formation Pro', estimated: 300, spent: 120, description: 'Formation gratuite trouvée' }, // +180€ économie
      { name: 'Équipement Sport', estimated: 200, spent: 130, description: 'Acheté d\'occasion' }, // +70€ économie
      // Total économies actuelles: ~500€

      // === BUDGETS AVEC EXCÉDENTS ACCUMULÉS (mois précédents) ===
      // Ces budgets ont des excédents des mois passés qui peuvent être utilisés
      { name: 'Courses', estimated: 400, spent: 420, description: 'Légère hausse des prix', monthlyExcess: 300 }, // -20€ + 300€ excédent
      { name: 'Essence', estimated: 200, spent: 180, description: 'Moins de trajets', monthlyExcess: 150 }, // +20€ + 150€ excédent
      { name: 'Loisirs', estimated: 250, spent: 280, description: 'Sorties exceptionnelles', monthlyExcess: 200 }, // -30€ + 200€ excédent
      { name: 'Vêtements', estimated: 150, spent: 140, description: 'Achat modéré', monthlyExcess: 80 }, // +10€ + 80€ excédent
      // Total excédents disponibles: 300 + 150 + 200 + 80 = 730€

      // === BUDGETS FIXES (incompressibles) ===
      { name: 'Loyer', estimated: 1200, spent: 1200, description: 'Charges fixes' }, // 0€
      { name: 'Assurances', estimated: 150, spent: 150, description: 'Assurance auto + habitation' }, // 0€
      { name: 'Électricité', estimated: 90, spent: 90, description: 'Facture EDF' }, // 0€
      { name: 'Internet', estimated: 45, spent: 45, description: 'Box internet' }, // 0€
      { name: 'Téléphone', estimated: 60, spent: 60, description: 'Forfait mobile' }, // 0€

      // === BUDGETS AVEC DÉFICITS (créent le besoin) ===
      { name: 'Santé Urgence', estimated: 120, spent: 350, description: 'Hospitalisation imprévue' }, // -230€
      { name: 'Réparation Voiture', estimated: 100, spent: 400, description: 'Grosse panne moteur' }, // -300€
      { name: 'Équipement Maison', estimated: 80, spent: 250, description: 'Électroménager en panne' } // -170€
      // Total déficits: 700€
    ]

    // Calcul théorique:
    // Économies actuelles: +500€
    // Déficits actuels: -700€
    // Balance actuelle: -200€
    // Excédents disponibles: +730€
    // Balance finale: +530€ (reste à vivre négatif peut être compensé jusqu'à -530€)

    console.log(`📊 [Negative Savings+Surplus] Création de ${budgetData.length} budgets complexes`)

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
      console.error('❌ [Negative Savings+Surplus] Erreur création budgets:', budgetError)
      return NextResponse.json({ error: 'Erreur création budgets' }, { status: 500 })
    }

    console.log(`✅ [Negative Savings+Surplus] ${createdBudgets.length} budgets créés`)

    // 5. Créer les dépenses réelles
    const expenseInserts = []
    const summary = []

    for (const budget of createdBudgets) {
      const budgetConfig = budgetData.find(b => b.name === budget.name)
      if (!budgetConfig) continue

      // Créer des dépenses réalistes
      const numExpenses = budgetConfig.spent > 300 ? 3 : budgetConfig.spent > 100 ? 2 : 1
      let totalSpent = 0

      for (let i = 0; i < numExpenses; i++) {
        let expenseAmount

        if (i === numExpenses - 1) {
          // Dernière dépense : ajuster pour atteindre le total exact
          expenseAmount = budgetConfig.spent - totalSpent
        } else {
          // Répartir les dépenses
          expenseAmount = Math.floor(budgetConfig.spent / numExpenses)
        }

        if (expenseAmount > 0) {
          expenseInserts.push({
            profile_id: userId,
            estimated_budget_id: budget.id,
            amount: expenseAmount,
            description: `${budgetConfig.description} - Dépense ${i + 1}`,
            expense_date: '2025-09-22',
            is_exceptional: budgetConfig.spent > budgetConfig.estimated * 1.5
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
      const excessInfo = availableExcess > 0 ? ` (+ ${availableExcess}€ excédent)` : ''
      console.log(`📝 [Negative Savings+Surplus] ${budget.name}: ${spent}€ / ${estimated}€ → ${symbol}${currentDifference}€${excessInfo}`)
    }

    // 6. Insérer toutes les dépenses
    const { error: expenseError } = await supabaseServer
      .from('real_expenses')
      .insert(expenseInserts)

    if (expenseError) {
      console.error('❌ [Negative Savings+Surplus] Erreur création dépenses:', expenseError)
      return NextResponse.json({ error: 'Erreur création dépenses' }, { status: 500 })
    }

    console.log(`✅ [Negative Savings+Surplus] ${expenseInserts.length} dépenses créées`)

    // 7. Calculer les statistiques de compensation
    const currentSurplus = summary.reduce((sum, item) => sum + item.currentSurplus, 0)
    const currentDeficit = summary.reduce((sum, item) => sum + item.currentDeficit, 0)
    const totalExcess = summary.reduce((sum, item) => sum + item.availableExcess, 0)
    const netCurrent = currentSurplus - currentDeficit
    const totalCompensation = netCurrent + totalExcess

    // Simulation d'un reste à vivre négatif important
    const simulatedNegativeRemainder = -800 // 800€ de déficit sur le reste à vivre

    const budgetsByStatus = {
      surplus: summary.filter(b => b.status === 'surplus'),
      deficit: summary.filter(b => b.status === 'deficit'),
      balanced: summary.filter(b => b.status === 'balanced'),
      withExcess: summary.filter(b => b.hasExcess)
    }

    console.log('📊 [Negative Savings+Surplus] Statistiques générées:')
    console.log(`💚 Économies actuelles: ${currentSurplus}€`)
    console.log(`❤️ Déficits actuels: ${currentDeficit}€`)
    console.log(`💰 Balance actuelle: ${netCurrent}€`)
    console.log(`🏦 Excédents disponibles: ${totalExcess}€`)
    console.log(`📈 Compensation totale possible: ${totalCompensation}€`)
    console.log(`🔴 Reste à vivre simulé: ${simulatedNegativeRemainder}€`)
    console.log(`⚖️ Balance finale: ${totalCompensation + simulatedNegativeRemainder}€`)

    return NextResponse.json({
      success: true,
      message: 'Scénario "Reste négatif compensé par économies puis excédents" créé avec succès',
      scenario: 'negative-remainder-savings-then-surplus',
      description: 'Le reste à vivre négatif nécessite d\'utiliser les économies actuelles puis les excédents accumulés',
      statistics: {
        totalBudgets: createdBudgets.length,
        totalExpenses: expenseInserts.length,
        budgetsByStatus,
        compensation: {
          step1_currentSavings: currentSurplus,
          step1_currentDeficits: currentDeficit,
          step1_netCurrent: netCurrent,
          step2_availableExcess: totalExcess,
          total_compensation: totalCompensation,
          simulatedNegativeRemainder: simulatedNegativeRemainder,
          finalBalance: totalCompensation + simulatedNegativeRemainder,
          canFullyCompensate: totalCompensation >= Math.abs(simulatedNegativeRemainder)
        }
      },
      summary: summary.sort((a, b) => b.totalAvailable - a.totalAvailable),
      testScenario: {
        remainderToLive: simulatedNegativeRemainder,
        compensationSteps: [
          { step: 1, type: 'current-savings', amount: Math.max(0, netCurrent) },
          { step: 2, type: 'accumulated-excess', amount: totalExcess }
        ],
        totalCompensation: totalCompensation,
        isFullyCompensated: totalCompensation >= Math.abs(simulatedNegativeRemainder)
      },
      actions: {
        budgetsCreated: createdBudgets.length,
        expensesCreated: expenseInserts.length,
        previousDataDeleted: true,
        snapshotsDeactivated: true
      }
    })

  } catch (error) {
    console.error('❌ [Negative Savings+Surplus] Erreur générale:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}