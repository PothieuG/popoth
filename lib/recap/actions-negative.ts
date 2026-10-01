/**
 * Monthly Recap V3 — flux négatif (écran « Gestion du déficit »).
 *
 * Refonte Sprint Recap-Manual-Refloat (2026-10-01). L'ancienne cascade
 * automatique et proportionnelle (tirelire → économies → projets → budgets,
 * 4 endpoints, débits immédiats pour la tirelire et les économies) est
 * remplacée par une répartition MANUELLE et DIFFÉRÉE :
 *
 *  - `executePrepareDeficit` : à l'arrivée sur l'écran, verse le surplus de
 *    chaque budget dans ses économies (une seule fois par récap, via la RPC
 *    atomique et idempotente `transfer_recap_surplus_to_savings`). Avant ce
 *    sprint, rien ne transformait le surplus en bilan négatif : il disparaissait
 *    à la clôture du récap.
 *
 *  - `executeSaveRefloatPlan` : enregistre le choix de l'utilisateur pour UNE
 *    source (tirelire, budgets ou projets) en REMPLAÇANT la valeur précédente
 *    de cette source. Rien n'est débité ici : la tirelire et les économies
 *    sont débitées au finalize par `apply_recap_refloat_plan`, la part
 *    « budget du mois suivant » et les projets par les RPCs de snapshot
 *    existantes. Le plan reste donc modifiable jusqu'à la fin du récap.
 *
 * Bornes vérifiées côté serveur (l'UI les applique aussi, mais un client ne
 * doit pas pouvoir les contourner) :
 *   - tirelire ≤ solde de la tirelire ;
 *   - budget  ≤ économies + montant du budget ;
 *   - projet  ≤ mensualité du projet ;
 *   - total de la source ≤ ce qu'il reste à renflouer sans elle.
 *
 * Les helpers purs (`sumSnapshotValues`, `computeDeficitRemaining`) restent
 * ré-exportés ici pour la compatibilité des imports existants.
 */

import type { Database, Json } from '@/lib/database.types'
import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import type { MonthlyRecapRow } from './active-recap'
import type { RecapContext } from './check-status'
import { coerceSnapshot } from './deficit-math'
import { loadRecapSummary } from './load-summary'
import {
  budgetRefloatCapacity,
  deficitRemainingForPlan,
  planFromRecapRow,
  planWithoutSource,
  REFLOAT_EPSILON,
  round2,
  splitBudgetRefloat,
  type RefloatPlan,
} from './refloat-plan'
import type { RecapSummary } from './types'

export { computeDeficitRemaining, sumSnapshotValues } from './deficit-math'
export type { ComputeDeficitArgs } from './deficit-math'

// ---------------------------------------------------------------------------
// Typed business errors (deserialized to HTTP by the routes)
// ---------------------------------------------------------------------------

export class RecapActionError extends Error {
  readonly code: string
  readonly status: number
  readonly extras: Record<string, unknown>

  constructor(code: string, status: number, extras: Record<string, unknown> = {}) {
    super(code)
    this.code = code
    this.status = status
    this.extras = extras
    this.name = 'RecapActionError'
  }
}

// ---------------------------------------------------------------------------
// Trackers lus sur la ligne du récap
// ---------------------------------------------------------------------------

/** Les trackers que `loadRecapSummary` doit connaître pour un récap donné :
 *  surplus déjà envoyés à la tirelire (flux positif) ou versés dans les
 *  économies (flux négatif), et remboursements de projets (aperçu final). */
export function recapSummaryTrackers(recap: MonthlyRecapRow): {
  piggyTransfersData: Record<string, number> | undefined
  surplusSavingsData: Record<string, number> | undefined
  projectSnapshotData: Record<string, number> | undefined
} {
  return {
    piggyTransfersData: coerceSnapshot(recap.piggy_transfers_data) ?? undefined,
    surplusSavingsData: coerceSnapshot(recap.surplus_savings_data) ?? undefined,
    projectSnapshotData: coerceSnapshot(recap.project_snapshot_data) ?? undefined,
  }
}

interface RecapActionBaseArgs {
  context: RecapContext
  profileId: string
  groupId: string | null
  recap: MonthlyRecapRow
}

function loadSummaryFor(
  args: RecapActionBaseArgs,
  overrides: { surplusSavingsData?: Record<string, number> } = {},
): Promise<RecapSummary> {
  const trackers = recapSummaryTrackers(args.recap)
  return loadRecapSummary({
    context: args.context,
    profileId: args.profileId,
    groupId: args.groupId,
    recapMonth: args.recap.recap_month,
    recapYear: args.recap.recap_year,
    piggyTransfersData: trackers.piggyTransfersData,
    surplusSavingsData: overrides.surplusSavingsData ?? trackers.surplusSavingsData,
    projectSnapshotData: trackers.projectSnapshotData,
  })
}

// ---------------------------------------------------------------------------
// executePrepareDeficit
// ---------------------------------------------------------------------------

export interface PrepareDeficitOutcome {
  /** `{ budgetId: montant }` versé dans les économies (vide si aucun surplus). */
  surplusSavingsData: Record<string, number>
  /** `true` si le versement avait déjà eu lieu (appel répété ou concurrent). */
  alreadyDone: boolean
  /** Résumé à jour : économies créditées, surplus retombés à 0. */
  summary: RecapSummary
}

export async function executePrepareDeficit(
  args: RecapActionBaseArgs,
): Promise<PrepareDeficitOutcome> {
  const existing = coerceSnapshot(args.recap.surplus_savings_data)
  if (args.recap.surplus_savings_data !== null && existing) {
    return {
      surplusSavingsData: existing,
      alreadyDone: true,
      summary: await loadSummaryFor(args),
    }
  }

  const summaryBefore = await loadSummaryFor(args)
  if (summaryBefore.bilanSign !== 'negative') {
    throw new RecapActionError('no_deficit', 409)
  }

  const allocations: Record<string, number> = {}
  for (const budget of summaryBefore.budgets) {
    if (budget.surplus > 0) allocations[budget.budgetId] = budget.surplus
  }

  const { data, error } = await supabaseServer.rpc('transfer_recap_surplus_to_savings', {
    p_recap_id: args.recap.id,
    p_allocations: allocations as unknown as Json,
  })
  if (error) {
    logger.error('[recap/negative] prepare-deficit: surplus transfer failed', {
      recapId: args.recap.id,
      error,
    })
    throw error
  }

  const result = parseTransferResult(data)
  return {
    surplusSavingsData: result.applied,
    alreadyDone: result.alreadyDone,
    summary: await loadSummaryFor(args, { surplusSavingsData: result.applied }),
  }
}

function parseTransferResult(data: Json | null): {
  applied: Record<string, number>
  alreadyDone: boolean
} {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { applied: {}, alreadyDone: false }
  }
  return {
    applied: coerceSnapshot(data.applied ?? null) ?? {},
    alreadyDone: data.already_done === true,
  }
}

// ---------------------------------------------------------------------------
// executeSaveRefloatPlan
// ---------------------------------------------------------------------------

export type SaveRefloatPlanInput =
  | { source: 'piggy'; amount: number }
  | { source: 'budgets'; allocations: Record<string, number> }
  | { source: 'projects'; allocations: Record<string, number> }

export interface SaveRefloatPlanOutcome {
  plan: RefloatPlan
  deficitRemaining: number
}

export async function executeSaveRefloatPlan(
  args: RecapActionBaseArgs & { input: SaveRefloatPlanInput },
): Promise<SaveRefloatPlanOutcome> {
  // Le surplus doit avoir été versé dans les économies AVANT tout choix : la
  // limite d'un budget (économies + budget) en dépend.
  if (args.recap.surplus_savings_data === null) {
    throw new RecapActionError('not_prepared', 409)
  }

  const summary = await loadSummaryFor(args)
  if (summary.bilanSign !== 'negative') {
    throw new RecapActionError('no_deficit', 409)
  }

  const plan = planFromRecapRow(args.recap)
  const available = deficitRemainingForPlan(
    summary.bilan,
    planWithoutSource(plan, args.input.source),
  )

  let nextPlan: RefloatPlan
  let update: Database['public']['Tables']['monthly_recaps']['Update']
  let total: number

  switch (args.input.source) {
    case 'piggy': {
      const amount = round2(args.input.amount)
      if (amount > summary.piggyAmount + REFLOAT_EPSILON) {
        throw new RecapActionError('piggy_insufficient', 400, { available: summary.piggyAmount })
      }
      total = amount
      nextPlan = { ...plan, piggy: amount }
      update = { planned_piggy_refloat: amount }
      break
    }
    case 'budgets': {
      const byId = new Map(summary.budgets.map((b) => [b.budgetId, b]))
      const savings: Record<string, number> = {}
      const budgets: Record<string, number> = {}
      total = 0
      for (const [budgetId, raw] of Object.entries(args.input.allocations)) {
        const amount = round2(raw)
        if (amount <= 0) continue
        const budget = byId.get(budgetId)
        if (!budget) throw new RecapActionError('unknown_budget', 400, { budgetId })
        const capacity = budgetRefloatCapacity(budget)
        if (amount > capacity + REFLOAT_EPSILON) {
          throw new RecapActionError('budget_capacity_exceeded', 400, { budgetId, capacity })
        }
        const split = splitBudgetRefloat(Math.min(amount, capacity), budget.cumulatedSavings)
        if (split.fromSavings > 0) savings[budgetId] = split.fromSavings
        if (split.fromBudget > 0) budgets[budgetId] = split.fromBudget
        total += amount
      }
      total = round2(total)
      nextPlan = { ...plan, savings, budgets }
      update = {
        planned_savings_refloat: savings as unknown as Json,
        budget_snapshot_data: budgets as unknown as Json,
      }
      break
    }
    case 'projects': {
      const byId = new Map(summary.savingsProjects.map((p) => [p.id, p]))
      const projects: Record<string, number> = {}
      total = 0
      for (const [projectId, raw] of Object.entries(args.input.allocations)) {
        const amount = round2(raw)
        if (amount <= 0) continue
        const project = byId.get(projectId)
        if (!project) throw new RecapActionError('unknown_project', 400, { projectId })
        if (amount > project.monthlyAllocation + REFLOAT_EPSILON) {
          throw new RecapActionError('project_capacity_exceeded', 400, {
            projectId,
            capacity: project.monthlyAllocation,
          })
        }
        // Plafonné exactement à la mensualité : la RPC du finalize refuse tout
        // remboursement supérieur (même d'un centime d'arrondi).
        projects[projectId] = Math.min(amount, project.monthlyAllocation)
        total += amount
      }
      total = round2(total)
      nextPlan = { ...plan, projects }
      update = { project_snapshot_data: projects as unknown as Json }
      break
    }
  }

  if (total > available + REFLOAT_EPSILON) {
    throw new RecapActionError('overflow', 400, { deficitRemaining: available })
  }

  const { error } = await supabaseServer
    .from('monthly_recaps')
    .update(update)
    .eq('id', args.recap.id)
  if (error) {
    logger.error('[recap/negative] save-refloat-plan: write failed', {
      recapId: args.recap.id,
      source: args.input.source,
      error,
    })
    throw error
  }

  return { plan: nextPlan, deficitRemaining: deficitRemainingForPlan(summary.bilan, nextPlan) }
}
