import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'
import { getProfileFinancialData, getGroupFinancialData } from '@/lib/financial-calculations'

/**
 * API POST /api/monthly-recap/initialize
 *
 * Initialise un nouveau récapitulatif mensuel:
 * 1. Crée un snapshot de sécurité des données actuelles
 * 2. Calcule les économies/déficits des budgets
 * 3. Retourne les données nécessaires pour l'étape 1
 *
 * Body: { context: 'profile' | 'group' }
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

    const body = await request.json()
    const { context = 'profile' } = body

    // Validation du contexte
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    const userId = sessionData.userId
    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1
    const currentYear = currentDate.getFullYear()

    // Récupérer le profil utilisateur
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id, first_name, last_name')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profil utilisateur non trouvé' },
        { status: 404 }
      )
    }

    let contextId: string
    let financialData: any

    if (context === 'profile') {
      contextId = profile.id
      financialData = await getProfileFinancialData(profile.id)
    } else {
      if (!profile.group_id) {
        return NextResponse.json(
          { error: 'Utilisateur ne fait partie d\'aucun groupe' },
          { status: 400 }
        )
      }
      contextId = profile.group_id
      financialData = await getGroupFinancialData(profile.group_id)
    }

    // Vérifier s'il n'y a pas déjà un récap pour ce mois
    const ownerField = context === 'profile' ? 'profile_id' : 'group_id'
    const { data: existingRecaps, error: recapCheckError } = await supabaseServer
      .from('monthly_recaps')
      .select('id')
      .eq(ownerField, contextId)
      .eq('recap_month', currentMonth)
      .eq('recap_year', currentYear)
      .limit(1)

    if (recapCheckError && recapCheckError.code !== 'PGRST116') {
      console.error('❌ Erreur lors de la vérification des récaps existants:', recapCheckError)
      return NextResponse.json(
        { error: 'Erreur lors de la vérification des récaps existants' },
        { status: 500 }
      )
    }

    if (existingRecaps && existingRecaps.length > 0) {
      return NextResponse.json(
        { error: 'Un récapitulatif existe déjà pour ce mois' },
        { status: 409 }
      )
    }

    // 1. Créer le snapshot de sécurité
    console.log(`📸 [Monthly Recap] Création du snapshot de sécurité pour ${context}:${contextId}`)

    // Récupérer toutes les données actuelles pour le snapshot
    const snapshotData: any = {
      context,
      timestamp: new Date().toISOString(),
      financial_data: financialData
    }

    if (context === 'profile') {
      // Récupérer toutes les données du profil
      const [incomes, budgets, realIncomes, realExpenses, bankBalance] = await Promise.all([
        supabaseServer.from('estimated_incomes').select('*').eq('profile_id', contextId),
        supabaseServer.from('estimated_budgets').select('*').eq('profile_id', contextId),
        supabaseServer.from('real_income_entries').select('*').eq('profile_id', contextId),
        supabaseServer.from('real_expenses').select('*').eq('profile_id', contextId),
        supabaseServer.from('bank_balances').select('balance').eq('profile_id', contextId).single()
      ])

      snapshotData.estimated_incomes = incomes.data
      snapshotData.estimated_budgets = budgets.data
      snapshotData.real_income_entries = realIncomes.data
      snapshotData.real_expenses = realExpenses.data
      snapshotData.bank_balance = bankBalance.data?.balance || 0

    } else {
      // Récupérer toutes les données du groupe
      const [incomes, budgets, realIncomes, realExpenses, bankBalance] = await Promise.all([
        supabaseServer.from('estimated_incomes').select('*').eq('group_id', contextId),
        supabaseServer.from('estimated_budgets').select('*').eq('group_id', contextId),
        supabaseServer.from('real_income_entries').select('*').eq('group_id', contextId),
        supabaseServer.from('real_expenses').select('*').eq('group_id', contextId),
        supabaseServer.from('bank_balances').select('balance').eq('group_id', contextId).single()
      ])

      snapshotData.estimated_incomes = incomes.data
      snapshotData.estimated_budgets = budgets.data
      snapshotData.real_income_entries = realIncomes.data
      snapshotData.real_expenses = realExpenses.data
      snapshotData.bank_balance = bankBalance.data?.balance || 0
    }

    // Insérer le snapshot en base
    const snapshotRecord: any = {
      snapshot_month: currentMonth,
      snapshot_year: currentYear,
      snapshot_data: snapshotData,
      is_active: true
    }

    if (context === 'profile') {
      snapshotRecord.profile_id = contextId
    } else {
      snapshotRecord.group_id = contextId
    }

    const { data: snapshot, error: snapshotError } = await supabaseServer
      .from('recap_snapshots')
      .insert(snapshotRecord)
      .select('id')
      .single()

    if (snapshotError) {
      console.error('❌ Erreur lors de la création du snapshot:', snapshotError)
      return NextResponse.json(
        { error: 'Erreur lors de la sauvegarde du snapshot' },
        { status: 500 }
      )
    }

    // 2. Calculer les économies/déficits des budgets pour ce mois
    const budgetStats = []

    if (snapshotData.estimated_budgets && snapshotData.real_expenses) {
      for (const budget of snapshotData.estimated_budgets) {
        // Calculer le montant dépensé pour ce budget ce mois
        const spentThisMonth = snapshotData.real_expenses
          .filter((expense: any) => expense.estimated_budget_id === budget.id)
          .reduce((sum: number, expense: any) => sum + parseFloat(expense.amount), 0)

        const estimated = parseFloat(budget.estimated_amount)

        // SIMPLIFIÉ: Calcul simple sans carryover
        const difference = estimated - spentThisMonth

        console.log(`🔍 [Initialize Debug] Budget "${budget.name}":`)
        console.log(`  - spentThisMonth: ${spentThisMonth}€`)
        console.log(`  - estimated: ${budget.estimated_amount}€`)
        console.log(`  - difference: ${estimated} - ${spentThisMonth} = ${difference}€`)
        console.log(`  - surplus: ${Math.max(0, difference)}€`)

        const budgetStat = {
          id: budget.id,
          name: budget.name,
          estimated_amount: estimated,
          spent_amount: spentThisMonth,
          carryover_spent_amount: 0, // Plus utilisé
          total_spent_amount: spentThisMonth,
          difference, // Positif = économie, Négatif = déficit
          surplus: Math.max(0, difference), // Économies (budget - dépenses)
          deficit: Math.max(0, -difference) // Déficit (dépenses - budget)
        }

        budgetStats.push(budgetStat)
      }
    }

    // Calculer les totaux généraux
    const totalSurplus = budgetStats.reduce((sum, budget) => sum + budget.surplus, 0)
    const totalDeficit = budgetStats.reduce((sum, budget) => sum + budget.deficit, 0)
    const generalRatio = totalSurplus - totalDeficit

    console.log(`📊 [Monthly Recap] Données calculées pour ${context}:${contextId}`)
    console.log(`📊 [Monthly Recap] Reste à vivre actuel: ${financialData.remainingToLive}€`)
    console.log(`📊 [Monthly Recap] Surplus total: ${totalSurplus}€, Déficit total: ${totalDeficit}€`)

    // Retourner les données pour l'étape 1
    return NextResponse.json({
      success: true,
      snapshot_id: snapshot.id,
      current_remaining_to_live: financialData.remainingToLive,
      budget_stats: budgetStats,
      total_surplus: totalSurplus,
      total_deficit: totalDeficit,
      general_ratio: generalRatio,
      context,
      month: currentMonth,
      year: currentYear,
      user_name: `${profile.first_name} ${profile.last_name}`
    })

  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation du récap mensuel:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}