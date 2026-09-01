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
 * Sprint Perf-Parallel-Financial-Data (2026-09-01) — le calcul est scindé
 * en deux :
 *
 *   - `computeIncomeCompensation(...)` : pur, aucune I/O. C'est la logique
 *     métier réelle.
 *   - `calculateIncomeCompensation(filter)` : wrapper async historique qui
 *     fetche puis délègue. Conservé pour les appelants externes (exporté
 *     depuis lib/finance/index.ts).
 *
 * `_loadFinancialData` charge déjà `estimated_incomes` et
 * `real_income_entries` pour ses propres besoins : il appelle donc la
 * version pure. Avant ce sprint il passait par le wrapper, ce qui re-jouait
 * les deux mêmes SELECT — 2 allers-retours réseau de pur doublon, en série
 * qui plus est (le wrapper était `await`é après les 8 autres lectures).
 *
 * Comportement fail-soft du wrapper : sur erreur DB, retourne 0 (préserve le
 * comportement original — l'appelant calcule encore le reste à vivre,
 * juste sans la contribution revenus). Migré console.error → logger.error
 * au passage (Lot 2 §6 règle d'or — outer catch + return default fail-soft
 * boundary, mérite trace si récurrent).
 */

import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import { resolveContextIds, type ContextFilter } from './context'

/** Sous-ensemble de `estimated_incomes` nécessaire au calcul. */
export interface IncomeCompensationEstimatedRow {
  id: string
  estimated_amount: number
}

/**
 * Sous-ensemble de `real_income_entries` nécessaire au calcul.
 *
 * Les lignes dont `estimated_income_id` est NULL (exceptionnelles, salaire
 * auto, miroir de contribution) sont inoffensives : elles ne peuvent matcher
 * aucun `estimatedIncome.id`, donc les passer ou les filtrer en amont donne
 * le même résultat. C'est ce qui permet à `_loadFinancialData` de réutiliser
 * tel quel le jeu de lignes qu'il a déjà chargé.
 */
export interface IncomeCompensationRealRow {
  amount: number
  estimated_income_id: string | null
}

/**
 * Cœur pur du calcul : pour chaque revenu estimé, ajoute soit l'estimé (si
 * aucun réel ne lui est rattaché) soit le cumul réel (si au moins un l'est).
 *
 * Les appelants DOIVENT avoir exclu les carry-overs (`carried_from_recap_id
 * IS NULL`) de `realIncomes` — cf. Sprint 15 V3 + Part 35 : une transaction
 * issue d'un recap antérieur appartient au mois d'origine, déjà comptée dans
 * son RAV. Les deux appelants actuels le font.
 */
export function computeIncomeCompensation(
  estimatedIncomes: readonly IncomeCompensationEstimatedRow[] | null | undefined,
  realIncomes: readonly IncomeCompensationRealRow[] | null | undefined,
): number {
  if (!estimatedIncomes || estimatedIncomes.length === 0) return 0

  const realIncomesData = realIncomes ?? []

  let totalContribution = 0
  for (const estimatedIncome of estimatedIncomes) {
    const realAmountForThisIncome = realIncomesData
      .filter((real) => real.estimated_income_id === estimatedIncome.id)
      .reduce((sum, real) => sum + real.amount, 0)

    totalContribution +=
      realAmountForThisIncome === 0 ? estimatedIncome.estimated_amount : realAmountForThisIncome
  }

  return totalContribution
}

/**
 * Variante auto-suffisante : fetche les deux tables puis délègue à
 * `computeIncomeCompensation`. Réservée aux appelants qui n'ont pas déjà les
 * lignes en main — `_loadFinancialData` utilise la version pure.
 */
export async function calculateIncomeCompensation(filter: ContextFilter): Promise<number> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const ownerColumn = profile_id ? 'profile_id' : 'group_id'
  const ownerId = profile_id ?? group_id ?? ''

  try {
    // Les deux lectures sont indépendantes → parallèle (même motivation que
    // la phase 1 de `_loadFinancialData`).
    const [{ data: estimatedIncomes }, { data: realIncomes }] = await Promise.all([
      supabaseServer
        .from('estimated_incomes')
        .select('id, estimated_amount')
        .eq(ownerColumn, ownerId),
      // Sprint 15 V3 + Part 35 — exclure toute transaction provenant d'un recap
      // antérieur (états A & B). Une carry-over validée ne doit pas modifier
      // le RAV du mois courant, seul le solde est impacté.
      supabaseServer
        .from('real_income_entries')
        .select('amount, estimated_income_id')
        .eq(ownerColumn, ownerId)
        .is('carried_from_recap_id', null)
        .not('estimated_income_id', 'is', null),
    ])

    return computeIncomeCompensation(estimatedIncomes, realIncomes)
  } catch (error) {
    logger.error('Erreur lors du calcul de compensation revenus', { ownerColumn, ownerId, error })
    return 0
  }
}
