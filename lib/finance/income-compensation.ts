/**
 * Calcule la contribution des revenus au reste à vivre, unifié pour
 * profile et group via ContextFilter.
 *
 * Extrait de lib/financial-calculations.ts au chantier I4 — fusionne les
 * deux helpers calculateIncomeCompensationProfile/Group qui étaient à
 * 95% identiques (seul l'eq column key differait : profile_id vs group_id).
 *
 * LOGIQUE MÉTIER:
 * - Revenu estimé NON utilisé (0€ réel) = +revenu estimé au reste à vivre
 * - Revenu estimé utilisé = +montant réellement reçu au reste à vivre
 *
 * Comportement fail-soft : sur erreur DB, retourne 0 (préserve le
 * comportement original — l'appelant calcule encore le reste à vivre,
 * juste sans la contribution revenus). Migré console.error → logger.error
 * au passage (Lot 2 §6 règle d'or — outer catch + return default fail-soft
 * boundary, mérite trace si récurrent).
 */

import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import { resolveContextIds, type ContextFilter } from './context'

export async function calculateIncomeCompensation(filter: ContextFilter): Promise<number> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const ownerColumn = profile_id ? 'profile_id' : 'group_id'
  const ownerId = profile_id ?? group_id ?? ''

  try {
    // 1. Récupérer tous les revenus estimés du context
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('id, estimated_amount')
      .eq(ownerColumn, ownerId)

    if (!estimatedIncomes || estimatedIncomes.length === 0) return 0

    // 2. Récupérer tous les revenus réels liés aux revenus estimés.
    // Sprint 15 V3 — exclure les carry-overs (purement visuels, spec §5.2).
    const { data: realIncomes } = await supabaseServer
      .from('real_income_entries')
      .select('amount, estimated_income_id')
      .eq(ownerColumn, ownerId)
      .eq('is_carried_over', false)
      .not('estimated_income_id', 'is', null)

    const realIncomesData = realIncomes ?? []

    // 3. Pour chaque revenu estimé, ajouter au RAV soit l'estimé (si non
    //    utilisé) soit le réel cumulé (si utilisé)
    let totalContribution = 0
    for (const estimatedIncome of estimatedIncomes) {
      const realAmountForThisIncome = realIncomesData
        .filter((real) => real.estimated_income_id === estimatedIncome.id)
        .reduce((sum, real) => sum + real.amount, 0)

      totalContribution +=
        realAmountForThisIncome === 0 ? estimatedIncome.estimated_amount : realAmountForThisIncome
    }

    return totalContribution
  } catch (error) {
    logger.error('Erreur lors du calcul de compensation revenus', { ownerColumn, ownerId, error })
    return 0
  }
}
