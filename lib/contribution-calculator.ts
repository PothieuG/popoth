/**
 * Group budget-allocation helpers — répartit un budget de groupe entre ses
 * membres au prorata de leurs salaires.
 *
 * ⚠️ À NE PAS CONFONDRE avec `calculateIncomeCompensation`
 * ([lib/finance/income-compensation.ts](./finance/income-compensation.ts)) :
 *
 * - **Ici** (budget-allocation) : "que doit cotiser chaque membre pour un
 *   budget de groupe fixé ?" — input = salaires + group budget + revenus du
 *   groupe, output = contribution attendue par membre. Logique pure
 *   synchrone, zéro I/O. Miroir client de la RPC `calculate_group_contributions`
 *   (Sprint Group-Income-Cascade) : les revenus estimés du groupe (ex. CAF)
 *   sont retirés du budget avant la répartition au prorata des salaires.
 * - **Income compensation** : "quel est le total des revenus à ajouter au
 *   reste-à-vivre (RAV) ?" — input = `ContextFilter` (DB-driven), output =
 *   somme des revenus (réels si présents, sinon estimés). Async + Supabase.
 *
 * Les domaines sont orthogonaux malgré la proximité du naming. Le seul
 * consumer applicatif de `calculateUserContribution` est
 * `components/profile/ProfileSettingsCard.tsx` (validation
 * salary-vs-contribution + display) ; `calculateAmountToFund` sert aussi à
 * l'en-tête des dashboards (part du reste à financer).
 */

export interface ContributionCalculation {
  userContribution: number
  userPercentage: number
  isValid: boolean
  errorMessage?: string
  suggestions?: string[]
}

export interface GroupMember {
  id: string
  salary: number
}

/**
 * Reste à financer par les membres : budget du groupe moins ses revenus
 * estimés, clampé à 0 (si les revenus couvrent tout, personne ne cotise).
 * Miroir de `contribution_base := GREATEST(0, group_budget - group_income)`
 * dans la RPC `calculate_group_contributions`.
 */
export function calculateAmountToFund(groupBudget: number, groupIncome = 0): number {
  return Math.max(0, groupBudget - groupIncome)
}

/** Infobulle des % "du reste à financer" (en-têtes dashboards + Paramètres). */
export const AMOUNT_TO_FUND_TOOLTIP =
  'Votre part du reste à financer : budget du groupe moins ses revenus (ex. CAF), réparti au prorata des salaires.'

/**
 * Calculates what a user's contribution would be given their salary and group context
 * Used for validation before saving salary changes
 */
export function calculateUserContribution(
  userSalary: number,
  groupBudget: number,
  otherMembers: GroupMember[] = [],
  groupIncome = 0,
): ContributionCalculation {
  // Input validation
  if (userSalary < 0) {
    return {
      userContribution: 0,
      userPercentage: 0,
      isValid: false,
      errorMessage: 'Le salaire ne peut pas être négatif',
    }
  }

  if (groupBudget <= 0) {
    return {
      userContribution: 0,
      userPercentage: 0,
      isValid: false,
      errorMessage: 'Le budget du groupe doit être positif',
    }
  }

  // Calculate total salaries (user + other members)
  const otherMembersSalaryTotal = otherMembers.reduce(
    (sum, member) => sum + (member.salary || 0),
    0,
  )
  const totalGroupSalaries = userSalary + otherMembersSalaryTotal

  // Les revenus du groupe financent une partie du budget : seul le reste est
  // réparti entre les membres (miroir de la RPC).
  const amountToFund = calculateAmountToFund(groupBudget, groupIncome)

  let userContribution: number
  let userPercentage: number

  // If no salaries defined (including user salary = 0), equal split
  if (totalGroupSalaries === 0) {
    const totalMembers = otherMembers.length + 1 // +1 for current user
    userContribution = amountToFund / totalMembers
    userPercentage = totalMembers > 0 ? (userContribution / Math.max(userSalary, 1)) * 100 : 0
  } else {
    // Proportional calculation
    userContribution = (userSalary / totalGroupSalaries) * amountToFund
    userPercentage = userSalary > 0 ? (userContribution / userSalary) * 100 : 0
  }

  // Validation: contribution should not exceed salary
  const isValid = userSalary === 0 || userContribution <= userSalary

  let errorMessage: string | undefined
  let suggestions: string[] | undefined

  if (!isValid) {
    errorMessage = `Votre contribution calculée (${formatCurrency(userContribution)}) dépasse votre salaire (${formatCurrency(userSalary)})`

    // Budget max = ce que les salaires peuvent financer + ce que les revenus
    // du groupe couvrent déjà.
    suggestions = [
      `Augmentez votre salaire à au moins ${formatCurrency(Math.ceil(userContribution))}`,
      `Demandez au groupe de réduire le budget à ${formatCurrency(Math.floor(totalGroupSalaries + groupIncome))} maximum`,
      `Attendez que d'autres membres rejoignent le groupe pour réduire votre part`,
    ]

    // If other members have salaries, suggest budget reduction more precisely
    if (otherMembersSalaryTotal > 0) {
      const maxSafeBudget = Math.floor(totalGroupSalaries * 0.9 + groupIncome) // 90% safety margin
      suggestions[1] = `Demandez au groupe de réduire le budget à ${formatCurrency(maxSafeBudget)} maximum`
    }
  }

  return {
    userContribution,
    userPercentage,
    isValid,
    errorMessage,
    suggestions,
  }
}

/**
 * Formats a currency amount for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Formats a percentage for display
 */
export function formatPercentage(percentage: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(percentage / 100)
}
