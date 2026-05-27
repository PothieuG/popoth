/**
 * Monthly Recap V3 — pure calculations module.
 *
 * 4 fonctions publiques : surplus/déficit par budget, résumé du recap,
 * refloat proportionnel sur économies cumulées, snapshot proportionnel sur
 * budgets futurs. Aucune I/O — les inputs sont passés en paramètres et les
 * résultats retournés. Déterministe (tri stable + cents precision).
 */

import type { SavingsProjectMeta } from '@/lib/finance/types'

import type {
  BudgetSummary,
  ProjectSnapshotSummary,
  RecapSummary,
  RefloatProportionalAllocation,
} from './types'

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
  /** Sprint Projets-Épargne 10. `{ [projectId]: refund_amount }` lu depuis
   *  `monthly_recaps.project_snapshot_data` du recap actif. Combiné aux
   *  `savingsProjects` pour produire le `projectSnapshot` exposé sur
   *  `RecapSummary`. Quand `savingsProjects.length === 0` OU absent, le
   *  champ `projectSnapshot` du résultat est omis (UI masque la section
   *  Projets du FinalRecapStep). Refunds hors-owner silencieusement ignorés
   *  (cohérent avec la RPC `apply_recap_projects_snapshot` qui itère sur les
   *  projets de l'owner uniquement). */
  projectSnapshotData?: Record<string, number>
}): RecapSummary {
  const enriched: BudgetSummary[] = input.budgets.map((b) => {
    const transferredToPiggy = input.piggyTransfersData?.[b.budgetId] ?? 0
    const carryoverSpent = b.carryoverSpentAmount ?? 0
    // Sprint Fix-Recap-Surplus-Inconsistency (2026-05-27) — miroir de
    // `_loadFinancialData` deficit loop : `deficit = MAX(0, spent_current_month
    // + carryover - estimated)`. Sans `carryoverSpent` dans `effectiveSpent`,
    // un budget avec dette reportée non-soldée afficherait à tort un surplus
    // = estimated tant que le mois courant n'a pas re-saturé le cap.
    const effectiveSpent = b.spentThisMonth + carryoverSpent + transferredToPiggy
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

  const savingsProjects = input.savingsProjects ?? []
  const projectSnapshot =
    savingsProjects.length > 0
      ? computeProjectSnapshotSummary(savingsProjects, input.projectSnapshotData)
      : undefined

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
    savingsProjects,
    ...(projectSnapshot !== undefined && { projectSnapshot }),
  }
}

/** Sprint Projets-Épargne 10 — preview de l'effet de `apply_recap_projects_snapshot`
 *  à la finalize. Pour chaque projet, calcule la part qui sera sauvée
 *  (`monthly - refund`), la part refloutée (`refund`), et le nombre de mois
 *  de décalage de deadline (`FLOOR(pending_delay_fraction + refund/monthly)`).
 *  Sémantique miroir exact de la RPC PG (sinon UI mensongère).
 *
 *  Le `shifted` list ne contient QUE les projets dont la deadline va être
 *  décalée d'au moins 1 mois (`monthsShift >= 1`), pour l'affichage détaillé
 *  côté FinalRecapStep. Les autres projets contribuent silencieusement à
 *  `totalSaved` / `totalRefunded`. */
function computeProjectSnapshotSummary(
  projects: ReadonlyArray<SavingsProjectMeta>,
  snapshotData: Record<string, number> | undefined,
): ProjectSnapshotSummary {
  const sortedProjects = projects.slice().sort((a, b) => a.id.localeCompare(b.id))
  let totalSaved = 0
  let totalRefunded = 0
  const shifted: Array<{ id: string; name: string; monthsShift: number }> = []

  for (const project of sortedProjects) {
    const refund = snapshotData?.[project.id] ?? 0
    const saved = round2(project.monthlyAllocation - refund)
    totalSaved += saved
    totalRefunded += refund

    if (project.monthlyAllocation > 0) {
      const fracAdded = refund / project.monthlyAllocation
      const newPending = project.pendingDelayFraction + fracAdded
      const monthsShift = Math.floor(newPending)
      if (monthsShift >= 1) {
        shifted.push({ id: project.id, name: project.name, monthsShift })
      }
    }
  }

  return {
    totalSaved: round2(totalSaved),
    totalRefunded: round2(totalRefunded),
    shifted,
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

/** Distribue targetAmount proportionnellement aux estimatedAmount de chaque
 *  budget (Option B). Sprint Carryover-Self-Healing 2026-05-26 — passe
 *  `capPerPool: false` à `distributeProportional` pour autoriser des parts
 *  per-budget > pool (estimatedAmount) quand le déficit dépasse
 *  sum(estimated_amount). Le snapshot devient autoritatif et peut "surcharger"
 *  un budget au-delà de 100% — la dette est ensuite résorbée mécaniquement
 *  par la marge libre des mois suivants (cf. operational-rules.md §5
 *  "carryover overwrite"). Les 2 autres consumers
 *  (`computeProportionalSavingsRefloat`, `computeProportionalProjectsRefloat`)
 *  gardent `capPerPool: true` car leur pool est physique (DB CHECK
 *  cumulated_savings >= 0 + sémantique "renoncer 1 mois de mensualité"). */
export function computeProportionalBudgetSnapshot(
  targetAmount: number,
  budgets: ReadonlyArray<{ budgetId: string; estimatedAmount: number }>,
): RefloatProportionalAllocation {
  return distributeProportional(
    targetAmount,
    budgets.map((b) => ({ budgetId: b.budgetId, pool: b.estimatedAmount })),
    { capPerPool: false },
  )
}

/** Distribue targetAmount proportionnellement à `monthly_allocation` de chaque
 *  projet d'épargne (sprint Projets-Épargne 08, cascade renflouement étape
 *  intermédiaire entre savings et budget snapshot). Le pool est la mensualité
 *  du mois — pas l'`amount_saved` cumulé — sémantique "renoncer temporairement
 *  à l'épargne mensuelle du projet pour combler le déficit". Le résultat
 *  conserve le shape `RefloatProportionalAllocation` (`perBudget` = par
 *  `projectId`) pour réutiliser `distributeProportional` et la sérialisation
 *  côté action helper. */
export function computeProportionalProjectsRefloat(
  targetAmount: number,
  projects: ReadonlyArray<{ projectId: string; monthlyAllocation: number }>,
): RefloatProportionalAllocation {
  return distributeProportional(
    targetAmount,
    projects.map((p) => ({ budgetId: p.projectId, pool: p.monthlyAllocation })),
  )
}

function distributeProportional(
  targetAmount: number,
  budgets: ReadonlyArray<{ budgetId: string; pool: number }>,
  options: { capPerPool?: boolean } = {},
): RefloatProportionalAllocation {
  const capPerPool = options.capPerPool ?? true

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

  // When capping is enabled and totalPool ≤ target, drain each pool fully and
  // report a shortfall. When capping is disabled (budget snapshot mode), we
  // fall through to the proportional branch — individual shares scale up by
  // (target / totalPool) ≥ 1 and the total equals target (no shortfall).
  if (capPerPool && totalPool <= targetAmount) {
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
    const rounded = round2(raw)
    const amount = capPerPool ? Math.min(current.pool, rounded) : rounded
    shares.push({ budgetId: current.budgetId, amount })
  }
  const sumSoFar = shares.reduce((s, x) => s + x.amount, 0)
  const last = sorted[sorted.length - 1]!
  const lastRaw = round2(targetAmount - sumSoFar)
  const lastShare = capPerPool ? Math.min(last.pool, lastRaw) : lastRaw
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
