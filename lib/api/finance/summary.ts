import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  getProfileFinancialData,
  getGroupFinancialData,
  getRavFromDatabase,
  type FinancialData,
} from '@/lib/financial-calculations'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'

/**
 * API Dashboard Financier
 * Returns financial data for the authenticated user
 * - RAV is retrieved from database (persisted value)
 * - Other metrics are calculated in real-time
 * - Supports both profile and group contexts
 * - Query param 'recalculate=true' forces full recalculation and saves to DB
 */

export const GET = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    // Récupérer les paramètres depuis l'URL
    const { searchParams } = new URL(request.url)
    const forceContext = searchParams.get('context') as 'profile' | 'group' | null
    const shouldRecalculate = searchParams.get('recalculate') === 'true'

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
      contextId = userId
    }

    let financialData: FinancialData

    // If recalculate is requested, do a full calculation (which will also save to DB)
    if (shouldRecalculate) {
      if (context === 'group') {
        financialData = await getGroupFinancialData(profile.group_id!)
      } else {
        financialData = await getProfileFinancialData(userId)
      }
    } else {
      // Default behavior: retrieve RAV from database, calculate other metrics in real-time
      // Get the persisted RAV from database
      const persistedRav = await getRavFromDatabase(
        context === 'profile' ? contextId : null,
        context === 'group' ? contextId : null,
      )

      // Calculate other metrics in real-time (without recalculating RAV)
      if (context === 'group') {
        financialData = await getGroupFinancialData(profile.group_id!)
      } else {
        financialData = await getProfileFinancialData(userId)
      }

      // Override the calculated RAV with the persisted one from DB
      financialData.remainingToLive = persistedRav
    }

    return NextResponse.json({
      data: financialData,
      context,
      timestamp: Date.now(),
    })
  } catch (error) {
    logger.warn('Erreur dans GET /api/finance/summary — fallback sur données par défaut:', error)

    // En cas d'erreur, retourner des données par défaut pour éviter de casser l'UI
    return NextResponse.json(
      {
        data: {
          availableBalance: 0,
          remainingToLive: 0,
          totalSavings: 0,
          totalEstimatedIncome: 0,
          totalEstimatedBudgets: 0,
          totalRealIncome: 0,
          totalRealExpenses: 0,
        },
        context: 'profile',
        timestamp: Date.now(),
        error: 'Données par défaut - erreur de calcul',
      },
      { status: 200 },
    ) // 200 pour éviter de casser l'UI
  }
})
