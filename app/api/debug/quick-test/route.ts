import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

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