import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API GET /api/debug/quick-test
 *
 * Endpoint de debug pour inspecter en temps réel l'état financier complet
 * Affiche toutes les données nécessaires pour comprendre les calculs
 */
export async function GET(request: NextRequest) {
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
    const context = 'profile' // Pour l'instant on se concentre sur le profil

    console.log(`🔍 [Debug] === INSPECTION COMPLÈTE - User: ${userId} ===`)

    // 1. PROFIL ET GROUPE
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    console.log(`👤 [Debug] Profil:`, {
      id: profile?.id,
      name: `${profile?.first_name} ${profile?.last_name}`,
      salary: profile?.salary,
      group_id: profile?.group_id
    })

    // 2. REVENUS ESTIMÉS
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('*')
      .eq('profile_id', userId)

    const totalEstimatedIncome = estimatedIncomes?.reduce((sum, income) => sum + income.estimated_amount, 0) || 0
    console.log(`💰 [Debug] Revenus estimés (${estimatedIncomes?.length || 0}):`, estimatedIncomes)
    console.log(`💰 [Debug] Total revenus estimés: ${totalEstimatedIncome}€`)

    // 3. REVENUS RÉELS
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('*')
      .eq('profile_id', userId)

    const totalRealIncome = realIncomes?.reduce((sum, income) => sum + income.amount, 0) || 0
    console.log(`💸 [Debug] Revenus réels (${realIncomes?.length || 0}):`, realIncomes)
    console.log(`💸 [Debug] Total revenus réels: ${totalRealIncome}€`)

    // 4. BUDGETS ESTIMÉS
    const { data: budgets } = await supabaseServer
      .from('estimated_budgets')
      .select('*')
      .eq('profile_id', userId)

    const totalEstimatedBudgets = budgets?.reduce((sum, budget) => sum + budget.estimated_amount, 0) || 0
    const totalSavings = budgets?.reduce((sum, budget) => sum + (budget.current_savings || 0), 0) || 0
    const totalMonthlySurplus = budgets?.reduce((sum, budget) => sum + (budget.monthly_surplus || 0), 0) || 0

    console.log(`🏦 [Debug] Budgets estimés (${budgets?.length || 0}):`)
    budgets?.forEach(budget => {
      console.log(`  📊 ${budget.name}: ${budget.estimated_amount}€ estimé | ${budget.current_savings || 0}€ économies | ${budget.monthly_surplus || 0}€ excédents`)
    })
    console.log(`🏦 [Debug] Total budgets estimés: ${totalEstimatedBudgets}€`)
    console.log(`🏦 [Debug] Total économies stockées: ${totalSavings}€`)
    console.log(`🏦 [Debug] Total excédents accumulés: ${totalMonthlySurplus}€`)

    // 5. DÉPENSES RÉELLES
    const { data: expenses } = await supabaseServer
      .from('real_expenses')
      .select('*')
      .eq('profile_id', userId)

    // Séparer les types de dépenses
    const normalExpenses = expenses?.filter(e => !e.description?.includes('Équilibrage automatique')) || []
    const balancingExpenses = expenses?.filter(e => e.description?.includes('Équilibrage automatique')) || []
    const exceptionalExpenses = normalExpenses.filter(e => !e.estimated_budget_id)
    const budgetExpenses = normalExpenses.filter(e => e.estimated_budget_id)

    const totalNormalExpenses = normalExpenses.reduce((sum, e) => sum + e.amount, 0)
    const totalBalancingExpenses = balancingExpenses.reduce((sum, e) => sum + e.amount, 0)
    const totalExceptionalExpenses = exceptionalExpenses.reduce((sum, e) => sum + e.amount, 0)

    console.log(`💳 [Debug] Dépenses réelles (${expenses?.length || 0} total):`)
    console.log(`  📝 Dépenses normales: ${normalExpenses.length} (${totalNormalExpenses}€)`)
    console.log(`  ⚖️ Dépenses d'équilibrage: ${balancingExpenses.length} (${totalBalancingExpenses}€)`)
    console.log(`  🚨 Dépenses exceptionnelles: ${exceptionalExpenses.length} (${totalExceptionalExpenses}€)`)

    // 6. CALCUL DES STATISTIQUES PAR BUDGET
    const budgetStats = budgets?.map(budget => {
      const budgetNormalExpenses = budgetExpenses.filter(e => e.estimated_budget_id === budget.id)
      const budgetBalancingExpenses = balancingExpenses.filter(e => e.estimated_budget_id === budget.id)
      const allBudgetExpenses = expenses?.filter(e => e.estimated_budget_id === budget.id) || []

      const normalSpent = budgetNormalExpenses.reduce((sum, e) => sum + e.amount, 0)
      const balancingSpent = budgetBalancingExpenses.reduce((sum, e) => sum + e.amount, 0)
      const totalSpent = allBudgetExpenses.reduce((sum, e) => sum + e.amount, 0)

      const currentSurplus = Math.max(0, budget.estimated_amount - normalSpent)
      const currentDeficit = Math.max(0, normalSpent - budget.estimated_amount)
      const finalSurplus = Math.max(0, budget.estimated_amount - totalSpent)
      const finalDeficit = Math.max(0, totalSpent - budget.estimated_amount)

      return {
        id: budget.id,
        name: budget.name,
        estimated: budget.estimated_amount,
        normalSpent,
        balancingSpent,
        totalSpent,
        currentSurplus,
        currentDeficit,
        finalSurplus,
        finalDeficit,
        savings: budget.current_savings || 0,
        monthlyExcess: budget.monthly_surplus || 0,
        totalAvailable: currentSurplus + (budget.current_savings || 0) + (budget.monthly_surplus || 0)
      }
    }) || []

    console.log(`📊 [Debug] Analyse détaillée par budget:`)
    budgetStats.forEach(stat => {
      console.log(`  💼 ${stat.name}:`)
      console.log(`    📈 Estimé: ${stat.estimated}€`)
      console.log(`    📉 Dépensé normal: ${stat.normalSpent}€`)
      console.log(`    ⚖️ Dépensé équilibrage: ${stat.balancingSpent}€`)
      console.log(`    📊 Total dépensé: ${stat.totalSpent}€`)
      console.log(`    💚 Surplus actuel: ${stat.currentSurplus}€`)
      console.log(`    ❤️ Déficit actuel: ${stat.currentDeficit}€`)
      console.log(`    💎 Économies stockées: ${stat.savings}€`)
      console.log(`    🏦 Excédents accumulés: ${stat.monthlyExcess}€`)
      console.log(`    💰 Total disponible: ${stat.totalAvailable}€`)
      console.log(`    ---`)
    })

    // 7. CALCUL DU RESTE À VIVRE
    const remainingToLive = totalEstimatedIncome + totalRealIncome - totalEstimatedBudgets - totalExceptionalExpenses + totalSavings

    console.log(`🎯 [Debug] === CALCUL RESTE À VIVRE ===`)
    console.log(`🎯 [Debug] Formule: Revenus estimés + Revenus réels - Budgets estimés - Exceptionnelles + Économies`)
    console.log(`🎯 [Debug] Calcul: ${totalEstimatedIncome} + ${totalRealIncome} - ${totalEstimatedBudgets} - ${totalExceptionalExpenses} + ${totalSavings}`)
    console.log(`🎯 [Debug] Résultat: ${remainingToLive}€`)

    // 8. SNAPSHOTS ACTIFS ET HISTORIQUES
    const { data: snapshots } = await supabaseServer
      .from('recap_snapshots')
      .select('*')
      .eq('profile_id', userId)
      .eq('is_active', true)

    const { data: allSnapshots } = await supabaseServer
      .from('recap_snapshots')
      .select('*')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(5)

    console.log(`📸 [Debug] Snapshots actifs (${snapshots?.length || 0}):`, snapshots)
    console.log(`📸 [Debug] 5 derniers snapshots:`, allSnapshots)

    // 9. RÉCAPS MENSUELS RÉCENTS
    const { data: monthlyRecaps } = await supabaseServer
      .from('monthly_recaps')
      .select('*')
      .eq('profile_id', userId)
      .order('completed_at', { ascending: false })
      .limit(3)

    console.log(`📅 [Debug] 3 derniers récaps mensuels:`, monthlyRecaps)

    // 10. TRANSFERTS BUDGÉTAIRES
    const { data: budgetTransfers } = await supabaseServer
      .from('budget_transfers')
      .select('*')
      .eq('profile_id', userId)

    console.log(`🔄 [Debug] Transferts budgétaires (${budgetTransfers?.length || 0}):`, budgetTransfers)

    // 11. ANALYSE DES PROBLÈMES POTENTIELS
    const potentialIssues = []

    // Vérifier les incohérences
    if (totalRealIncome > totalEstimatedIncome * 2) {
      potentialIssues.push(`⚠️ Revenus réels très élevés vs estimés (${totalRealIncome}€ vs ${totalEstimatedIncome}€)`)
    }

    if (totalBalancingExpenses > 0 && remainingToLive >= 0) {
      potentialIssues.push(`⚠️ Dépenses d'équilibrage présentes mais RAV positif`)
    }

    if (snapshots && snapshots.length > 1) {
      potentialIssues.push(`⚠️ Plusieurs snapshots actifs (${snapshots.length})`)
    }

    const budgetsWithNegativeSavings = budgets?.filter(b => (b.current_savings || 0) < 0) || []
    if (budgetsWithNegativeSavings.length > 0) {
      potentialIssues.push(`⚠️ ${budgetsWithNegativeSavings.length} budget(s) avec économies négatives`)
    }

    console.log(`🚨 [Debug] Problèmes potentiels détectés (${potentialIssues.length}):`)
    potentialIssues.forEach(issue => console.log(`  ${issue}`))

    // 12. RÉSUMÉ GLOBAL
    const totalCurrentSurplus = budgetStats.reduce((sum, stat) => sum + stat.currentSurplus, 0)
    const totalCurrentDeficit = budgetStats.reduce((sum, stat) => sum + stat.currentDeficit, 0)
    const totalAvailableCompensation = totalCurrentSurplus + totalSavings + totalMonthlySurplus

    console.log(`🎯 [Debug] === RÉSUMÉ GLOBAL ===`)
    console.log(`🎯 [Debug] Reste à vivre: ${remainingToLive}€`)
    console.log(`🎯 [Debug] Surplus totaux actuels: ${totalCurrentSurplus}€`)
    console.log(`🎯 [Debug] Déficits totaux actuels: ${totalCurrentDeficit}€`)
    console.log(`🎯 [Debug] Économies stockées: ${totalSavings}€`)
    console.log(`🎯 [Debug] Excédents accumulés: ${totalMonthlySurplus}€`)
    console.log(`🎯 [Debug] Compensation totale disponible: ${totalAvailableCompensation}€`)
    console.log(`🎯 [Debug] Peut équilibrer déficit RAV: ${remainingToLive < 0 ? (totalAvailableCompensation >= Math.abs(remainingToLive) ? 'OUI ✅' : 'PARTIELLEMENT ⚠️') : 'N/A'}`)

    // 13. ÉTAT DU SYSTÈME POUR MONTHLY RECAP
    const monthlyRecapStatus = {
      can_initialize: snapshots?.length === 0,
      has_active_snapshot: snapshots && snapshots.length > 0,
      can_balance: snapshots && snapshots.length > 0 && remainingToLive < 0,
      can_complete: snapshots && snapshots.length > 0,
      last_recap_date: monthlyRecaps && monthlyRecaps.length > 0 ? monthlyRecaps[0].completed_at : null
    }

    console.log(`📋 [Debug] === ÉTAT MONTHLY RECAP ===`)
    console.log(`📋 [Debug] Peut initialiser: ${monthlyRecapStatus.can_initialize ? 'OUI ✅' : 'NON ❌'}`)
    console.log(`📋 [Debug] Snapshot actif: ${monthlyRecapStatus.has_active_snapshot ? 'OUI ✅' : 'NON ❌'}`)
    console.log(`📋 [Debug] Peut équilibrer: ${monthlyRecapStatus.can_balance ? 'OUI ✅' : 'NON ❌'}`)
    console.log(`📋 [Debug] Peut finaliser: ${monthlyRecapStatus.can_complete ? 'OUI ✅' : 'NON ❌'}`)
    console.log(`📋 [Debug] Dernier récap: ${monthlyRecapStatus.last_recap_date || 'Jamais'}`)

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      profile: {
        id: profile?.id,
        name: `${profile?.first_name} ${profile?.last_name}`,
        salary: profile?.salary
      },
      financial_state: {
        remaining_to_live: remainingToLive,
        total_estimated_income: totalEstimatedIncome,
        total_real_income: totalRealIncome,
        total_estimated_budgets: totalEstimatedBudgets,
        total_exceptional_expenses: totalExceptionalExpenses,
        total_savings: totalSavings,
        total_monthly_surplus: totalMonthlySurplus
      },
      compensation_analysis: {
        current_surplus: totalCurrentSurplus,
        current_deficit: totalCurrentDeficit,
        stored_savings: totalSavings,
        accumulated_excess: totalMonthlySurplus,
        total_available: totalAvailableCompensation,
        can_compensate_negative_remainder: remainingToLive < 0 ? totalAvailableCompensation >= Math.abs(remainingToLive) : null
      },
      budget_details: budgetStats,
      expenses_breakdown: {
        normal_expenses: normalExpenses.length,
        normal_amount: totalNormalExpenses,
        balancing_expenses: balancingExpenses.length,
        balancing_amount: totalBalancingExpenses,
        exceptional_expenses: exceptionalExpenses.length,
        exceptional_amount: totalExceptionalExpenses
      },
      monthly_recap_status: monthlyRecapStatus,
      system_health: {
        potential_issues: potentialIssues,
        active_snapshots: snapshots?.length || 0,
        recent_monthly_recaps: monthlyRecaps?.length || 0,
        budget_transfers: budgetTransfers?.length || 0,
        total_budgets: budgets?.length || 0,
        total_incomes: (estimatedIncomes?.length || 0) + (realIncomes?.length || 0),
        total_expenses: expenses?.length || 0
      },
      raw_data: {
        estimated_incomes: estimatedIncomes,
        real_incomes: realIncomes,
        estimated_budgets: budgets,
        real_expenses: expenses,
        active_snapshots: snapshots,
        recent_recaps: monthlyRecaps,
        budget_transfers: budgetTransfers
      }
    })

  } catch (error) {
    console.error('❌ [Debug] Erreur lors de l\'inspection:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * API POST /api/debug/quick-test
 *
 * Test rapide pour l'équilibrage automatique avec un scénario prédéfini
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

    console.log(`🧪 [Quick Test] Début du test rapide pour utilisateur: ${userId}`)

    // 1. Nettoyer toutes les données existantes
    console.log(`🧹 [Quick Test] Nettoyage des données...`)

    const tables = ['real_expenses', 'real_income_entries', 'estimated_budgets', 'estimated_incomes']

    for (const table of tables) {
      await supabaseServer.from(table).delete().eq('profile_id', userId)
    }

    // 2. Créer un scénario de test simple mais représentatif
    console.log(`🎬 [Quick Test] Création du scénario de test...`)

    // Revenus: 3000€ total
    const { data: income1 } = await supabaseServer
      .from('estimated_incomes')
      .insert({
        profile_id: userId,
        name: 'Salaire',
        estimated_amount: 2800
      })
      .select()
      .single()

    const { data: income2 } = await supabaseServer
      .from('estimated_incomes')
      .insert({
        profile_id: userId,
        name: 'Freelance',
        estimated_amount: 200
      })
      .select()
      .single()

    // Budgets: Total 5200€ (donc reste à vivre = 3000 - 5200 = -2200€)
    const budgets = [
      // Budgets excédentaires (550€ de surplus total)
      { name: 'Courses', estimated: 400, spent: 320, savings: 50 },
      { name: 'Transport', estimated: 200, spent: 150, savings: 30 },
      { name: 'Épargne Vacances', estimated: 500, spent: 80, savings: 100 },

      // Budgets normaux (pas de surplus/déficit)
      { name: 'Téléphone', estimated: 50, spent: 50, savings: 0 },
      { name: 'Internet', estimated: 45, spent: 45, savings: 0 },

      // Budgets déficitaires (615€ de déficit total)
      { name: 'Logement', estimated: 800, spent: 950, savings: 0 },
      { name: 'Voiture Réparation', estimated: 200, spent: 380, savings: 0 },
      { name: 'Santé', estimated: 100, spent: 135, savings: 0 },
      { name: 'Restaurants', estimated: 180, spent: 230, savings: 0 },
      { name: 'Vêtements', estimated: 150, spent: 190, savings: 0 },

      // Autres budgets
      { name: 'Loisirs', estimated: 250, spent: 180, savings: 0 },
      { name: 'Formation', estimated: 300, spent: 60, savings: 0 },
      { name: 'Travaux Maison', estimated: 600, spent: 120, savings: 0 },
      { name: 'Sport', estimated: 180, spent: 35, savings: 0 },
      { name: 'Culture', estimated: 220, spent: 50, savings: 0 },
      { name: 'Chauffage', estimated: 150, spent: 45, savings: 0 },
      { name: 'Jardinage', estimated: 90, spent: 30, savings: 0 },
      { name: 'Produits Beauté', estimated: 80, spent: 55, savings: 0 },
      { name: 'Livres', estimated: 40, spent: 25, savings: 0 },
      { name: 'Cadeaux', estimated: 120, spent: 280, savings: 0 },
      { name: 'Assurances', estimated: 120, spent: 120, savings: 0 },
      { name: 'Transport Public', estimated: 75, spent: 60, savings: 0 },
      { name: 'Équipement Tech', estimated: 350, spent: 45, savings: 0 }
    ]

    let totalEstimatedBudgets = 0
    let totalSurplus = 0
    let totalDeficit = 0
    let totalSavings = 0

    for (const budget of budgets) {
      // Créer le budget estimé
      const { data: budgetData } = await supabaseServer
        .from('estimated_budgets')
        .insert({
          profile_id: userId,
          name: budget.name,
          estimated_amount: budget.estimated,
          current_savings: budget.savings
        })
        .select()
        .single()

      if (budgetData && budget.spent > 0) {
        // Créer les dépenses réelles
        await supabaseServer
          .from('real_expenses')
          .insert({
            profile_id: userId,
            estimated_budget_id: budgetData.id,
            amount: budget.spent,
            description: `Test - ${budget.name}`,
            expense_date: new Date().toISOString().split('T')[0]
          })
      }

      totalEstimatedBudgets += budget.estimated
      totalSavings += budget.savings

      if (budget.spent < budget.estimated) {
        totalSurplus += (budget.estimated - budget.spent)
      } else if (budget.spent > budget.estimated) {
        totalDeficit += (budget.spent - budget.estimated)
      }
    }

    const expectedRemainingToLive = 3000 - totalEstimatedBudgets + totalSavings

    console.log(`📊 [Quick Test] Scénario créé:`)
    console.log(`  - Revenus estimés: 3000€`)
    console.log(`  - Budgets estimés: ${totalEstimatedBudgets}€`)
    console.log(`  - Économies: ${totalSavings}€`)
    console.log(`  - Reste à vivre attendu: ${expectedRemainingToLive}€`)
    console.log(`  - Surplus total: ${totalSurplus}€`)
    console.log(`  - Déficit total: ${totalDeficit}€`)

    // 3. Initialiser le monthly recap
    console.log(`📋 [Quick Test] Initialisation du monthly recap...`)

    const initResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/monthly-recap/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('cookie') || ''
      },
      body: JSON.stringify({ context: 'profile' })
    })

    if (!initResponse.ok) {
      const errorData = await initResponse.text()
      throw new Error(`Erreur initialisation monthly recap: ${initResponse.status} - ${errorData}`)
    }

    const initData = await initResponse.json()

    console.log(`✅ [Quick Test] Monthly recap initialisé:`)
    console.log(`  - Reste à vivre: ${initData.current_remaining_to_live}€`)
    console.log(`  - Total surplus: ${initData.total_surplus}€`)
    console.log(`  - Total déficit: ${initData.total_deficit}€`)

    // 4. Tester l'équilibrage si nécessaire
    let balanceResult = null

    if (initData.current_remaining_to_live < 0) {
      console.log(`⚖️ [Quick Test] Test de l'équilibrage automatique...`)

      const balanceResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/monthly-recap/balance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': request.headers.get('cookie') || ''
        },
        body: JSON.stringify({
          context: 'profile',
          snapshot_id: initData.snapshot_id
        })
      })

      if (!balanceResponse.ok) {
        const errorData = await balanceResponse.text()
        throw new Error(`Erreur équilibrage: ${balanceResponse.status} - ${errorData}`)
      }

      balanceResult = await balanceResponse.json()

      console.log(`✅ [Quick Test] Équilibrage terminé:`)
      console.log(`  - Reste à vivre original: ${balanceResult.original_remaining_to_live}€`)
      console.log(`  - Reste à vivre final: ${balanceResult.final_remaining_to_live}€`)
      console.log(`  - Montant redistribué: ${balanceResult.deficit_covered}€`)
      console.log(`  - Déficit restant: ${balanceResult.remaining_deficit}€`)
    }

    // 5. Calculer les résultats attendus vs obtenus
    const verification = {
      expectedRemainingToLive,
      actualRemainingToLive: initData.current_remaining_to_live,
      expectedSurplus: totalSurplus,
      actualSurplus: initData.total_surplus,
      expectedDeficit: totalDeficit,
      actualDeficit: initData.total_deficit,
      balanceTest: null
    }

    if (balanceResult) {
      const expectedFinalRemainingToLive = balanceResult.original_remaining_to_live + balanceResult.deficit_covered
      verification.balanceTest = {
        originalRemainingToLive: balanceResult.original_remaining_to_live,
        finalRemainingToLive: balanceResult.final_remaining_to_live,
        expectedFinalRemainingToLive,
        redistributedAmount: balanceResult.deficit_covered,
        remainingDeficit: balanceResult.remaining_deficit,
        isCorrect: Math.abs(balanceResult.final_remaining_to_live - expectedFinalRemainingToLive) < 0.01
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Test rapide terminé',
      scenario: {
        totalRevenues: 3000,
        totalBudgets: totalEstimatedBudgets,
        totalSavings,
        totalSurplus,
        totalDeficit
      },
      initialState: initData,
      balanceResult,
      verification
    })

  } catch (error) {
    console.error('❌ [Quick Test] Erreur:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}