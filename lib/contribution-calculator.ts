/**
 * Group budget-allocation helpers — répartit un budget de groupe entre ses
 * membres au prorata de leurs salaires.
 *
 * ⚠️ À NE PAS CONFONDRE avec `calculateIncomeCompensation`
 * ([lib/finance/income-compensation.ts](./finance/income-compensation.ts)) :
 *
 * - **Ici** (budget-allocation) : "que doit cotiser chaque membre pour un
 *   budget de groupe fixé ?" — input = salaires + group budget, output =
 *   contribution attendue par membre. Logique pure synchrone, zéro I/O.
 * - **Income compensation** : "quel est le total des revenus à ajouter au
 *   reste-à-vivre (RAV) ?" — input = `ContextFilter` (DB-driven), output =
 *   somme des revenus (réels si présents, sinon estimés). Async + Supabase.
 *
 * Les domaines sont orthogonaux malgré la proximité du naming. Le seul
 * consumer applicatif est `components/profile/ProfileSettingsCard.tsx`
 * (validation salary-vs-contribution + display).
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
 * Calculates what a user's contribution would be given their salary and group context
 * Used for validation before saving salary changes
 */
export function calculateUserContribution(
  userSalary: number,
  groupBudget: number,
  otherMembers: GroupMember[] = [],
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

  let userContribution: number
  let userPercentage: number

  // If no salaries defined (including user salary = 0), equal split
  if (totalGroupSalaries === 0) {
    const totalMembers = otherMembers.length + 1 // +1 for current user
    userContribution = groupBudget / totalMembers
    userPercentage = totalMembers > 0 ? (userContribution / Math.max(userSalary, 1)) * 100 : 0
  } else {
    // Proportional calculation
    userContribution = (userSalary / totalGroupSalaries) * groupBudget
    userPercentage = userSalary > 0 ? (userContribution / userSalary) * 100 : 0
  }

  // Validation: contribution should not exceed salary
  const isValid = userSalary === 0 || userContribution <= userSalary

  let errorMessage: string | undefined
  let suggestions: string[] | undefined

  if (!isValid) {
    errorMessage = `Votre contribution calculée (${formatCurrency(userContribution)}) dépasse votre salaire (${formatCurrency(userSalary)})`

    suggestions = [
      `Augmentez votre salaire à au moins ${formatCurrency(Math.ceil(userContribution))}`,
      `Demandez au groupe de réduire le budget à ${formatCurrency(Math.floor(totalGroupSalaries))} maximum`,
      `Attendez que d'autres membres rejoignent le groupe pour réduire votre part`,
    ]

    // If other members have salaries, suggest budget reduction more precisely
    if (otherMembersSalaryTotal > 0) {
      const maxSafeBudget = Math.floor(totalGroupSalaries * 0.9) // 90% safety margin
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

