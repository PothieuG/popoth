import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/test-balance
 *
 * Script de test pour l'équilibrage automatique du reste à vivre
 *
 * Ce script:
 * 1. Nettoie toutes les données financières de l'utilisateur
 * 2. Crée des scénarios de test spécifiques
 * 3. Teste l'équilibrage automatique
 * 4. Vérifie les résultats
 *
 * Scénarios testés:
 * - Budgets excédentaires seulement
 * - Budgets déficitaires seulement
 * - Mix excédents/déficits
 * - Budgets avec économies
 * - Reste à vivre négatif variable
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

    const { scenario } = await request.json()
    const userId = sessionData.userId

    // Récupérer le profil utilisateur
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profil utilisateur non trouvé' },
        { status: 404 }
      )
    }

    console.log(`🧪 [Test Balance] Début du test scenario "${scenario}" pour utilisateur: ${userId}`)

    // 1. Nettoyer toutes les données existantes
    await cleanUserData(userId)

    // 2. Créer le scénario de test demandé
    const testData = await createTestScenario(userId, scenario)

    // 3. Tester l'équilibrage automatique
    const balanceResult = await testBalance(userId)

    // 4. Vérifier les résultats
    const verification = await verifyResults(userId, testData, balanceResult)

    return NextResponse.json({
      success: true,
      scenario,
      testData,
      balanceResult,
      verification,
      message: `Test "${scenario}" terminé avec succès`
    })

  } catch (error) {
    console.error('❌ [Test Balance] Erreur lors du test:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * Nettoie toutes les données financières de l'utilisateur
 */
async function cleanUserData(userId: string) {
  console.log(`🧹 [Test Balance] Nettoyage des données pour ${userId}`)

  // Supprimer dans l'ordre pour éviter les conflits de foreign key
  const tables = [
    'real_expenses',
    'real_income_entries',
    'estimated_budgets',
    'estimated_incomes',
    'remaining_to_live_snapshots'
  ]

  for (const table of tables) {
    const { error } = await supabaseServer
      .from(table)
      .delete()
      .eq('profile_id', userId)

    if (error) {
      console.error(`❌ [Test Balance] Erreur suppression ${table}:`, error)
    } else {
      console.log(`✅ [Test Balance] Table ${table} nettoyée`)
    }
  }

  // Réinitialiser le solde bancaire
  const { error: bankError } = await supabaseServer
    .from('bank_balances')
    .upsert({
      profile_id: userId,
      balance: 10000 // Solde de base pour les tests
    })

  if (bankError) {
    console.error(`❌ [Test Balance] Erreur réinitialisation solde:`, bankError)
  } else {
    console.log(`✅ [Test Balance] Solde bancaire réinitialisé à 10000€`)
  }
}

/**
 * Crée un scénario de test spécifique
 */
async function createTestScenario(userId: string, scenario: string) {
  console.log(`🎬 [Test Balance] Création du scénario "${scenario}"`)

  const testData = {
    scenario,
    expectedRemainingToLive: 0,
    expectedSurplus: 0,
    expectedDeficit: 0,
    expectedSavings: 0,
    budgets: [],
    incomes: []
  }

  // Créer des revenus de base
  const baseIncomes = [
    { name: 'Salaire', estimated_amount: 3000 },
    { name: 'Freelance', estimated_amount: 500 }
  ]

  for (const income of baseIncomes) {
    const { data, error } = await supabaseServer
      .from('estimated_incomes')
      .insert({
        profile_id: userId,
        ...income
      })
      .select()
      .single()

    if (!error && data) {
      testData.incomes.push(data)
    }
  }

  // Créer les budgets selon le scénario
  let budgets = []

  switch (scenario) {
    case 'surplus_only':
      budgets = [
        { name: 'Courses', estimated_amount: 400, spent_amount: 320, current_savings: 0 },
        { name: 'Transport', estimated_amount: 200, spent_amount: 150, current_savings: 0 },
        { name: 'Loisirs', estimated_amount: 300, spent_amount: 180, current_savings: 0 }
      ]
      testData.expectedRemainingToLive = 3500 - 900 // 2600 - Revenus - budgets estimés
      testData.expectedSurplus = (400-320) + (200-150) + (300-180) // 80 + 50 + 120 = 250
      break

    case 'deficit_only':
      budgets = [
        { name: 'Logement', estimated_amount: 800, spent_amount: 950, current_savings: 0 },
        { name: 'Voiture', estimated_amount: 200, spent_amount: 380, current_savings: 0 },
        { name: 'Santé', estimated_amount: 100, spent_amount: 135, current_savings: 0 }
      ]
      testData.expectedRemainingToLive = 3500 - 1100 // 2400
      testData.expectedDeficit = (950-800) + (380-200) + (135-100) // 150 + 180 + 35 = 365
      break

    case 'mixed_scenario':
      budgets = [
        // Budgets excédentaires
        { name: 'Courses', estimated_amount: 400, spent_amount: 320, current_savings: 0 },
        { name: 'Transport', estimated_amount: 200, spent_amount: 150, current_savings: 0 },
        { name: 'Épargne', estimated_amount: 500, spent_amount: 80, current_savings: 0 },
        // Budgets déficitaires
        { name: 'Logement', estimated_amount: 800, spent_amount: 950, current_savings: 0 },
        { name: 'Voiture', estimated_amount: 200, spent_amount: 380, current_savings: 0 }
      ]
      testData.expectedRemainingToLive = 3500 - 2100 // 1400
      testData.expectedSurplus = (400-320) + (200-150) + (500-80) // 80 + 50 + 420 = 550
      testData.expectedDeficit = (950-800) + (380-200) // 150 + 180 = 330
      break

    case 'with_savings':
      budgets = [
        { name: 'Courses', estimated_amount: 400, spent_amount: 320, current_savings: 100 },
        { name: 'Transport', estimated_amount: 200, spent_amount: 150, current_savings: 75 },
        { name: 'Loisirs', estimated_amount: 300, spent_amount: 280, current_savings: 50 },
        { name: 'Logement', estimated_amount: 800, spent_amount: 950, current_savings: 0 }
      ]
      testData.expectedRemainingToLive = 3500 - 1700 + 225 // 2025 (+225 économies)
      testData.expectedSurplus = (400-320) + (200-150) + (300-280) // 80 + 50 + 20 = 150
      testData.expectedDeficit = (950-800) // 150
      testData.expectedSavings = 100 + 75 + 50 // 225
      break

    case 'negative_remaining':
      budgets = [
        // Budgets qui créent un reste à vivre négatif
        { name: 'Courses', estimated_amount: 400, spent_amount: 320, current_savings: 50 },
        { name: 'Transport', estimated_amount: 200, spent_amount: 150, current_savings: 30 },
        { name: 'Épargne', estimated_amount: 500, spent_amount: 80, current_savings: 100 },
        { name: 'Logement', estimated_amount: 1000, spent_amount: 1000, current_savings: 0 },
        { name: 'Voiture', estimated_amount: 300, spent_amount: 300, current_savings: 0 },
        { name: 'Luxe', estimated_amount: 2000, spent_amount: 2000, current_savings: 0 }, // Force déficit
      ]
      testData.expectedRemainingToLive = 3500 - 4400 + 180 // -720 (Reste à vivre négatif)
      testData.expectedSurplus = (400-320) + (200-150) + (500-80) // 80 + 50 + 420 = 550
      testData.expectedSavings = 50 + 30 + 100 // 180
      break

    default:
      throw new Error(`Scénario "${scenario}" non reconnu`)
  }

  // Créer les budgets en base
  for (const budget of budgets) {
    const { data, error } = await supabaseServer
      .from('estimated_budgets')
      .insert({
        profile_id: userId,
        name: budget.name,
        estimated_amount: budget.estimated_amount,
        current_savings: budget.current_savings
      })
      .select()
      .single()

    if (error) {
      console.error(`❌ [Test Balance] Erreur création budget ${budget.name}:`, error)
      continue
    }

    // Créer les dépenses réelles pour ce budget
    if (budget.spent_amount > 0) {
      const { error: expenseError } = await supabaseServer
        .from('real_expenses')
        .insert({
          profile_id: userId,
          estimated_budget_id: data.id,
          amount: budget.spent_amount,
          description: `Dépenses test pour ${budget.name}`,
          expense_date: new Date().toISOString().split('T')[0]
        })

      if (expenseError) {
        console.error(`❌ [Test Balance] Erreur création dépense ${budget.name}:`, expenseError)
      }
    }

    testData.budgets.push({
      ...budget,
      id: data.id
    })
  }

  console.log(`✅ [Test Balance] Scénario "${scenario}" créé:`, {
    budgets: testData.budgets.length,
    expectedRemainingToLive: testData.expectedRemainingToLive,
    expectedSurplus: testData.expectedSurplus,
    expectedDeficit: testData.expectedDeficit,
    expectedSavings: testData.expectedSavings
  })

  return testData
}

/**
 * Teste l'équilibrage automatique
 */
async function testBalance(userId: string) {
  console.log(`⚖️ [Test Balance] Test de l'équilibrage automatique`)

  try {
    // 1. Initialiser le monthly recap
    const initResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/monthly-recap/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: 'profile' })
    })

    if (!initResponse.ok) {
      throw new Error(`Erreur initialisation: ${initResponse.statusText}`)
    }

    const initData = await initResponse.json()
    console.log(`📊 [Test Balance] État initial:`, {
      remainingToLive: initData.current_remaining_to_live,
      totalSurplus: initData.total_surplus,
      totalDeficit: initData.total_deficit
    })

    // 2. Tester l'équilibrage si reste à vivre négatif
    if (initData.current_remaining_to_live < 0) {
      console.log(`🔄 [Test Balance] Équilibrage nécessaire...`)

      const balanceResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/monthly-recap/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: 'profile',
          snapshot_id: initData.snapshot_id
        })
      })

      if (!balanceResponse.ok) {
        throw new Error(`Erreur équilibrage: ${balanceResponse.statusText}`)
      }

      const balanceData = await balanceResponse.json()
      console.log(`✅ [Test Balance] Équilibrage terminé:`, {
        original: balanceData.original_remaining_to_live,
        final: balanceData.final_remaining_to_live,
        redistributed: balanceData.deficit_covered
      })

      return {
        initialState: initData,
        balanceApplied: true,
        balanceResult: balanceData
      }
    } else {
      console.log(`ℹ️ [Test Balance] Aucun équilibrage nécessaire (reste à vivre positif)`)
      return {
        initialState: initData,
        balanceApplied: false,
        balanceResult: null
      }
    }

  } catch (error) {
    console.error(`❌ [Test Balance] Erreur lors du test:`, error)
    throw error
  }
}

/**
 * Vérifie que les résultats correspondent aux attentes
 */
async function verifyResults(userId: string, testData: any, balanceResult: any) {
  console.log(`🔍 [Test Balance] Vérification des résultats`)

  const verification = {
    scenario: testData.scenario,
    tests: [],
    success: true,
    summary: ''
  }

  // Test 1: Vérifier l'état initial
  const initialState = balanceResult.initialState

  verification.tests.push({
    name: 'État initial - Reste à vivre',
    expected: testData.expectedRemainingToLive,
    actual: initialState.current_remaining_to_live,
    passed: Math.abs(initialState.current_remaining_to_live - testData.expectedRemainingToLive) < 0.01
  })

  verification.tests.push({
    name: 'État initial - Total surplus',
    expected: testData.expectedSurplus,
    actual: initialState.total_surplus,
    passed: Math.abs(initialState.total_surplus - testData.expectedSurplus) < 0.01
  })

  if (testData.expectedDeficit > 0) {
    verification.tests.push({
      name: 'État initial - Total déficit',
      expected: testData.expectedDeficit,
      actual: initialState.total_deficit,
      passed: Math.abs(initialState.total_deficit - testData.expectedDeficit) < 0.01
    })
  }

  // Test 2: Si équilibrage appliqué, vérifier les résultats
  if (balanceResult.balanceApplied && balanceResult.balanceResult) {
    const balanceData = balanceResult.balanceResult

    // Le reste à vivre final devrait être original + redistribué
    const expectedFinal = balanceData.original_remaining_to_live + balanceData.deficit_covered

    verification.tests.push({
      name: 'Équilibrage - Reste à vivre final',
      expected: expectedFinal,
      actual: balanceData.final_remaining_to_live,
      passed: Math.abs(balanceData.final_remaining_to_live - expectedFinal) < 0.01
    })

    verification.tests.push({
      name: 'Équilibrage - Montant redistribué cohérent',
      expected: 'Positif et <= surplus disponible',
      actual: balanceData.deficit_covered,
      passed: balanceData.deficit_covered > 0 && balanceData.deficit_covered <= initialState.total_surplus
    })
  }

  // Calculer le résultat global
  verification.success = verification.tests.every(test => test.passed)
  verification.summary = verification.success
    ? `✅ Tous les tests réussis (${verification.tests.length}/${verification.tests.length})`
    : `❌ Échecs: ${verification.tests.filter(t => !t.passed).length}/${verification.tests.length}`

  console.log(`🎯 [Test Balance] Résultat: ${verification.summary}`)
  verification.tests.forEach(test => {
    const status = test.passed ? '✅' : '❌'
    console.log(`  ${status} ${test.name}: ${test.expected} vs ${test.actual}`)
  })

  return verification
}

/**
 * API GET pour lister les scénarios disponibles
 */
export async function GET() {
  return NextResponse.json({
    scenarios: [
      {
        name: 'surplus_only',
        description: 'Budgets avec surplus uniquement',
        expectedBehavior: 'Pas d\'équilibrage nécessaire'
      },
      {
        name: 'deficit_only',
        description: 'Budgets déficitaires uniquement',
        expectedBehavior: 'Pas d\'équilibrage possible'
      },
      {
        name: 'mixed_scenario',
        description: 'Mix de budgets excédentaires et déficitaires',
        expectedBehavior: 'Équilibrage partiel possible'
      },
      {
        name: 'with_savings',
        description: 'Budgets avec économies accumulées',
        expectedBehavior: 'Équilibrage avec économies en priorité'
      },
      {
        name: 'negative_remaining',
        description: 'Reste à vivre négatif avec excédents disponibles',
        expectedBehavior: 'Équilibrage automatique attendu'
      }
    ]
  })
}