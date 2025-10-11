import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { getProfileFinancialData, getGroupFinancialData, getRavFromDatabase, type FinancialData } from '@/lib/financial-calculations'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API Dashboard Financier
 * Returns financial data for the authenticated user
 * - RAV is retrieved from database (persisted value)
 * - Other metrics are calculated in real-time
 * - Supports both profile and group contexts
 * - Query param 'recalculate=true' forces full recalculation and saves to DB
 */

export async function GET(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId

    if (!userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Récupérer les paramètres depuis l'URL
    const { searchParams } = new URL(request.url)
    const forceContext = searchParams.get('context') as 'profile' | 'group' | null
    const shouldRecalculate = searchParams.get('recalculate') === 'true'

    // Récupérer les informations du profil pour savoir si l'utilisateur fait partie d'un groupe
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      console.error('❌ Erreur récupération profil:', profileError)
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }

    // Déterminer le contexte à utiliser
    let context: 'profile' | 'group'
    let contextId: string

    if (forceContext === 'group' && profile.group_id) {
      // Contexte groupe demandé et utilisateur fait partie d'un groupe
      context = 'group'
      contextId = profile.group_id
    } else {
      // Contexte profil par défaut
      context = 'profile'
      contextId = profile.id
    }

    console.log('🎯 Contexte déterminé:', { forceContext, context, contextId, hasGroup: !!profile.group_id, shouldRecalculate })

    let financialData: FinancialData

    // If recalculate is requested, do a full calculation (which will also save to DB)
    if (shouldRecalculate) {
      console.log(`🔄 [DASHBOARD] Recalculating financial data for ${context}:${contextId}`)

      if (context === 'group') {
        financialData = await getGroupFinancialData(profile.group_id!)
      } else {
        financialData = await getProfileFinancialData(profile.id)
      }

      console.log(`✅ [DASHBOARD] Recalculation complete - RAV: ${financialData.remainingToLive}€`)
    } else {
      // Default behavior: retrieve RAV from database, calculate other metrics in real-time
      console.log(`📊 [DASHBOARD] Retrieving RAV from database for ${context}:${contextId}`)

      // Get the persisted RAV from database
      const persistedRav = await getRavFromDatabase(
        context === 'profile' ? contextId : null,
        context === 'group' ? contextId : null
      )

      console.log(`📖 [DASHBOARD] RAV retrieved from DB: ${persistedRav}€`)

      // Calculate other metrics in real-time (without recalculating RAV)
      if (context === 'group') {
        financialData = await getGroupFinancialData(profile.group_id!)
      } else {
        financialData = await getProfileFinancialData(profile.id)
      }

      // Override the calculated RAV with the persisted one from DB
      financialData.remainingToLive = persistedRav

      console.log(`✅ [DASHBOARD] Financial data retrieved - RAV from DB: ${persistedRav}€`)
    }

    console.log(``)
    console.log(`🏠🏠🏠 ========================================================`)
    console.log(`🏠🏠🏠 DASHBOARD - CHARGEMENT DONNÉES FINANCIÈRES`)
    console.log(`🏠🏠🏠 ========================================================`)
    console.log(`🏠 CONTEXTE: ${context.toUpperCase()}`)
    console.log(`🏠 ID: ${contextId}`)
    console.log(`🏠 TIMESTAMP: ${new Date().toISOString()}`)
    console.log(`🏠 RECALCULATE: ${shouldRecalculate}`)
    console.log(``)
    console.log(`💰 RESTE À VIVRE (RAV): ${financialData.remainingToLive}€`)
    console.log(``)
    console.log(`📊 DÉTAILS FINANCIERS COMPLETS:`)
    console.log(`   - Solde bancaire: ${financialData.bankBalance}€`)
    console.log(`   - Revenus estimés: ${financialData.totalEstimatedIncome}€`)
    console.log(`   - Revenus réels: ${financialData.totalRealIncome}€`)
    console.log(`   - Budgets estimés: ${financialData.totalEstimatedBudget}€`)
    console.log(`   - Dépenses réelles: ${financialData.totalRealExpenses}€`)
    console.log(`   - Solde disponible: ${financialData.availableBalance}€`)
    console.log(`   - Total économies: ${financialData.totalSavings}€`)
    console.log(`🏠🏠🏠 ========================================================`)
    console.log(``)

    return NextResponse.json({
      data: financialData,
      context,
      timestamp: Date.now()
    })

  } catch (error) {
    console.error('❌ Erreur dans GET /api/financial/dashboard:', error)

    // En cas d'erreur, retourner des données par défaut pour éviter de casser l'UI
    return NextResponse.json({
      data: {
        availableBalance: 0,
        remainingToLive: 0,
        totalSavings: 0,
        totalEstimatedIncome: 0,
        totalEstimatedBudgets: 0,
        totalRealIncome: 0,
        totalRealExpenses: 0
      },
      context: 'profile',
      timestamp: Date.now(),
      error: 'Données par défaut - erreur de calcul'
    }, { status: 200 }) // 200 pour éviter de casser l'UI
  }
}