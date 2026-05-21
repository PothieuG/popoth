import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getProfileFinancialData, getGroupFinancialData, type FinancialData } from '@/lib/finance'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { parseQuery, handleBadRequest } from '@/lib/api/parse-body'
import { summaryQuerySchema } from '@/lib/schemas/common'
import { logger } from '@/lib/logger'

/**
 * API Dashboard Financier — returns financial data for the authenticated user.
 *
 * Always recomputes RAV via `_loadFinancialData` (which also persists the
 * fresh value to `bank_balances.current_remaining_to_live` as side-effect).
 * The previous "read persisted RAV + override" pattern caused an off-by-one
 * stale cache: the read happened BEFORE the recompute call, so the API
 * returned the value from the previous request. After creating a budgeted
 * expense, the user had to manually refresh to see the deficit propagate.
 *
 * `recalculate` query param is now a no-op (always recalculates); preserved
 * for backward compat with existing callers that may still pass it.
 */

export const GET = withAuthAndProfile(async (request: NextRequest, { userId, profile }) => {
  try {
    const { context: forceContext } = parseQuery(request, summaryQuerySchema)

    // Déterminer le contexte à utiliser
    let context: 'profile' | 'group'

    if (forceContext === 'group' && profile.group_id) {
      context = 'group'
    } else {
      context = 'profile'
    }

    let financialData: FinancialData
    if (context === 'group') {
      financialData = await getGroupFinancialData(profile.group_id!)
    } else {
      financialData = await getProfileFinancialData(userId)
    }

    return NextResponse.json({
      data: financialData,
      context,
      timestamp: Date.now(),
    })
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
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
