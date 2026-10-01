/**
 * Monthly Recap V3 — shared types for pure calculations and downstream actions.
 *
 * Consumed by `calculations.ts` (this sprint) and `actions-negative.ts`
 * (sprint 07). Pure data shapes only — no functions, no I/O.
 */

import type { SavingsProjectMeta } from '@/lib/finance/types'

export interface BudgetSummary {
  budgetId: string
  budgetName: string
  estimatedAmount: number
  spentThisMonth: number
  cumulatedSavings: number
  /** Amount carried over from prior-month snapshots (sprint 08 finalize
   *  applies `monthly_recaps.budget_snapshot_data` into this column). Used
   *  by the sprint 13 negative-flow snapshot line which displays each
   *  budget as `Nom → carryoverSpentAmount/estimatedAmount` (matching the
   *  planner display). Zero when no prior snapshot ever fired. */
  carryoverSpentAmount: number
  surplus: number
  deficit: number
}

export interface RecapSummary {
  currentBalance: number
  /** Reste à vivre estimé — métrique indicative affichée au résumé ; n'entre
   *  PAS dans le bilan (depuis Sprint Bilan-Equals-RavEffectif).
   *  - Profile : `totalEstimatedIncome − totalEstimatedBudgets`
   *  - Group   : `totalEstimatedIncome + totalGroupContributions − totalEstimatedBudgets`
   *  Le terme groupe figure pour cohérence d'affichage avec `ravEffectif`
   *  (cf. `lib/finance/calc-rtl.ts::calculateRemainingToLiveGroup`). */
  ravEstime: number
  ravEffectif: number
  totalSurplus: number
  totalSavings: number
  piggyAmount: number
  budgets: readonly BudgetSummary[]
  /** Bilan = ravEffectif (reste à vivre effectif). Positif → argent « en plus »
   *  versé à la tirelire à l'écran suivant ; négatif → déficit à renflouer
   *  (= |ravEffectif|) ; zéro → équilibre. Cf.
   *  `lib/recap/calculations.ts::computeRecapSummary`. */
  bilan: number
  bilanSign: 'positive' | 'negative' | 'zero'
  /** Sprint Projets-Épargne 07 (2026-05-26). Subset présentationnel des projets
   *  d'épargne actifs de l'owner du recap. Alimenté par
   *  `financialData.meta?.savingsProjects` dans `loadRecapSummary` — aucun
   *  fetch supplémentaire. Consommé par `SummaryStep` (drawer "Projets en
   *  cours") et par la section Projets de « Gestion du déficit » (Sprint
   *  Recap-Manual-Refloat). `[]` quand l'owner n'a aucun projet. */
  savingsProjects: readonly SavingsProjectMeta[]
  /** Sprint Projets-Épargne 10. Preview de ce que `apply_recap_projects_snapshot`
   *  fera à la finalize : pour chaque projet actif, `amount_saved +=
   *  monthly_allocation - refund` ; `deadline_date` décalée si
   *  `pending_delay_fraction + refund/monthly_allocation ≥ 1`. Calculé pur
   *  côté serveur à partir de `savingsProjects` + `projectSnapshotData` (lu
   *  dans `monthly_recaps.project_snapshot_data` pour le recap actif).
   *  Consommé par `FinalRecapStep` pour afficher la section "Projets". */
  projectSnapshot?: ProjectSnapshotSummary
  /** Sprint Salary-Reception (2026-10-02). Espace perso d'un membre de groupe :
   *  la contribution au groupe DÉJÀ soustraite de `ravEffectif` (ligne miroir
   *  `real_expenses.contribution_id`). Purement explicatif — sans elle, un
   *  reste à vivre faible à côté d'un solde élevé ne se lit pas. Absent en
   *  contexte groupe ou hors groupe. */
  groupContribution?: { label: string; amount: number }
  /** Sprint Salary-Reception (2026-10-02). Salaire reçu en avance pendant le
   *  mois recapé (option « Réception du salaire ») : présent dans
   *  `currentBalance`, absent de `ravEffectif` — il finance `fundedMonth`. À la
   *  finalisation, `create_salary_income_for_recap` en fait la ligne salaire de
   *  ce mois et `delta` (reçu − prévu) entre dans son reste à vivre. */
  salaryReception?: SalaryReceptionSummary
}

export interface SalaryReceptionSummary {
  received: number
  /** Salaire déclaré au moment du calcul (`profiles.salary`). */
  expected: number
  /** received − expected, au centime. */
  delta: number
  /** Mois qui suit le mois recapé. */
  fundedMonth: { month: number; year: number }
}

/** Sprint Projets-Épargne 10 — résumé synthétique des effets de
 *  `apply_recap_projects_snapshot` qui sera appliqué à la finalize.
 *  - `totalSaved` : somme des `(monthly_allocation - refund)` sur TOUS les
 *    projets actifs de l'owner — c'est le montant total qui sera ajouté aux
 *    `amount_saved` cumulés ce mois-ci.
 *  - `totalRefunded` : somme des refunds — c'est le total prélevé sur les
 *    mensualités pour combler le déficit.
 *  - `shifted` : sous-ensemble des projets dont la deadline va être décalée
 *    d'au moins 1 mois (i.e. `pending_delay_fraction + refund/monthly_allocation
 *    ≥ 1`). Liste vide si aucun shift n'est déclenché. */
export interface ProjectSnapshotSummary {
  totalSaved: number
  totalRefunded: number
  shifted: ReadonlyArray<{ id: string; name: string; monthsShift: number }>
}

export interface RefloatProportionalAllocation {
  perBudget: ReadonlyArray<{ budgetId: string; amount: number }>
  totalAllocated: number
  shortfall: number
}
