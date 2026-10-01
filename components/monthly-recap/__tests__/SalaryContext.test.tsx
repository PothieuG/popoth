import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RecapSummary } from '@/lib/recap'

// Sprint Salary-Reception (2026-10-02) — le récap doit faire COMPRENDRE un
// solde élevé à côté d'un reste à vivre faible : contribution au groupe déjà
// déduite, salaire du mois suivant déjà dans le solde. Écrans « Récap
// général » (étape 3) et « Récapitulatif final » (étape 6).

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useAdvanceStep: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCompleteRecap: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 'p1', salary: 2752.08 } }),
}))
vi.mock('@/hooks/useGroupContributions', () => ({
  useGroupContributions: () => ({ contributions: [], isLoading: false, error: null }),
}))

import { FinalRecapStep } from '../steps/FinalRecapStep'
import { SummaryStep } from '../steps/SummaryStep'

function makeSummary(overrides: Partial<RecapSummary> = {}): RecapSummary {
  return {
    currentBalance: 3042.7,
    ravEstime: 2325.08,
    ravEffectif: -56.37,
    totalSurplus: 11.11,
    totalSavings: 0,
    piggyAmount: 0,
    bilan: -56.37,
    bilanSign: 'negative',
    budgets: [],
    savingsProjects: [],
    ...overrides,
  }
}

const CONTRIBUTION = { label: 'Contribution au groupe Famille Pothieu', amount: 2501.72 }
const RECEPTION = {
  received: 2760.18,
  expected: 2752.08,
  delta: 8.1,
  fundedMonth: { month: 10, year: 2026 },
}

describe('SummaryStep — contribution et salaire reçu en avance', () => {
  it('sans ces données : aucune carte ni mention en plus', () => {
    render(<SummaryStep context="profile" summary={makeSummary()} />)

    expect(screen.queryByText(/Contribution au groupe/)).toBeNull()
    expect(screen.queryByText('Salaire reçu en avance')).toBeNull()
    expect(screen.queryByText(/Avant contribution/)).toBeNull()
  })

  it('contribution : montant affiché, annoncé comme déjà déduit du reste à vivre effectif', () => {
    render(
      <SummaryStep context="profile" summary={makeSummary({ groupContribution: CONTRIBUTION })} />,
    )

    expect(screen.getByText('Contribution au groupe Famille Pothieu')).toBeInTheDocument()
    expect(screen.getByText(/2\s501,72/)).toBeInTheDocument()
    expect(screen.getByText('Déjà déduite du reste à vivre effectif.')).toBeInTheDocument()
    // Le reste à vivre ESTIMÉ, lui, ne la déduit pas : on le dit.
    expect(screen.getByText('Avant contribution au groupe.')).toBeInTheDocument()
  })

  it('salaire reçu en avance : dans le solde, hors bilan, écart reporté sur le mois financé', () => {
    render(<SummaryStep context="profile" summary={makeSummary({ salaryReception: RECEPTION })} />)

    expect(screen.getByText('Salaire reçu en avance')).toBeInTheDocument()
    expect(screen.getByText(/2\s760,18/)).toBeInTheDocument()
    const note = screen.getByText(/Compris dans le solde/)
    expect(note).toHaveTextContent(/Il finance octobre : il n'entre pas dans ce bilan/)
    expect(note).toHaveTextContent(/8,10\s€ de plus que prévu, ajoutés au reste à vivre d'octobre/)
  })

  it('salaire reçu inférieur au prévu : écart retiré du mois financé', () => {
    render(
      <SummaryStep
        context="profile"
        summary={makeSummary({ salaryReception: { ...RECEPTION, received: 2700, delta: -52.08 } })}
      />,
    )

    expect(screen.getByText(/Compris dans le solde/)).toHaveTextContent(
      /52,08\s€ de moins que prévu, retirés du reste à vivre d'octobre/,
    )
  })

  it('salaire reçu conforme : pas de phrase d’écart', () => {
    render(
      <SummaryStep
        context="profile"
        summary={makeSummary({ salaryReception: { ...RECEPTION, received: 2752.08, delta: 0 } })}
      />,
    )

    expect(screen.getByText(/Compris dans le solde/)).not.toHaveTextContent(/que prévu/)
  })
})

describe('FinalRecapStep — salaire du mois qui s’ouvre déjà reçu', () => {
  const baseProps = {
    context: 'profile' as const,
    recap: null,
    salaryUpdated: false,
    groupRecapPending: false,
    groupName: null,
  }

  it('sans réception : aucune mention', () => {
    render(<FinalRecapStep {...baseProps} summary={makeSummary()} />)

    expect(screen.queryByText(/déjà reçu/)).toBeNull()
  })

  it('avec réception : salaire du mois financé déjà reçu + écart', () => {
    render(<FinalRecapStep {...baseProps} summary={makeSummary({ salaryReception: RECEPTION })} />)

    expect(screen.getByText(/Salaire d'octobre déjà reçu/)).toBeInTheDocument()
    expect(screen.getByText(/2\s760,18/)).toBeInTheDocument()
    expect(
      screen.getByText(/par rapport au salaire prévu, ajoutés à votre reste à vivre d'octobre/),
    ).toHaveTextContent(/\+8,10/)
  })

  it('réception inférieure au prévu : écart retiré', () => {
    render(
      <FinalRecapStep
        {...baseProps}
        summary={makeSummary({ salaryReception: { ...RECEPTION, received: 2700, delta: -52.08 } })}
      />,
    )

    expect(
      screen.getByText(/par rapport au salaire prévu, retirés de votre reste à vivre d'octobre/),
    ).toHaveTextContent(/−52,08/)
  })
})
