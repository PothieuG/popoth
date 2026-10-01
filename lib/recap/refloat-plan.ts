/**
 * Monthly Recap V3 — plan de renflouement manuel (Sprint Recap-Manual-Refloat,
 * 2026-10-01). Module PUR, importable côté navigateur (aucun accès Supabase) :
 * l'écran `BilanNegativeStep` et les actions serveur (`actions-negative.ts`,
 * route `advance-step`) partagent ainsi exactement les mêmes règles.
 *
 * Le plan décrit, source par source, ce que l'utilisateur a choisi de prendre
 * pour combler le déficit du mois recapé :
 *
 *   - `piggy`    : montant pris dans la tirelire (différé, débité au finalize) ;
 *   - `savings`  : `{ budgetId: montant }` pris dans les économies du budget
 *                  (différé, débité au finalize) ;
 *   - `budgets`  : `{ budgetId: montant }` retiré du budget du mois suivant
 *                  (= `budget_snapshot_data`, appliqué au finalize en
 *                  `carryover_spent_amount`) ;
 *   - `projects` : `{ projectId: montant }` retiré de la mensualité du projet
 *                  (= `project_snapshot_data`, appliqué au finalize).
 *
 * Pour un budget, l'utilisateur choisit UN montant ; on le prend d'abord dans
 * les économies, puis dans le budget du mois suivant (`splitBudgetRefloat`).
 * La limite d'un budget est donc `économies + montant du budget`.
 *
 * `legacyPiggy` / `legacySavings` = argent DÉJÀ débité par l'ancienne cascade
 * automatique (récaps ouverts avant ce sprint). Ils restent soustraits du
 * déficit mais ne sont plus modifiables.
 */

import type { Database } from '@/lib/database.types'

import { distributeProportional } from './calculations'
import { coerceSnapshot, computeDeficitRemaining, sumSnapshotValues } from './deficit-math'

/** Tolérance d'arrondi au centime (mêmes 0,01 € que le reste du récap). */
export const REFLOAT_EPSILON = 0.01

export type RefloatSource = 'piggy' | 'budgets' | 'projects'

export interface RefloatPlan {
  legacyPiggy: number
  legacySavings: number
  piggy: number
  savings: Record<string, number>
  budgets: Record<string, number>
  projects: Record<string, number>
}

export const EMPTY_REFLOAT_PLAN: RefloatPlan = {
  legacyPiggy: 0,
  legacySavings: 0,
  piggy: 0,
  savings: {},
  budgets: {},
  projects: {},
}

type MonthlyRecapPlanColumns = Pick<
  Database['public']['Tables']['monthly_recaps']['Row'],
  | 'refloated_from_piggy'
  | 'refloated_from_savings'
  | 'planned_piggy_refloat'
  | 'planned_savings_refloat'
  | 'budget_snapshot_data'
  | 'project_snapshot_data'
>

/** Lit le plan depuis la ligne `monthly_recaps` (côté serveur). */
export function planFromRecapRow(row: MonthlyRecapPlanColumns): RefloatPlan {
  return {
    legacyPiggy: Number(row.refloated_from_piggy ?? 0),
    legacySavings: Number(row.refloated_from_savings ?? 0),
    piggy: Number(row.planned_piggy_refloat ?? 0),
    savings: coerceSnapshot(row.planned_savings_refloat) ?? {},
    budgets: coerceSnapshot(row.budget_snapshot_data) ?? {},
    projects: coerceSnapshot(row.project_snapshot_data) ?? {},
  }
}

/** Lit le plan depuis le `recap` exposé par GET /status (côté navigateur). */
export function planFromProgress(progress: {
  refloatedFromPiggy: number
  refloatedFromSavings: number
  plannedPiggyRefloat?: number | null
  plannedSavingsRefloat?: Record<string, number> | null
  snapshotData: Record<string, number> | null
  projectSnapshotData: Record<string, number> | null
}): RefloatPlan {
  return {
    legacyPiggy: progress.refloatedFromPiggy,
    legacySavings: progress.refloatedFromSavings,
    piggy: progress.plannedPiggyRefloat ?? 0,
    savings: progress.plannedSavingsRefloat ?? {},
    budgets: progress.snapshotData ?? {},
    projects: progress.projectSnapshotData ?? {},
  }
}

/** Reste à renflouer une fois le plan appliqué. 0 si le bilan n'est pas
 *  négatif. Peut être négatif de quelques centimes (arrondis) — les appelants
 *  comparent à `REFLOAT_EPSILON`. */
export function deficitRemainingForPlan(bilan: number, plan: RefloatPlan): number {
  return computeDeficitRemaining({
    initialBilan: bilan,
    refloatedFromPiggy: plan.legacyPiggy,
    refloatedFromSavings: plan.legacySavings,
    snapshotData: plan.budgets,
    projectSnapshotData: plan.projects,
    plannedPiggy: plan.piggy,
    plannedSavingsData: plan.savings,
  })
}

/** Le même plan, avec la source donnée remise à zéro. Sert à calculer ce
 *  qu'une source peut encore couvrir sans compter sa propre valeur actuelle
 *  (ré-enregistrer une source REMPLACE son ancienne valeur). */
export function planWithoutSource(plan: RefloatPlan, source: RefloatSource): RefloatPlan {
  switch (source) {
    case 'piggy':
      return { ...plan, piggy: 0 }
    case 'budgets':
      return { ...plan, savings: {}, budgets: {} }
    case 'projects':
      return { ...plan, projects: {} }
  }
}

/** Montant total pris dans un budget = part économies + part budget. */
export function budgetTotalsFromPlan(plan: RefloatPlan): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, v] of Object.entries(plan.savings)) out[id] = round2((out[id] ?? 0) + v)
  for (const [id, v] of Object.entries(plan.budgets)) out[id] = round2((out[id] ?? 0) + v)
  return out
}

/** Limite d'un budget : ses économies + son montant (le budget du mois
 *  suivant peut être entièrement amputé, pas au-delà). */
export function budgetRefloatCapacity(budget: {
  cumulatedSavings: number
  estimatedAmount: number
}): number {
  return round2(Math.max(0, budget.cumulatedSavings) + Math.max(0, budget.estimatedAmount))
}

/** Découpe le montant pris dans un budget : économies d'abord, puis budget
 *  du mois suivant. Ex. économies 30 €, montant 50 € → 30 € + 20 €. */
export function splitBudgetRefloat(
  amount: number,
  savings: number,
): { fromSavings: number; fromBudget: number } {
  const safeAmount = Math.max(0, round2(amount))
  const fromSavings = round2(Math.min(safeAmount, Math.max(0, savings)))
  return { fromSavings, fromBudget: round2(safeAmount - fromSavings) }
}

/** Reconstruit le plan « économies / budget » à partir des montants totaux
 *  choisis par budget. Les montants nuls sont omis. */
export function splitBudgetTotals(
  totals: Record<string, number>,
  savingsById: ReadonlyMap<string, number>,
): { savings: Record<string, number>; budgets: Record<string, number> } {
  const savings: Record<string, number> = {}
  const budgets: Record<string, number> = {}
  for (const [id, total] of Object.entries(totals)) {
    if (total <= 0) continue
    const split = splitBudgetRefloat(total, savingsById.get(id) ?? 0)
    if (split.fromSavings > 0) savings[id] = split.fromSavings
    if (split.fromBudget > 0) budgets[id] = split.fromBudget
  }
  return { savings, budgets }
}

export interface BudgetRefloatInput {
  budgetId: string
  cumulatedSavings: number
  estimatedAmount: number
}

/**
 * Bouton « Répartir le reste automatiquement » (section budgets). Ajoute
 * `target` aux montants `current` déjà choisis :
 *
 *   1. d'abord dans les économies encore libres, au prorata de ces économies ;
 *   2. puis, s'il reste quelque chose, dans les budgets du mois suivant encore
 *      libres, au prorata de leur montant.
 *
 * Aucune ligne ne dépasse sa limite. Retourne les nouveaux montants totaux par
 * budget (y compris ceux inchangés). Si tout est déjà plein, le reste n'est
 * simplement pas réparti.
 */
export function autoDistributeBudgets(
  target: number,
  budgets: readonly BudgetRefloatInput[],
  current: Record<string, number>,
): Record<string, number> {
  const next: Record<string, number> = {}
  for (const b of budgets) {
    const value = current[b.budgetId] ?? 0
    if (value > 0) next[b.budgetId] = round2(value)
  }
  let remaining = round2(target)
  if (remaining <= 0) return next

  const savingsRoom = budgets.map((b) => {
    const { fromSavings } = splitBudgetRefloat(next[b.budgetId] ?? 0, b.cumulatedSavings)
    return { budgetId: b.budgetId, pool: round2(Math.max(0, b.cumulatedSavings) - fromSavings) }
  })
  const fromSavings = distributeProportional(remaining, savingsRoom)
  for (const share of fromSavings.perBudget) {
    next[share.budgetId] = round2((next[share.budgetId] ?? 0) + share.amount)
  }
  remaining = round2(remaining - fromSavings.totalAllocated)
  if (remaining <= 0) return next

  const budgetRoom = budgets.map((b) => {
    const { fromBudget } = splitBudgetRefloat(next[b.budgetId] ?? 0, b.cumulatedSavings)
    return { budgetId: b.budgetId, pool: round2(Math.max(0, b.estimatedAmount) - fromBudget) }
  })
  const fromBudgets = distributeProportional(remaining, budgetRoom)
  for (const share of fromBudgets.perBudget) {
    next[share.budgetId] = round2((next[share.budgetId] ?? 0) + share.amount)
  }
  return next
}

export interface RefloatCapacityInput {
  piggyAmount: number
  budgets: ReadonlyArray<{ budgetId: string; cumulatedSavings: number; estimatedAmount: number }>
  projects: ReadonlyArray<{ id: string; monthlyAllocation: number }>
}

/** Ce que les 3 sources peuvent encore donner au-delà du plan actuel. */
export function remainingRefloatCapacity(input: RefloatCapacityInput, plan: RefloatPlan): number {
  const piggyLeft = Math.max(0, input.piggyAmount - plan.piggy)
  const totals = budgetTotalsFromPlan(plan)
  const budgetsLeft = input.budgets.reduce(
    (s, b) => s + Math.max(0, budgetRefloatCapacity(b) - (totals[b.budgetId] ?? 0)),
    0,
  )
  const projectsLeft = input.projects.reduce(
    (s, p) => s + Math.max(0, p.monthlyAllocation - (plan.projects[p.id] ?? 0)),
    0,
  )
  return round2(piggyLeft + budgetsLeft + projectsLeft)
}

/**
 * Règle « obligatoire sauf si épuisé » (décision produit 2026-10-01) : on ne
 * quitte l'écran que si le déficit est couvert, ou si plus aucune source ne
 * peut rien donner. Partagée par le bouton « Continuer » et la route
 * `advance-step` (qui la ré-applique côté serveur).
 */
export function canLeaveDeficitStep(deficitRemaining: number, capacityLeft: number): boolean {
  return deficitRemaining <= REFLOAT_EPSILON || capacityLeft <= REFLOAT_EPSILON
}

/** Somme d'un plan par source — pratique pour l'affichage. */
export function sumPlanSource(plan: RefloatPlan, source: RefloatSource): number {
  switch (source) {
    case 'piggy':
      return round2(plan.piggy)
    case 'budgets':
      return round2(sumSnapshotValues(plan.savings) + sumSnapshotValues(plan.budgets))
    case 'projects':
      return sumSnapshotValues(plan.projects)
  }
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
