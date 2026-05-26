import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SavingsProjectMeta } from '@/lib/finance/types'
import type { RecapSummary } from '@/lib/recap'

const advanceMock = vi.fn()

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useAdvanceStep: () => ({ mutateAsync: advanceMock, isPending: false }),
}))

import { SummaryStep } from '../steps/SummaryStep'

function makeSummary(overrides: Partial<RecapSummary> = {}): RecapSummary {
  return {
    currentBalance: 1234.56,
    ravEstime: 800,
    ravEffectif: 750,
    totalSurplus: 195,
    totalSavings: 320,
    piggyAmount: 50,
    bilan: 100,
    bilanSign: 'positive',
    budgets: [
      {
        budgetId: 'b1',
        budgetName: 'Courses',
        estimatedAmount: 200,
        spentThisMonth: 150,
        cumulatedSavings: 80,
        carryoverSpentAmount: 0,
        surplus: 50,
        deficit: 0,
      },
      {
        budgetId: 'b2',
        budgetName: 'Loisirs',
        estimatedAmount: 100,
        spentThisMonth: 200,
        cumulatedSavings: 0,
        carryoverSpentAmount: 0,
        surplus: 0,
        deficit: 100,
      },
    ],
    savingsProjects: [],
    ...overrides,
  }
}

beforeEach(() => {
  advanceMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SummaryStep', () => {
  it('renders the 5 summary cards with formatted amounts', () => {
    render(<SummaryStep context="profile" summary={makeSummary()} />)

    expect(screen.getByText('Solde actuel')).toBeInTheDocument()
    // Intl.NumberFormat fr-FR uses U+202F (narrow no-break space) as thousands
    // separator on Node 20+ and U+00A0 (NBSP) before the currency symbol.
    // \s in JS regex matches both — keeps the assertion robust across ICU versions.
    expect(screen.getByText(/1\s234,56/)).toBeInTheDocument()

    expect(screen.getByText('Reste à vivre estimé')).toBeInTheDocument()
    expect(screen.getByText('Reste à vivre effectif')).toBeInTheDocument()

    expect(screen.getByText('Surplus total des budgets')).toBeInTheDocument()
    expect(screen.getByText(/195,00/)).toBeInTheDocument()

    expect(screen.getByText('Total des économies')).toBeInTheDocument()
    // totalSavings 320 + piggyAmount 50 = 370
    expect(screen.getByText(/370,00/)).toBeInTheDocument()
  })

  it('renders the BilanBlock matching the bilanSign', () => {
    const { rerender } = render(
      <SummaryStep
        context="profile"
        summary={makeSummary({ bilan: 200, bilanSign: 'positive' })}
      />,
    )
    expect(
      screen.getByText(/Vous allez pouvoir ajouter .+ à votre total d'économies/),
    ).toBeInTheDocument()

    rerender(
      <SummaryStep
        context="profile"
        summary={makeSummary({ bilan: -42, bilanSign: 'negative' })}
      />,
    )
    expect(screen.getByText(/L'objectif est de revenir à l'équilibre/)).toBeInTheDocument()

    rerender(
      <SummaryStep context="profile" summary={makeSummary({ bilan: 0, bilanSign: 'zero' })} />,
    )
    expect(screen.getByText(/Le mois est équilibré/)).toBeInTheDocument()
  })

  it('opens the surplus drawer on click and shows only budgets with surplus > 0', async () => {
    const user = userEvent.setup()
    render(<SummaryStep context="profile" summary={makeSummary()} />)

    const surplusCard = screen.getByText('Surplus total des budgets').closest('div')!
    const detailBtn = surplusCard.querySelector('button')!
    await user.click(detailBtn)

    expect(await screen.findByRole('heading', { name: 'Surplus par budget' })).toBeInTheDocument()
    expect(screen.getByText('Courses')).toBeInTheDocument()
    expect(screen.queryByText('Loisirs')).not.toBeInTheDocument()
  })

  it('opens the savings drawer with Tirelire line and budgets with cumulated_savings > 0', async () => {
    const user = userEvent.setup()
    render(<SummaryStep context="profile" summary={makeSummary()} />)

    const savingsCard = screen.getByText('Total des économies').closest('div')!
    const detailBtn = savingsCard.querySelector('button')!
    await user.click(detailBtn)

    expect(await screen.findByRole('heading', { name: 'Détail des économies' })).toBeInTheDocument()
    expect(screen.getByText('Tirelire')).toBeInTheDocument()
    expect(screen.getByText('Courses')).toBeInTheDocument()
    expect(screen.queryByText('Loisirs')).not.toBeInTheDocument()
  })

  it('on Étape suivante click, calls /advance-step(summary → manage_bilan)', async () => {
    const user = userEvent.setup()
    advanceMock.mockResolvedValueOnce({})

    render(<SummaryStep context="profile" summary={makeSummary()} />)
    await user.click(screen.getByRole('button', { name: 'Étape suivante' }))

    await waitFor(() => {
      expect(advanceMock).toHaveBeenCalledWith({ fromStep: 'summary', toStep: 'manage_bilan' })
    })
  })

  it('swallows stale_step / invalid_step from advance mutation (hook re-routes, no alert)', async () => {
    const user = userEvent.setup()
    advanceMock.mockRejectedValueOnce(new Error('stale_step'))

    render(<SummaryStep context="profile" summary={makeSummary()} />)
    await user.click(screen.getByRole('button', { name: 'Étape suivante' }))

    await waitFor(() => {
      expect(advanceMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows error message when advance mutation fails with an unmapped code', async () => {
    const user = userEvent.setup()
    advanceMock.mockRejectedValueOnce(new Error('boom'))

    render(<SummaryStep context="profile" summary={makeSummary()} />)
    await user.click(screen.getByRole('button', { name: 'Étape suivante' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Impossible de passer à l'étape suivante/)
    })
  })

  // Sprint Projets-Épargne 07 — "Projets en cours" line + drawer.

  function makeProject(overrides: Partial<SavingsProjectMeta>): SavingsProjectMeta {
    return {
      id: 'p1',
      name: 'Japon',
      monthlyAllocation: 200,
      amountSaved: 4084,
      targetAmount: 7000,
      deadlineDate: '2027-12-31',
      monthsRemaining: 19,
      ...overrides,
    }
  }

  it('does NOT render the "Projets en cours" line when savingsProjects is empty', () => {
    render(<SummaryStep context="profile" summary={makeSummary({ savingsProjects: [] })} />)
    expect(screen.queryByText(/projet en cours/)).not.toBeInTheDocument()
    expect(screen.queryByText(/projets en cours/)).not.toBeInTheDocument()
  })

  it('renders "1 projet en cours" (singular) when summary has exactly 1 project', () => {
    render(
      <SummaryStep
        context="profile"
        summary={makeSummary({ savingsProjects: [makeProject({})] })}
      />,
    )
    expect(screen.getByRole('button', { name: /1 projet en cours/ })).toBeInTheDocument()
  })

  it('renders "N projets en cours" (plural) and opens the drawer on click', async () => {
    const user = userEvent.setup()
    render(
      <SummaryStep
        context="profile"
        summary={makeSummary({
          savingsProjects: [
            makeProject({ id: 'p1', name: 'Japon' }),
            makeProject({ id: 'p2', name: 'Voiture', amountSaved: 320, targetAmount: 1500 }),
          ],
        })}
      />,
    )

    const trigger = screen.getByRole('button', { name: /2 projets en cours/ })
    expect(trigger).toBeInTheDocument()

    // Drawer is not in the DOM before click (lazy-mounted).
    expect(screen.queryByRole('heading', { name: 'Projets en cours' })).not.toBeInTheDocument()

    await user.click(trigger)

    expect(await screen.findByRole('heading', { name: 'Projets en cours' })).toBeInTheDocument()
    expect(screen.getByText('Japon')).toBeInTheDocument()
    expect(screen.getByText('Voiture')).toBeInTheDocument()
  })
})
