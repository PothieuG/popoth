/**
 * Pure expense breakdown algorithm — no I/O, no Supabase, no React.
 * Extracted from `lib/expense-allocation.ts` so client-side previews can
 * import it without pulling in the service_role Supabase client (security:
 * bundling supabase-server.ts in the client bundle would leak the
 * service_role key).
 *
 * Two layers:
 *   - `calculateBreakdown` (P4-P5, single-budget) : économies du budget
 *     destination puis le budget lui-même ; ce qui dépasse = `overflow`.
 *   - `calculateBreakdownWithCoverage` : le dépassement est couvert par ce que
 *     l'utilisateur a choisi (tirelire + économies d'autres budgets), le reste
 *     part en déficit du budget destination (donc sur le reste à vivre).
 */

import { ROUNDING_TOLERANCE } from '@/lib/constants/finance'

export interface CrossBudgetDebit {
  budget_id: string
  amount: number
}

export interface AllocationBreakdown {
  fromPiggyBank: number
  fromBudgetSavings: number
  fromBudget: number
  /**
   * Amount remaining after all local cascades (budget + local savings).
   * `overflow > 0` signals Phase 2 cross-budget cascade need (handled
   * separately by the route handler / UI step). Consumers MUST handle
   * non-zero overflow explicitly — leaving it unhandled means the
   * breakdown doesn't sum to `amount`.
   */
  overflow: number
}

export interface AllocationBreakdownWithCascade extends AllocationBreakdown {
  /**
   * Économies d'autres budgets prises pour couvrir le dépassement. Vide si
   * rien n'est couvert. `overflow` vaut alors 0 : le résidu non couvert est
   * absorbé par `fromBudget` (déficit du budget destination).
   */
  crossBudgetDebits: CrossBudgetDebit[]
}

export interface CalculateBreakdownOptions {
  /**
   * P5 opt-in toggle "Utiliser les économies de ce budget" — when true,
   * the user actively chose to draw from the budget's local savings even
   * if the budget still has room. Savings consumed BEFORE the budget.
   *
   * When false (default): P4 strict — budget consumed first, savings
   * cascade only on overflow (budget remaining < amount).
   */
  useSavingsToggle?: boolean
}

export function calculateBreakdown(
  amount: number,
  budgetRemaining: number,
  savingsAvailable: number,
  options: CalculateBreakdownOptions = {},
): AllocationBreakdown {
  const { useSavingsToggle = false } = options
  let remaining = amount
  let fromBudget = 0
  let fromBudgetSavings = 0
  const fromPiggyBank = 0

  if (useSavingsToggle) {
    if (savingsAvailable > 0) {
      fromBudgetSavings = Math.min(remaining, savingsAvailable)
      remaining -= fromBudgetSavings
    }
    if (remaining > 0 && budgetRemaining > 0) {
      fromBudget = Math.min(remaining, budgetRemaining)
      remaining -= fromBudget
    }
  } else {
    if (budgetRemaining > 0) {
      fromBudget = Math.min(remaining, budgetRemaining)
      remaining -= fromBudget
    }
    if (remaining > 0 && savingsAvailable > 0) {
      fromBudgetSavings = Math.min(remaining, savingsAvailable)
      remaining -= fromBudgetSavings
    }
  }

  return { fromPiggyBank, fromBudgetSavings, fromBudget, overflow: remaining }
}

const roundCents = (value: number): number => Math.round(value * 100) / 100

/**
 * Sprint Expense-Overflow-Coverage (2026-10-02) — couverture du dépassement
 * choisie par l'utilisateur dans l'étape « Couvrir le dépassement ».
 * Rien de couvert (`EMPTY_COVERAGE`) = tout le dépassement va sur le reste à
 * vivre, comportement par défaut : aucune réserve n'est prise sans action.
 */
export interface OverflowCoverage {
  piggy: number
  budgets: CrossBudgetDebit[]
}

export const EMPTY_COVERAGE: OverflowCoverage = { piggy: 0, budgets: [] }

/** Réserve mobilisable : économies d'un autre budget que la destination. */
export interface BudgetSavingsSource {
  budget_id: string
  available: number
}

export function coverageTotal(coverage: OverflowCoverage): number {
  return roundCents(coverage.piggy + coverage.budgets.reduce((sum, b) => sum + b.amount, 0))
}

/**
 * Répartit `total` entre des sources au prorata de leur poids, au centime,
 * sans jamais dépasser le poids d'une source (`total` ≤ somme des poids).
 * L'écart d'arrondi est reporté sur la dernière source qui a de la marge.
 */
function distributeProportionally(
  total: number,
  sources: ReadonlyArray<{ id: string; weight: number }>,
): Array<{ id: string; amount: number }> {
  const eligible = sources.filter((s) => s.weight > 0)
  const totalWeight = eligible.reduce((sum, s) => sum + s.weight, 0)
  const toAllocate = roundCents(Math.min(Math.max(0, total), totalWeight))
  if (toAllocate <= 0 || totalWeight <= 0) return []

  const shares = eligible.map((s) => ({
    id: s.id,
    weight: s.weight,
    amount: Math.min(roundCents((s.weight / totalWeight) * toAllocate), s.weight),
  }))

  const drift = roundCents(toAllocate - shares.reduce((sum, s) => sum + s.amount, 0))
  if (drift !== 0) {
    for (let i = shares.length - 1; i >= 0; i--) {
      const entry = shares[i]
      if (!entry) continue
      const headroom = roundCents(entry.weight - entry.amount)
      if (drift > 0 && headroom > 0) {
        entry.amount = roundCents(entry.amount + Math.min(drift, headroom))
        break
      }
      if (drift < 0 && entry.amount > 0) {
        entry.amount = roundCents(entry.amount - Math.min(-drift, entry.amount))
        break
      }
    }
  }

  return shares.filter((s) => s.amount > 0).map(({ id, amount }) => ({ id, amount }))
}

/**
 * Bouton « Répartir automatiquement » : tirelire d'abord, puis économies des
 * autres budgets au prorata de leurs disponibilités. Ce qui ne peut pas être
 * couvert reste sur le reste à vivre. (Ancienne cascade automatique de
 * Part 28, devenue une simple proposition.)
 */
export function autoCoverOverflow(
  overflow: number,
  piggyAvailable: number,
  otherBudgetsSavings: ReadonlyArray<BudgetSavingsSource>,
): OverflowCoverage {
  const target = roundCents(Math.max(0, overflow))
  const piggy = roundCents(Math.min(target, Math.max(0, piggyAvailable)))
  const budgets = distributeProportionally(
    roundCents(target - piggy),
    otherBudgetsSavings.map((b) => ({ id: b.budget_id, weight: b.available })),
  ).map((s) => ({ budget_id: s.id, amount: s.amount }))
  return { piggy, budgets }
}

const PIGGY_KEY = '__piggy__'

/**
 * Ramène une couverture à `target` au plus, au prorata de chaque part (la
 * tirelire comprise). Sert en modification : si le dépassement diminue, les
 * réserves utilisées sont rendues ; s'il augmente, rien de plus n'est pris.
 */
export function shrinkCoverage(coverage: OverflowCoverage, target: number): OverflowCoverage {
  const piggy = roundCents(Math.max(0, coverage.piggy))
  const budgets = coverage.budgets
    .filter((b) => b.amount > 0)
    .map((b) => ({ budget_id: b.budget_id, amount: roundCents(b.amount) }))
  const normalized: OverflowCoverage = { piggy, budgets }
  if (coverageTotal(normalized) <= roundCents(Math.max(0, target))) return normalized

  const shares = distributeProportionally(target, [
    { id: PIGGY_KEY, weight: piggy },
    ...budgets.map((b) => ({ id: b.budget_id, weight: b.amount })),
  ])
  return {
    piggy: shares.find((s) => s.id === PIGGY_KEY)?.amount ?? 0,
    budgets: shares
      .filter((s) => s.id !== PIGGY_KEY)
      .map((s) => ({ budget_id: s.id, amount: s.amount })),
  }
}

/**
 * Répartition d'une dépense budgétée :
 *   1. économies du budget destination puis le budget (`calculateBreakdown`) ;
 *   2. le dépassement est couvert par `coverage` (ramenée au dépassement si
 *      elle le dépasse — on ne prend jamais plus que nécessaire) ;
 *   3. le reste non couvert s'ajoute à `fromBudget` : déficit du budget
 *      destination, donc baisse du reste à vivre.
 * Ajout : `coverage` = choix de l'utilisateur (validé côté serveur par
 * `findCoverageIssue`). Modification : `coverage` = sources d'origine.
 */
export function calculateBreakdownWithCoverage(
  amount: number,
  budgetRemaining: number,
  savingsAvailable: number,
  coverage: OverflowCoverage,
  options: CalculateBreakdownOptions = {},
): AllocationBreakdownWithCascade {
  const local = calculateBreakdown(amount, budgetRemaining, savingsAvailable, {
    useSavingsToggle: options.useSavingsToggle ?? true,
  })
  const kept = shrinkCoverage(coverage, local.overflow)
  const residual = roundCents(Math.max(0, local.overflow - coverageTotal(kept)))
  return {
    fromPiggyBank: kept.piggy,
    fromBudgetSavings: local.fromBudgetSavings,
    fromBudget: roundCents(local.fromBudget + residual),
    overflow: 0,
    crossBudgetDebits: kept.budgets,
  }
}

export type CoverageIssue =
  | 'duplicate-budget'
  | 'unknown-budget'
  | 'piggy-exceeds-available'
  | 'budget-exceeds-available'
  | 'exceeds-overflow'

/**
 * Contrôle serveur d'une couverture envoyée par le client, contre l'état de
 * la base au moment de l'écriture. Une couverture devenue impossible (autre
 * dépense entre-temps, autre membre du groupe) est refusée plutôt que
 * corrigée en silence : l'utilisateur revoit sa répartition.
 */
export function findCoverageIssue(
  coverage: OverflowCoverage,
  overflow: number,
  piggyAvailable: number,
  otherBudgetsSavings: ReadonlyArray<BudgetSavingsSource>,
): CoverageIssue | null {
  const seen = new Set<string>()
  for (const entry of coverage.budgets) {
    if (seen.has(entry.budget_id)) return 'duplicate-budget'
    seen.add(entry.budget_id)
    const source = otherBudgetsSavings.find((b) => b.budget_id === entry.budget_id)
    if (!source) return 'unknown-budget'
    if (entry.amount > source.available + ROUNDING_TOLERANCE) return 'budget-exceeds-available'
  }
  if (coverage.piggy > Math.max(0, piggyAvailable) + ROUNDING_TOLERANCE) {
    return 'piggy-exceeds-available'
  }
  if (coverageTotal(coverage) > Math.max(0, overflow) + ROUNDING_TOLERANCE) {
    return 'exceeds-overflow'
  }
  return null
}
