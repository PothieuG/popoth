/**
 * Preview des CONTRIBUTIONS par membre du groupe lors de l'ajout/édition
 * d'un revenu estimé groupe — miroir conceptuel inverse de
 * `group-members-rav-preview.ts` (qui projette le RAV lors d'un ajout de
 * budget / projet).
 *
 * Sprint Group-Income-Cascade (2026-05-28). Doit matcher EXACTEMENT la
 * logique PL/pgSQL de `calculate_group_contributions` (migration
 * `20260607000001_update_calculate_group_contributions_with_income.sql`) :
 *
 *   contribution_base = MAX(0, monthly_budget_estimate − monthly_income_estimate)
 *   IF Σ salaires > 0 : contribution_i = (salary_i / Σ salaires) × contribution_base
 *   ELSE              : contribution_i = contribution_base / nb_membres
 *
 * Un nouveau revenu estimé groupe **réduit** les contributions (inverse du
 * budget). Si revenus_groupe > budgets_groupe, contribution_base = 0 →
 * personne ne paye (surplus en cagnotte, visible via RAV groupe positif).
 *
 * **Note sémantique** : le RAV groupe **ne change pas** quand on ajoute un
 * revenu estimé (les deux effets se compensent : +R via incomeCompensation
 * et −R via baisse des contributions). Le RAV groupe n'augmente que si le
 * revenu pousse les contributions au plancher (R > B).
 */

import type { GroupMemberRavDetail } from './types'

export interface GroupMemberContributionRow {
  profileId: string
  firstName: string
  salary: number
  currentContribution: number
  projectedContribution: number
  /** Negative if the member will pay less (the common case). */
  delta: number
  /**
   * RAV perso du membre — actuel (authoritative) → projeté. Quand un revenu
   * groupe est ajouté, la contribution baisse (`delta < 0`) et donc le RAV
   * perso **monte** d'autant : `projectedRav = currentRav − delta`. Même
   * delta-math que `computeGroupMembersRavPreview` (la contribution est une
   * dépense exceptionnelle « miroir » dans le RAV perso de chaque membre).
   */
  currentRav: number
  projectedRav: number
}

/**
 * Total projeté `monthly_income_estimate` après modification d'un revenu
 * estimé groupe. Mode ajout : `currentItemAmount = 0`. Mode édition :
 * `currentItemAmount = montant actuel` soustrait avant d'ajouter le nouveau
 * (delta-math identique à `computeProjectedGroupTotal` côté budget).
 */
export function computeProjectedGroupIncomeTotal(opts: {
  currentGroupIncomeTotal: number
  currentItemAmount?: number
  newItemAmount: number
}): number {
  const { currentGroupIncomeTotal, currentItemAmount = 0, newItemAmount } = opts
  return currentGroupIncomeTotal - currentItemAmount + newItemAmount
}

function contributionFor(opts: {
  salary: number
  sumSalaries: number
  memberCount: number
  contributionBase: number
}): number {
  const { salary, sumSalaries, memberCount, contributionBase } = opts
  if (memberCount === 0 || contributionBase <= 0) return 0
  if (sumSalaries <= 0) {
    return contributionBase / memberCount
  }
  return (salary / sumSalaries) * contributionBase
}

export function computeGroupMembersContributionsPreview(opts: {
  members: GroupMemberRavDetail[]
  currentGroupBudgetTotal: number
  currentGroupIncomeTotal: number
  projectedGroupIncomeTotal: number
}): GroupMemberContributionRow[] {
  const { members, currentGroupBudgetTotal, currentGroupIncomeTotal, projectedGroupIncomeTotal } =
    opts
  if (members.length === 0) return []

  const sumSalaries = members.reduce((sum, m) => sum + m.salary, 0)
  const currentBase = Math.max(0, currentGroupBudgetTotal - currentGroupIncomeTotal)
  const projectedBase = Math.max(0, currentGroupBudgetTotal - projectedGroupIncomeTotal)

  return members.map((m) => {
    const currentContribution = contributionFor({
      salary: m.salary,
      sumSalaries,
      memberCount: members.length,
      contributionBase: currentBase,
    })
    const projectedContribution = contributionFor({
      salary: m.salary,
      sumSalaries,
      memberCount: members.length,
      contributionBase: projectedBase,
    })
    const delta = projectedContribution - currentContribution
    return {
      profileId: m.profileId,
      firstName: m.firstName,
      salary: m.salary,
      currentContribution,
      projectedContribution,
      delta,
      currentRav: m.currentRav,
      projectedRav: m.currentRav - delta,
    }
  })
}
