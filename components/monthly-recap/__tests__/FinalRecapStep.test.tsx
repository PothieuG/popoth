import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RecapProgress } from '@/hooks/useMonthlyRecap'
import type { RecapSummary } from '@/lib/recap'

const completeMock = vi.fn()
let completePending = false

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useCompleteRecap: () => ({ mutateAsync: completeMock, isPending: completePending }),
}))

let mockProfile: { id: string; salary: number } | null = {
  id: '11111111-1111-4111-8111-111111111111',
  salary: 2450,
}
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: mockProfile }),
}))

let mockContributions: Array<{
  profile_id: string
  salary: number
  contribution_amount: number
  profile: { first_name: string; last_name: string } | null
}> = []
vi.mock('@/hooks/useGroupContributions', () => ({
  useGroupContributions: () => ({
    contributions: mockContributions,
    isLoading: false,
    error: null,
  }),
}))

import { FinalRecapStep } from '../steps/FinalRecapStep'

function makeSummary(overrides: Partial<RecapSummary> = {}): RecapSummary {
  return {
    currentBalance: 1500,
    ravEstime: 800,
    ravEffectif: 950,
    totalSurplus: 150,
    totalSavings: 200,
    piggyAmount: 0,
    bilan: 150,
    bilanSign: 'positive',
    budgets: [],
    savingsProjects: [],
    ...overrides,
  }
}

function makeRecap(overrides: Partial<RecapProgress> = {}): RecapProgress {
  return {
    id: 'recap-1',
    currentStep: 'final_recap',
    refloatedFromPiggy: 0,
    refloatedFromSavings: 0,
    snapshotData: null,
    piggyTransfersData: null,
    projectSnapshotData: null,
    ...overrides,
  }
}

beforeEach(() => {
  completeMock.mockReset()
  completePending = false
  mockProfile = { id: '11111111-1111-4111-8111-111111111111', salary: 2450 }
  mockContributions = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('FinalRecapStep', () => {
  it('positive path: shows "transformé +X€ en économies"', () => {
    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary({ totalSurplus: 150, bilanSign: 'positive' })}
        recap={makeRecap()}
        salaryUpdated={false}
        groupRecapPending={false}
        groupName={null}
      />,
    )

    expect(screen.getByText(/Vous avez transformé/)).toBeInTheDocument()
    expect(screen.getByText(/\+150,00/)).toBeInTheDocument()
  })

  it('zero-surplus path: shows neutral "mois équilibré" copy', () => {
    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary({ totalSurplus: 0, bilan: 0, bilanSign: 'zero' })}
        recap={makeRecap()}
        salaryUpdated={false}
        groupRecapPending={false}
        groupName={null}
      />,
    )

    expect(screen.getByText(/mois est équilibré/)).toBeInTheDocument()
  })

  it('negative path: shows "renfloué votre déficit" with breakdown lines for each source > 0', () => {
    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary({ bilan: -150, bilanSign: 'negative', totalSurplus: 0 })}
        recap={makeRecap({
          refloatedFromPiggy: 50,
          refloatedFromSavings: 75,
          snapshotData: { b1: 15, b2: 10 },
        })}
        salaryUpdated={false}
        groupRecapPending={false}
        groupName={null}
      />,
    )

    expect(screen.getByText(/renfloué votre déficit/)).toBeInTheDocument()
    // total = 50 + 75 + 25 = 150,00. Use \b so "50,00" doesn't match "150,00".
    expect(screen.getByText(/\b150,00/)).toBeInTheDocument()
    expect(screen.getByText(/Via la tirelire/)).toBeInTheDocument()
    expect(screen.getByText(/\b50,00/)).toBeInTheDocument()
    expect(screen.getByText(/Via vos économies/)).toBeInTheDocument()
    expect(screen.getByText(/\b75,00/)).toBeInTheDocument()
    expect(screen.getByText(/Via puisage budgets/)).toBeInTheDocument()
    expect(screen.getByText(/\b25,00/)).toBeInTheDocument()
  })

  it('negative path: omits source lines that are zero', () => {
    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary({ bilan: -100, bilanSign: 'negative', totalSurplus: 0 })}
        recap={makeRecap({
          refloatedFromPiggy: 100,
          refloatedFromSavings: 0,
          snapshotData: null,
        })}
        salaryUpdated={false}
        groupRecapPending={false}
        groupName={null}
      />,
    )

    expect(screen.getByText(/Via la tirelire/)).toBeInTheDocument()
    expect(screen.queryByText(/Via vos économies/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Via puisage budgets/)).not.toBeInTheDocument()
  })

  it('cascade path (bilanSign=positive + refloats > 0): shows both phases', () => {
    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary({ totalSurplus: 50, bilanSign: 'positive' })}
        recap={makeRecap({ refloatedFromPiggy: 150 })}
        salaryUpdated={false}
        groupRecapPending={false}
        groupName={null}
      />,
    )

    expect(screen.getByText(/Renflouement initial/)).toBeInTheDocument()
    expect(screen.getByText(/Surplus transformé/)).toBeInTheDocument()
    expect(screen.getByText(/\+50,00/)).toBeInTheDocument()
    // 150,00 € appears twice : once in the total line, once in the
    // "Via la tirelire" breakdown row.
    expect(screen.getAllByText(/150,00/)).toHaveLength(2)
  })

  it('salaryUpdated=true in profile context: shows "Salaire mis à jour : X€"', () => {
    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary()}
        recap={makeRecap()}
        salaryUpdated={true}
        groupRecapPending={false}
        groupName={null}
      />,
    )
    expect(screen.getByText(/Salaire mis à jour/)).toBeInTheDocument()
    expect(screen.getByText(/2 450,00/)).toBeInTheDocument()
  })

  it('salaryUpdated=true in group context: shows "Contribution mise à jour" from useGroupContributions', () => {
    mockContributions = [
      {
        profile_id: '11111111-1111-4111-8111-111111111111',
        salary: 2450,
        contribution_amount: 1320,
        profile: { first_name: 'Alice', last_name: 'Martin' },
      },
    ]
    render(
      <FinalRecapStep
        context="group"
        summary={makeSummary()}
        recap={makeRecap()}
        salaryUpdated={true}
        groupRecapPending={false}
        groupName={null}
      />,
    )
    expect(screen.getByText(/Contribution mise à jour/)).toBeInTheDocument()
    expect(screen.getByText(/1 320,00/)).toBeInTheDocument()
  })

  it('clicking "Retourner au dashboard" fires the complete mutation', async () => {
    const user = userEvent.setup()
    completeMock.mockResolvedValueOnce({
      recapId: 'recap-1',
      completed: true,
      snapshotApplied: null,
      transactions: {
        deleted_expenses: 0,
        deleted_incomes: 0,
        carried_expenses: 0,
        carried_incomes: 0,
      },
    })

    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary()}
        recap={makeRecap()}
        salaryUpdated={false}
        groupRecapPending={false}
        groupName={null}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Retourner au dashboard' }))

    await waitFor(() => {
      expect(completeMock).toHaveBeenCalledTimes(1)
    })
  })

  it('renders "Finalisation…" + disabled button while complete mutation is pending', () => {
    completePending = true
    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary()}
        recap={makeRecap()}
        salaryUpdated={false}
        groupRecapPending={false}
        groupName={null}
      />,
    )

    const btn = screen.getByRole('button', { name: 'Finalisation…' })
    expect(btn).toBeDisabled()
  })

  it('swallows stale_step / invalid_step from complete mutation (hook re-routes, no alert)', async () => {
    const user = userEvent.setup()
    completeMock.mockRejectedValueOnce(new Error('invalid_step'))

    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary()}
        recap={makeRecap()}
        salaryUpdated={false}
        groupRecapPending={false}
        groupName={null}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Retourner au dashboard' }))

    await waitFor(() => {
      expect(completeMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces role="alert" with generic copy when complete mutation rejects with an unmapped error', async () => {
    const user = userEvent.setup()
    completeMock.mockRejectedValueOnce(new Error('boom'))

    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary()}
        recap={makeRecap()}
        salaryUpdated={false}
        groupRecapPending={false}
        groupName={null}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Retourner au dashboard' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Une erreur est survenue/)
    })
  })

  it('handles a null recap prop gracefully (treats all refloats as 0)', () => {
    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary({ totalSurplus: 100, bilanSign: 'positive' })}
        recap={null}
        salaryUpdated={false}
        groupRecapPending={false}
        groupName={null}
      />,
    )
    // No refloats → falls through to positive summary
    expect(screen.getByText(/Vous avez transformé/)).toBeInTheDocument()
  })

  it('groupRecapPending=true + groupName: renders "Aller au recap du groupe « <name> »" button', () => {
    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary()}
        recap={makeRecap()}
        salaryUpdated={false}
        groupRecapPending={true}
        groupName="Famille Martin"
      />,
    )

    expect(
      screen.getByRole('button', { name: /Aller au recap du groupe « Famille Martin »/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retourner au dashboard' })).not.toBeInTheDocument()
  })

  it('groupRecapPending=true + null groupName: falls back to "Retourner au dashboard"', () => {
    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary()}
        recap={makeRecap()}
        salaryUpdated={false}
        groupRecapPending={true}
        groupName={null}
      />,
    )

    expect(screen.getByRole('button', { name: 'Retourner au dashboard' })).toBeInTheDocument()
  })

  it('groupRecapPending=true button still fires the complete mutation (wizard handles redirect)', async () => {
    const user = userEvent.setup()
    completeMock.mockResolvedValueOnce({ recapId: 'r1', completed: true })

    render(
      <FinalRecapStep
        context="profile"
        summary={makeSummary()}
        recap={makeRecap()}
        salaryUpdated={false}
        groupRecapPending={true}
        groupName="G"
      />,
    )

    await user.click(screen.getByRole('button', { name: /Aller au recap du groupe/ }))
    await waitFor(() => {
      expect(completeMock).toHaveBeenCalledTimes(1)
    })
  })
})
