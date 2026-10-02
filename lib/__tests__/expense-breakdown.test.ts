import { describe, it, expect } from 'vitest'
import {
  autoCoverOverflow,
  calculateBreakdown,
  calculateBreakdownWithCoverage,
  coverageTotal,
  EMPTY_COVERAGE,
  findCoverageIssue,
  shrinkCoverage,
  type BudgetSavingsSource,
} from '@/lib/expense-breakdown'

/**
 * Pure-unit tests de la couverture du dépassement (Sprint
 * Expense-Overflow-Coverage 2026-10-02). Companion to
 * `expense-allocation.test.ts` which covers `calculateBreakdown`.
 *
 *   1. Local: savings du destination puis budget (P5 toggle ON).
 *   2. Dépassement → couvert par la couverture choisie (ou proposée par
 *      « Répartir automatiquement » : tirelire puis prorata des économies).
 *   3. Résidu non couvert → absorbé par fromBudget (déficit, reste à vivre).
 */

/** Ancienne cascade automatique = couverture proposée par le bouton. */
function autoCascade(
  amount: number,
  budgetRemaining: number,
  savingsAvailable: number,
  piggyAvailable: number,
  others: ReadonlyArray<BudgetSavingsSource>,
) {
  const { overflow } = calculateBreakdown(amount, budgetRemaining, savingsAvailable, {
    useSavingsToggle: true,
  })
  return calculateBreakdownWithCoverage(
    amount,
    budgetRemaining,
    savingsAvailable,
    autoCoverOverflow(overflow, piggyAvailable, others),
  )
}

describe('autoCoverOverflow (bouton « Répartir automatiquement »)', () => {
  it('pas d’overflow (couvert par budget + savings local) → retour P5 standard, cascade vide', () => {
    const result = autoCascade(50, 100, 0, 200, [{ budget_id: 'A', available: 100 }])
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 0,
      fromBudget: 50,
      overflow: 0,
      crossBudgetDebits: [],
    })
  })

  it('overflow couvert intégralement par la tirelire → pas de cross-budget', () => {
    const result = autoCascade(100, 20, 30, 100, [{ budget_id: 'A', available: 200 }])
    expect(result).toEqual({
      fromPiggyBank: 50,
      fromBudgetSavings: 30,
      fromBudget: 20,
      overflow: 0,
      crossBudgetDebits: [],
    })
  })

  it('tirelire partielle + 1 budget cross couvre le reste', () => {
    const result = autoCascade(100, 20, 30, 20, [{ budget_id: 'B', available: 50 }])
    expect(result).toEqual({
      fromPiggyBank: 20,
      fromBudgetSavings: 30,
      fromBudget: 20,
      overflow: 0,
      crossBudgetDebits: [{ budget_id: 'B', amount: 30 }],
    })
  })

  it('cascade proportionnelle 2 budgets (ratio 2:1 si available 100/50)', () => {
    const result = autoCascade(100, 0, 0, 0, [
      { budget_id: 'A', available: 100 },
      { budget_id: 'B', available: 50 },
    ])
    expect(result.fromPiggyBank).toBe(0)
    expect(result.fromBudgetSavings).toBe(0)
    expect(result.fromBudget).toBe(0)
    expect(result.overflow).toBe(0)
    expect(result.crossBudgetDebits).toEqual([
      { budget_id: 'A', amount: 66.67 },
      { budget_id: 'B', amount: 33.33 },
    ])
    const sum = result.crossBudgetDebits.reduce((s, d) => s + d.amount, 0)
    expect(sum).toBeCloseTo(100, 2)
  })

  it('drift d’arrondi cents — 3 budgets égaux → somme exacte = overflow', () => {
    const result = autoCascade(100, 0, 0, 0, [
      { budget_id: 'A', available: 100 },
      { budget_id: 'B', available: 100 },
      { budget_id: 'C', available: 100 },
    ])
    const sum = result.crossBudgetDebits.reduce((s, d) => s + d.amount, 0)
    expect(sum).toBe(100)
    expect(result.crossBudgetDebits).toHaveLength(3)
    const last = result.crossBudgetDebits[result.crossBudgetDebits.length - 1]
    expect(last?.amount).toBe(33.34)
  })

  it('tout réuni < overflow → fromBudget absorbe le résidu (déficit destination)', () => {
    const result = autoCascade(100, 0, 0, 10, [
      { budget_id: 'A', available: 20 },
      { budget_id: 'B', available: 20 },
    ])
    expect(result.fromPiggyBank).toBe(10)
    expect(result.fromBudgetSavings).toBe(0)
    expect(result.fromBudget).toBe(50)
    expect(result.overflow).toBe(0)
    expect(result.crossBudgetDebits).toEqual([
      { budget_id: 'A', amount: 20 },
      { budget_id: 'B', amount: 20 },
    ])
    const sumAll =
      result.fromPiggyBank +
      result.fromBudgetSavings +
      result.fromBudget +
      result.crossBudgetDebits.reduce((s, d) => s + d.amount, 0)
    expect(sumAll).toBe(100)
  })

  it('piggy = 0 et aucune source cross → tout overflow va sur fromBudget', () => {
    const result = autoCascade(100, 0, 0, 0, [])
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 0,
      fromBudget: 100,
      overflow: 0,
      crossBudgetDebits: [],
    })
  })

  it('filtre les budgets cross avec available = 0', () => {
    const result = autoCascade(100, 0, 0, 0, [
      { budget_id: 'A', available: 100 },
      { budget_id: 'B', available: 0 },
      { budget_id: 'C', available: 50 },
    ])
    expect(result.crossBudgetDebits.map((d) => d.budget_id)).toEqual(['A', 'C'])
  })

  it('invariant somme — quelque soit le scénario, somme breakdown = amount', () => {
    const cases = [
      { args: [50, 100, 0, 200, [{ budget_id: 'A', available: 100 }]] as const },
      { args: [100, 20, 30, 100, [{ budget_id: 'A', available: 200 }]] as const },
      { args: [100, 20, 30, 20, [{ budget_id: 'B', available: 50 }]] as const },
      {
        args: [
          100,
          0,
          0,
          0,
          [
            { budget_id: 'A', available: 100 },
            { budget_id: 'B', available: 50 },
          ],
        ] as const,
      },
      {
        args: [
          100,
          0,
          0,
          10,
          [
            { budget_id: 'A', available: 20 },
            { budget_id: 'B', available: 20 },
          ],
        ] as const,
      },
    ]
    for (const { args } of cases) {
      const [amount, budgetRemaining, savingsAvailable, piggyAvailable, others] = args
      const result = autoCascade(amount, budgetRemaining, savingsAvailable, piggyAvailable, others)
      const total =
        result.fromPiggyBank +
        result.fromBudgetSavings +
        result.fromBudget +
        result.crossBudgetDebits.reduce((s, d) => s + d.amount, 0)
      expect(total).toBeCloseTo(amount, 2)
      expect(result.overflow).toBe(0)
    }
  })
})

describe('calculateBreakdownWithCoverage', () => {
  it('sans couverture → tout le dépassement part en déficit (reste à vivre)', () => {
    expect(calculateBreakdownWithCoverage(150, 100, 20, EMPTY_COVERAGE)).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 20,
      fromBudget: 130,
      overflow: 0,
      crossBudgetDebits: [],
    })
  })

  it('couverture partielle → le reste non couvert va en déficit', () => {
    const result = calculateBreakdownWithCoverage(220, 100, 0, {
      piggy: 50,
      budgets: [{ budget_id: 'A', amount: 30 }],
    })
    expect(result).toEqual({
      fromPiggyBank: 50,
      fromBudgetSavings: 0,
      fromBudget: 140,
      overflow: 0,
      crossBudgetDebits: [{ budget_id: 'A', amount: 30 }],
    })
  })

  it('couverture complète → budget au plafond, aucun déficit', () => {
    const result = calculateBreakdownWithCoverage(120, 100, 0, {
      piggy: 5,
      budgets: [{ budget_id: 'A', amount: 15 }],
    })
    expect(result.fromBudget).toBe(100)
    expect(result.fromPiggyBank).toBe(5)
  })

  it('couverture plus grande que le dépassement → ramenée au dépassement', () => {
    const result = calculateBreakdownWithCoverage(110, 100, 0, {
      piggy: 20,
      budgets: [{ budget_id: 'A', amount: 20 }],
    })
    expect(result.fromPiggyBank).toBe(5)
    expect(result.crossBudgetDebits).toEqual([{ budget_id: 'A', amount: 5 }])
    expect(result.fromBudget).toBe(100)
  })

  it('pas de dépassement → la couverture est ignorée', () => {
    const result = calculateBreakdownWithCoverage(50, 100, 0, {
      piggy: 20,
      budgets: [{ budget_id: 'A', amount: 10 }],
    })
    expect(result).toEqual({
      fromPiggyBank: 0,
      fromBudgetSavings: 0,
      fromBudget: 50,
      overflow: 0,
      crossBudgetDebits: [],
    })
  })

  it('modification à la hausse : sources gardées, le supplément va en déficit', () => {
    // Ajout : 120 € sur 100 € restants, 20 € couverts par la tirelire.
    // Passage à 150 € : rien de plus n'est pris, 30 € de déficit.
    const result = calculateBreakdownWithCoverage(150, 100, 0, { piggy: 20, budgets: [] })
    expect(result.fromPiggyBank).toBe(20)
    expect(result.fromBudget).toBe(130)
  })
})

describe('shrinkCoverage', () => {
  it('sous la cible → inchangée (montants nuls retirés)', () => {
    expect(
      shrinkCoverage(
        {
          piggy: 10,
          budgets: [
            { budget_id: 'A', amount: 5 },
            { budget_id: 'B', amount: 0 },
          ],
        },
        50,
      ),
    ).toEqual({ piggy: 10, budgets: [{ budget_id: 'A', amount: 5 }] })
  })

  it('au-dessus de la cible → réduite au prorata, tirelire comprise', () => {
    const result = shrinkCoverage(
      {
        piggy: 60,
        budgets: [
          { budget_id: 'A', amount: 30 },
          { budget_id: 'B', amount: 10 },
        ],
      },
      50,
    )
    expect(result).toEqual({
      piggy: 30,
      budgets: [
        { budget_id: 'A', amount: 15 },
        { budget_id: 'B', amount: 5 },
      ],
    })
  })

  it('arrondi au centime : la somme vaut exactement la cible', () => {
    const result = shrinkCoverage(
      {
        piggy: 10,
        budgets: [
          { budget_id: 'A', amount: 10 },
          { budget_id: 'B', amount: 10 },
        ],
      },
      10,
    )
    expect(coverageTotal(result)).toBe(10)
  })

  it('cible nulle → plus rien de pris', () => {
    expect(shrinkCoverage({ piggy: 10, budgets: [{ budget_id: 'A', amount: 5 }] }, 0)).toEqual({
      piggy: 0,
      budgets: [],
    })
  })
})

describe('findCoverageIssue', () => {
  const others: BudgetSavingsSource[] = [
    { budget_id: 'A', available: 40 },
    { budget_id: 'B', available: 10 },
  ]

  it('couverture valide → aucun problème', () => {
    expect(
      findCoverageIssue({ piggy: 20, budgets: [{ budget_id: 'A', amount: 40 }] }, 60, 20, others),
    ).toBeNull()
  })

  it('tolère l’écart d’un centime', () => {
    expect(findCoverageIssue({ piggy: 20.01, budgets: [] }, 20, 20, others)).toBeNull()
  })

  it('budget inconnu (ou budget destination) → unknown-budget', () => {
    expect(
      findCoverageIssue({ piggy: 0, budgets: [{ budget_id: 'Z', amount: 1 }] }, 60, 0, others),
    ).toBe('unknown-budget')
  })

  it('même budget deux fois → duplicate-budget', () => {
    expect(
      findCoverageIssue(
        {
          piggy: 0,
          budgets: [
            { budget_id: 'A', amount: 1 },
            { budget_id: 'A', amount: 1 },
          ],
        },
        60,
        0,
        others,
      ),
    ).toBe('duplicate-budget')
  })

  it('plus que les économies du budget → budget-exceeds-available', () => {
    expect(
      findCoverageIssue({ piggy: 0, budgets: [{ budget_id: 'B', amount: 11 }] }, 60, 0, others),
    ).toBe('budget-exceeds-available')
  })

  it('plus que la tirelire → piggy-exceeds-available', () => {
    expect(findCoverageIssue({ piggy: 30, budgets: [] }, 60, 20, others)).toBe(
      'piggy-exceeds-available',
    )
  })

  it('plus que le dépassement → exceeds-overflow', () => {
    expect(
      findCoverageIssue({ piggy: 20, budgets: [{ budget_id: 'A', amount: 40 }] }, 50, 20, others),
    ).toBe('exceeds-overflow')
  })
})
