/**
 * Preview du RAV par membre du groupe lors de l'ajout/édition d'un budget
 * ou d'un projet groupe — delta-math basé sur le RAV authoritatif.
 *
 * Algorithme :
 *
 *   delta_contribution_i = projectedContribution_i − currentContribution_i
 *   projectedRav_i       = currentRav_i − delta_contribution_i
 *
 * où `currentRav_i` est la valeur authoritative servie par
 * `getProfileFinancialData(memberId).remainingToLive` (cf.
 * `lib/finance/financial-data.ts` qui hydrate `meta.groupMembersRav`).
 *
 * Pourquoi delta-math ? La formule RAV complète d'un membre est :
 *
 *   RAV = incomeContribution + exceptionalIncomes − estimatedBudgets
 *         − exceptionalExpenses − budgetDeficits
 *
 * Tous les termes sauf `exceptionalExpenses` restent constants quand on
 * ajoute/modifie un budget ou projet groupe — la seule chose qui bouge,
 * c'est la « contribution mirror » (real_expense exceptionnelle créée par
 * le trigger `sync_contribution_real_expense`) qui change exactement de
 * `delta_contribution`. Donc `projectedRav = currentRav − delta_contribution`
 * est **exact**, pas une approximation.
 *
 * Répartition des contributions (miroir RPC PG
 * `calculate_group_contributions`) :
 *   - sum_salaries > 0 → prorata `(salary_i / sum_salaries) × total_groupe`
 *   - sum_salaries = 0 → split égal `total_groupe / nb_membres`
 *
 * `willGoNegative` est calculé sur la valeur brute (pas clampée) du
 * projeté ; le composant `<GroupMembersRavRecap>` affiche la valeur brute
 * également pour rester cohérent avec ce qui sera vu sur le dashboard
 * (qui peut afficher un RAV négatif).
 */

export interface GroupMemberRavInput {
  profileId: string
  firstName: string
  salary: number
  /**
   * RAV courant **authoritative** du membre (= dashboard perso). Peut être
   * négatif si le membre est déjà en déficit. Sert de baseline au delta-math.
   */
  currentRav: number
}

export interface GroupMemberRavRow {
  profileId: string
  firstName: string
  currentRav: number
  projectedRav: number
  willGoNegative: boolean
}

/**
 * Total projeté après modification d'un item (budget ou projet groupe).
 * Mode ajout : `currentItemAmount = 0`. Mode édition : `currentItemAmount`
 * = montant actuel de l'item, soustrait avant d'ajouter le nouveau pour
 * éviter le double-comptage (delta-math identique aux refines des schémas).
 */
export function computeProjectedGroupTotal(opts: {
  currentGroupTotal: number
  currentItemAmount?: number
  newItemAmount: number
}): number {
  const { currentGroupTotal, currentItemAmount = 0, newItemAmount } = opts
  return currentGroupTotal - currentItemAmount + newItemAmount
}

function contributionFor(opts: {
  salary: number
  sumSalaries: number
  memberCount: number
  total: number
}): number {
  const { salary, sumSalaries, memberCount, total } = opts
  if (memberCount === 0 || total <= 0) return 0
  if (sumSalaries <= 0) {
    return total / memberCount
  }
  return (salary / sumSalaries) * total
}

export function computeGroupMembersRavPreview(opts: {
  members: GroupMemberRavInput[]
  currentGroupTotal: number
  projectedGroupTotal: number
}): GroupMemberRavRow[] {
  const { members, currentGroupTotal, projectedGroupTotal } = opts
  if (members.length === 0) return []

  const sumSalaries = members.reduce((sum, m) => sum + m.salary, 0)

  return members.map((m) => {
    const currentContribution = contributionFor({
      salary: m.salary,
      sumSalaries,
      memberCount: members.length,
      total: currentGroupTotal,
    })
    const projectedContribution = contributionFor({
      salary: m.salary,
      sumSalaries,
      memberCount: members.length,
      total: projectedGroupTotal,
    })
    const deltaContribution = projectedContribution - currentContribution
    const projectedRav = m.currentRav - deltaContribution
    return {
      profileId: m.profileId,
      firstName: m.firstName,
      currentRav: m.currentRav,
      projectedRav,
      willGoNegative: projectedRav < 0,
    }
  })
}
