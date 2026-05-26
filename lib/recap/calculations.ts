/**
 * Monthly Recap V3 — pure calculations module.
 *
 * 4 fonctions publiques : surplus/déficit par budget, résumé du recap,
 * refloat proportionnel sur économies cumulées, snapshot proportionnel sur
 * budgets futurs. Aucune I/O — les inputs sont passés en paramètres et les
 * résultats retournés. Déterministe (tri stable + cents precision).
 */

import type { SavingsProjectMeta } from '@/lib/finance/types'

import type { BudgetSummary, RecapSummary, RefloatProportionalAllocation } from './types'

/** surplus = max(0, estimé - dépensé) ; deficit = max(0, dépensé - estimé). */
export function computeBudgetSurplus(
  estimatedAmount: number,
  spentThisMonth: number,
): { surplus: number; deficit: number } {
  const diff = round2(estimatedAmount - spentThisMonth)
  return diff >= 0 ? { surplus: diff, deficit: 0 } : { surplus: 0, deficit: round2(-diff) }
}

/** Bilan = ravEffectif - ravEstime (soustraction). Positive si le mois s'est mieux passé
 *  que prévu (j'ai dépensé moins → RAV réel > RAV théorique → on peut épargner la diff).
 *  Négatif si pire (j'ai dépensé plus → renflouer). Trie les budgets par budgetId pour
 *  stabilité tests. */
export function computeRecapSummary(input: {
  currentBalance: number
  ravEstime: number
  ravEffectif: number
  piggyAmount: number
  budgets: ReadonlyArray<{
    budgetId: string
    budgetName: string
    estimatedAmount: number
    spentThisMonth: number
    cumulatedSavings: number
    /** Optional — defaults to 0. Carried over from prior-month snapshots
     *  via finalize (sprint 08). Sprint-13 negative snapshot line reads
     *  it to display `Nom → carryoverSpentAmount/estimatedAmount`. */
    carryoverSpentAmount?: number
  }>
  /** Sprint Recap-Positive-Consume-Surplus (2026-05-25). `{ [budgetId]: amount }`
   *  des surplus déjà transférés vers la tirelire pendant ce recap actif. Le
   *  montant est traité comme s'il avait été dépensé : il s'ajoute à
   *  `spentThisMonth` avant calcul du surplus, ce qui le ramène à 0 quand le
   *  transfert couvre exactement le sous-dépensé du mois. Le `spentThisMonth`
   *  exposé dans le `BudgetSummary` reste la valeur brute originale — seul le
   *  surplus/deficit est affecté. */
  piggyTransfersData?: Record<string, number>
  /** Sprint Projets-Épargne 07 (2026-05-26). Passé verbatim dans le résultat
   *  pour alimenter le drawer "Projets en cours" du `SummaryStep` et la
   *  cascade négative `RefloatProjectsLine` (sprint 09). Aucune logique de
   *  calcul ici — pur passthrough depuis `loadRecapSummary`. Défaut `[]`. */
  savingsProjects?: readonly SavingsProjectMeta[]
}): RecapSummary {
  const enriched: BudgetSummary[] = input.budgets.map((b) => {
    const transferredToPiggy = input.piggyTransfersData?.[b.budgetId] ?? 0
    const effectiveSpent = b.spentThisMonth + transferredToPiggy
    const { surplus, deficit } = computeBudgetSurplus(b.estimatedAmount, effectiveSpent)
    return {
      budgetId: b.budgetId,
      budgetName: b.budgetName,
      estimatedAmount: b.estimatedAmount,
      spentThisMonth: b.spentThisMonth,
      cumulatedSavings: b.cumulatedSavings,
      carryoverSpentAmount: b.carryoverSpentAmount ?? 0,
      surplus,
      deficit,
    }
  })
  const sorted = enriched.slice().sort((a, b) => a.budgetId.localeCompare(b.budgetId))

  const totalSurplus = round2(sorted.reduce((s, b) => s + b.surplus, 0))
  const totalSavings = round2(sorted.reduce((s, b) => s + b.cumulatedSavings, 0))
  const bilan = round2(input.ravEffectif - input.ravEstime)
  const bilanSign: RecapSummary['bilanSign'] =
    bilan > 0 ? 'positive' : bilan < 0 ? 'negative' : 'zero'

  return {
    currentBalance: input.currentBalance,
    ravEstime: input.ravEstime,
    ravEffectif: input.ravEffectif,
    piggyAmount: input.piggyAmount,
    totalSurplus,
    totalSavings,
    budgets: sorted,
    bilan,
    bilanSign,
    savingsProjects: input.savingsProjects ?? [],
  }
}

/** Distribue targetAmount proportionnellement aux cumulated_savings de chaque budget. */
export function computeProportionalSavingsRefloat(
  targetAmount: number,
  budgets: ReadonlyArray<{ budgetId: string; cumulatedSavings: number }>,
): RefloatProportionalAllocation {
  return distributeProportional(
    targetAmount,
    budgets.map((b) => ({ budgetId: b.budgetId, pool: b.cumulatedSavings })),
  )
}

/** Distribue targetAmount proportionnellement aux estimatedAmount de chaque budget (Option B). */
export function computeProportionalBudgetSnapshot(
  targetAmount: number,
  budgets: ReadonlyArray<{ budgetId: string; estimatedAmount: number }>,
): RefloatProportionalAllocation {
  return distributeProportional(
    targetAmount,
    budgets.map((b) => ({ budgetId: b.budgetId, pool: b.estimatedAmount })),
  )
}

function distributeProportional(
  targetAmount: number,
  budgets: ReadonlyArray<{ budgetId: string; pool: number }>,
): RefloatProportionalAllocation {
  const sorted = budgets
    .filter((b) => b.pool > 0)
    .map((b) => ({ budgetId: b.budgetId, pool: round2(b.pool) }))
    .sort((a, b) => a.budgetId.localeCompare(b.budgetId))

  const totalPool = round2(sorted.reduce((s, b) => s + b.pool, 0))

  if (targetAmount <= 0 || totalPool <= 0 || sorted.length === 0) {
    return {
      perBudget: [],
      totalAllocated: 0,
      shortfall: targetAmount > 0 ? round2(targetAmount) : 0,
    }
  }

  if (totalPool <= targetAmount) {
    return {
      perBudget: sorted.map((b) => ({ budgetId: b.budgetId, amount: b.pool })),
      totalAllocated: totalPool,
      shortfall: round2(targetAmount - totalPool),
    }
  }

  const shares: Array<{ budgetId: string; amount: number }> = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!
    const raw = (targetAmount * current.pool) / totalPool
    const capped = Math.min(current.pool, round2(raw))
    shares.push({ budgetId: current.budgetId, amount: capped })
  }
  const sumSoFar = shares.reduce((s, x) => s + x.amount, 0)
  const last = sorted[sorted.length - 1]!
  const lastShare = Math.min(last.pool, round2(targetAmount - sumSoFar))
  shares.push({ budgetId: last.budgetId, amount: lastShare })

  const totalAllocated = round2(shares.reduce((s, x) => s + x.amount, 0))
  return {
    perBudget: shares,
    totalAllocated,
    shortfall: round2(Math.max(0, targetAmount - totalAllocated)),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
