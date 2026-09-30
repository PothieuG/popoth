import { describe, it, expect } from 'vitest'
import {
  calculateAmountToFund,
  calculateUserContribution,
  formatCurrency,
  formatPercentage,
} from '@/lib/contribution-calculator'

describe('calculateUserContribution', () => {
  it('happy path: proportional split between members with non-zero salaries', () => {
    // userSalary 1000 in a group of 3 members with total salaries 2000 → 50%
    // share of a 300€ budget → 150€ contribution, percentage = 15% of own salary.
    const result = calculateUserContribution(1000, 300, [
      { id: 'b', salary: 500 },
      { id: 'c', salary: 500 },
    ])
    expect(result.isValid).toBe(true)
    expect(result.userContribution).toBe(150)
    expect(result.userPercentage).toBe(15)
    expect(result.errorMessage).toBeUndefined()
    expect(result.suggestions).toBeUndefined()
  })

  it('totalGroupSalaries === 0 → equal split fallback (no salaries declared yet)', () => {
    // Both user and the only other member have salary=0 → no proportional ratio
    // available, the branch divides budget equally over (otherMembers + 1).
    // userSalary===0 → isValid is true regardless (early-skip in the isValid expr).
    const result = calculateUserContribution(0, 300, [{ id: 'b', salary: 0 }])
    expect(result.isValid).toBe(true)
    expect(result.userContribution).toBe(150)
    expect(result.errorMessage).toBeUndefined()
  })

  it('negative userSalary → early-return invalid with explicit errorMessage', () => {
    const result = calculateUserContribution(-100, 300)
    expect(result.isValid).toBe(false)
    expect(result.userContribution).toBe(0)
    expect(result.userPercentage).toBe(0)
    expect(result.errorMessage).toMatch(/Le salaire ne peut pas être négatif/)
    expect(result.suggestions).toBeUndefined()
  })

  it('groupBudget === 0 → early-return invalid with explicit errorMessage', () => {
    const result = calculateUserContribution(1000, 0)
    expect(result.isValid).toBe(false)
    expect(result.userContribution).toBe(0)
    expect(result.errorMessage).toMatch(/Le budget du groupe doit être positif/)
  })

  it('contribution > salary (single-member group) → invalid with 3 suggestions, default budget hint uses floor(totalGroupSalaries)', () => {
    // Only the user has a salary → totalGroupSalaries === userSalary === 100
    // contribution = (100/100)*300 = 300 > 100 → isValid=false
    // otherMembersSalaryTotal === 0 → suggestions[1] keeps the default form
    // (Math.floor(totalGroupSalaries) === 100, not the 90% safety margin).
    const result = calculateUserContribution(100, 300, [])
    expect(result.isValid).toBe(false)
    expect(result.userContribution).toBe(300)
    expect(result.suggestions).toHaveLength(3)
    expect(result.errorMessage).toMatch(/dépasse votre salaire/)
    expect(result.suggestions?.[1]).toMatch(/100/) // floor(totalGroupSalaries)
  })

  it('contribution > salary with other members → suggestions[1] applies the 90% safety margin', () => {
    // otherMembersSalaryTotal=200, totalGroupSalaries=300, contribution=(100/300)*10000≈3333.33
    // → invalid. maxSafeBudget = floor(300 * 0.9) = 270 → suggestions[1] mentions 270.
    const result = calculateUserContribution(100, 10000, [{ id: 'b', salary: 200 }])
    expect(result.isValid).toBe(false)
    expect(result.suggestions).toHaveLength(3)
    expect(result.suggestions?.[1]).toMatch(/270/) // 90% safety margin path (line 100)
  })
})

describe('calculateAmountToFund', () => {
  it('budget − revenus du groupe, miroir de contribution_base dans la RPC', () => {
    expect(calculateAmountToFund(4335.43, 152)).toBeCloseTo(4183.43, 2)
    expect(calculateAmountToFund(1200)).toBe(1200) // revenus absents → 0
  })

  it('clampé à 0 quand les revenus couvrent tout le budget (personne ne cotise)', () => {
    expect(calculateAmountToFund(500, 800)).toBe(0)
  })
})

describe('calculateUserContribution — revenus du groupe déduits', () => {
  // Cas prod 2026-09-30 : budget 4 335,43 €, CAF 152 €, salaires 2 752,08 / 1 850.
  // Montants attendus = ceux écrits par la RPC dans group_contributions.
  const budget = 4335.43
  const income = 152

  it('répartit le reste à financer au prorata des salaires (valeurs de la RPC)', () => {
    const gilles = calculateUserContribution(2752.08, budget, [{ id: 'b', salary: 1850 }], income)
    const berengere = calculateUserContribution(
      1850,
      budget,
      [{ id: 'g', salary: 2752.08 }],
      income,
    )

    expect(gilles.userContribution).toBeCloseTo(2501.72, 2)
    expect(berengere.userContribution).toBeCloseTo(1681.71, 2)
    // Même effort relatif pour chacun : 90,9 % du salaire.
    expect(gilles.userPercentage).toBeCloseTo(90.9, 1)
    expect(berengere.userPercentage).toBeCloseTo(90.9, 1)
    // Les contributions financent exactement budget − revenus.
    expect(gilles.userContribution + berengere.userContribution).toBeCloseTo(budget - income, 2)
  })

  it('revenus ≥ budget → contribution 0, valide', () => {
    const result = calculateUserContribution(1000, 300, [{ id: 'b', salary: 1000 }], 400)
    expect(result.userContribution).toBe(0)
    expect(result.isValid).toBe(true)
  })

  it('partage égal (aucun salaire) appliqué au reste à financer', () => {
    const result = calculateUserContribution(0, 300, [{ id: 'b', salary: 0 }], 100)
    expect(result.userContribution).toBe(100)
  })

  it('budget max suggéré = salaires + revenus du groupe', () => {
    // Seul membre : 1 400 € à financer > 1 300 € de salaire → budget max 1 300 + 600.
    const solo = calculateUserContribution(1300, 2000, [], 600)
    expect(solo.isValid).toBe(false)
    expect(solo.userContribution).toBe(1400)
    expect(solo.suggestions?.[1]).toMatch(/1\s*900/)

    // Avec un autre salaire : marge 90 % sur les salaires, revenus ajoutés tels quels.
    // floor((100 + 200) × 0.9 + 50) = 320.
    const withOthers = calculateUserContribution(100, 10000, [{ id: 'b', salary: 200 }], 50)
    expect(withOthers.suggestions?.[1]).toMatch(/320/)
  })
})

describe('formatCurrency', () => {
  it('formats integers in fr-FR EUR style, rounded to 0 decimals', () => {
    // fr-FR locale uses narrow no-break space (U+202F) for thousands and
    // before currency symbol in modern Node ICU — `\s?` in the regex tolerates
    // both regular space and narrow no-break space across runtimes.
    expect(formatCurrency(1234.56)).toMatch(/1\s*235\s*€/)
    expect(formatCurrency(0)).toMatch(/0\s*€/)
  })
})

describe('formatPercentage', () => {
  it('formats fr-FR percent with 1 decimal, dividing input by 100', () => {
    // Input is interpreted as percent (15 → 15,0%, not 1500%) per impl:
    // `format(percentage / 100)`. fr-FR uses comma separator + narrow space.
    expect(formatPercentage(15)).toMatch(/15,0\s*%/)
    expect(formatPercentage(7.5)).toMatch(/7,5\s*%/)
  })
})
