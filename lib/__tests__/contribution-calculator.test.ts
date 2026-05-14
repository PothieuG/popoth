import { describe, it, expect } from 'vitest'
import {
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
