/**
 * Sauvegarde de snapshots Reste-À-Vivre dans `remaining_to_live_snapshots`.
 *
 * Extrait de lib/financial-calculations.ts au chantier I4. Les deux
 * inserters profile/group (~90% identiques) sont fusionnés en
 * `_insertSnapshot(filter, financialData, reason)` privé. La signature
 * publique `saveRemainingToLiveSnapshot({profileId?, groupId?, reason})`
 * est préservée à l'identique pour les 5 callsites dans `lib/api/finance/*`.
 *
 * **Contrat fail-soft (R1)**: la fonction RETOURNE `false` sur échec
 * d'insertion ou validation, JAMAIS de throw. Les 5 callsites comptent
 * sur ce contrat — ils wrappent l'appel dans un `try/catch + logger.warn
 * '⚠️ Échec sauvegarde snapshot (non critique)'` et continuent leur
 * exécution. Tester avec un mock supabase qui error-out — le résultat
 * doit être `false`, pas une exception.
 *
 * Note de cycle import: ce module importe `getProfileFinancialData` et
 * `getGroupFinancialData` depuis `@/lib/financial-calculations`. Le god
 * file ré-exporte `saveRemainingToLiveSnapshot` depuis ce module — cycle
 * value-import value-import. Cycle-safe en ES modules grâce aux live
 * bindings (les usages se font dans des bodies async appelées plus tard,
 * pas au load du module). Disparaît au commit #8 quand get*FinancialData
 * migrent vers `lib/finance/financial-data.ts`.
 */

import { getGroupFinancialData, getProfileFinancialData } from '@/lib/financial-calculations'
import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import type { ContextFilter } from './context'
import type { FinancialData } from './types'

async function _insertSnapshot(
  filter: ContextFilter,
  financialData: FinancialData,
  reason: string,
): Promise<boolean> {
  const ownerCols =
    'profile_id' in filter
      ? { profile_id: filter.profile_id, group_id: null }
      : { profile_id: null, group_id: filter.group_id }
  try {
    const { error } = await supabaseServer.from('remaining_to_live_snapshots').insert({
      ...ownerCols,
      remaining_to_live: financialData.remainingToLive,
      available_balance: financialData.availableBalance,
      total_savings: financialData.totalSavings,
      total_estimated_income: financialData.totalEstimatedIncome,
      total_estimated_budgets: financialData.totalEstimatedBudgets,
      total_real_income: financialData.totalRealIncome,
      total_real_expenses: financialData.totalRealExpenses,
      snapshot_reason: reason,
    })
    if (error) {
      logger.error('Erreur lors de la sauvegarde du snapshot', { ownerCols, reason, error })
      return false
    }
    return true
  } catch (error) {
    logger.error('Exception lors de la sauvegarde du snapshot', { ownerCols, reason, error })
    return false
  }
}

/**
 * Dispatcher : valide les arguments puis route vers l'inserter.
 * Détecte automatiquement profile vs group selon les paramètres.
 *
 * @returns `true` sur succès, `false` sur échec validation ou insertion.
 *          NE THROW JAMAIS (contrat fail-soft R1, voir JSDoc fichier).
 */
export async function saveRemainingToLiveSnapshot(options: {
  profileId?: string
  groupId?: string
  reason: string
}): Promise<boolean> {
  const { profileId, groupId, reason } = options

  if (!profileId && !groupId) {
    logger.error('saveRemainingToLiveSnapshot: profileId ou groupId requis')
    return false
  }
  if (profileId && groupId) {
    logger.error('saveRemainingToLiveSnapshot: profileId et groupId mutuellement exclusifs')
    return false
  }

  try {
    if (profileId) {
      const financialData = await getProfileFinancialData(profileId)
      return await _insertSnapshot({ profile_id: profileId }, financialData, reason)
    }
    if (groupId) {
      const financialData = await getGroupFinancialData(groupId)
      return await _insertSnapshot({ group_id: groupId }, financialData, reason)
    }
    return false
  } catch (error) {
    logger.error('Exception in saveRemainingToLiveSnapshot orchestrator', {
      profileId,
      groupId,
      error,
    })
    return false
  }
}
