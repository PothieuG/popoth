import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RecapProgress } from '@/hooks/useMonthlyRecap'
import type { RecapSummary } from '@/lib/recap'

const refloatPiggyMock = vi.fn()
const refloatSavingsMock = vi.fn()
const saveSnapshotMock = vi.fn()
const advanceMock = vi.fn()
const transformMock = vi.fn()
const transferMock = vi.fn()
let refloatPiggyPending = false
let refloatSavingsPending = false
let saveSnapshotPending = false
let advancePending = false
let transformPending = false
let transferPending = false

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useRefloatFromPiggy: () => ({ mutateAsync: refloatPiggyMock, isPending: refloatPiggyPending }),
  useRefloatFromSavings: () => ({
    mutateAsync: refloatSavingsMock,
    isPending: refloatSavingsPending,
  }),
  useSaveBudgetSnapshot: () => ({ mutateAsync: saveSnapshotMock, isPending: saveSnapshotPending }),
  useAdvanceStep: () => ({ mutateAsync: advanceMock, isPending: advancePending }),
  useTransferSurplusesToPiggy: () => ({ mutateAsync: transferMock, isPending: transferPending }),
  useTransformRemainingSurplusesToSavings: () => ({
    mutateAsync: transformMock,
    isPending: transformPending,
  }),
}))

import { BilanNegativeStep } from '../steps/BilanNegativeStep'

function makeSummary(overrides: Partial<RecapSummary> = {}): RecapSummary {
  return {
    currentBalance: 1500,
    ravEstime: 800,
    ravEffectif: 700,
    totalSurplus: 0,
    totalSavings: 75,
    piggyAmount: 50,
    bilan: -100,
    bilanSign: 'negative',
    budgets: [
      {
        budgetId: 'b1',
        budgetName: 'Courses',
        estimatedAmount: 400,
        spentThisMonth: 350,
        cumulatedSavings: 75,
        carryoverSpentAmount: 33,
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
    ...overrides,
  }
}

function makeRecap(overrides: Partial<RecapProgress> = {}): RecapProgress {
  return {
    id: 'r1',
    currentStep: 'manage_bilan',
    refloatedFromPiggy: 0,
    refloatedFromSavings: 0,
    snapshotData: null,
    ...overrides,
  }
}

beforeEach(() => {
  refloatPiggyMock.mockReset()
  refloatSavingsMock.mockReset()
  saveSnapshotMock.mockReset()
  advanceMock.mockReset()
  transformMock.mockReset()
  transferMock.mockReset()
  refloatPiggyPending = false
  refloatSavingsPending = false
  saveSnapshotPending = false
  advancePending = false
  transformPending = false
  transferPending = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('BilanNegativeStep', () => {
  describe('nominal cascade flow', () => {
    it('renders the deficit header + all 3 lines when deficit > 0', () => {
      render(<BilanNegativeStep context="profile" summary={makeSummary()} recap={makeRecap()} />)

      expect(screen.getByRole('heading', { name: 'Gestion du déficit' })).toBeInTheDocument()
      // The deficit counter is the only <p class*="font-bold"> with 100,00 — scope by section.
      const header = screen.getByText('Montant à renflouer :').parentElement!
      expect(header).toHaveTextContent(/100,00/)

      // 3 lines present
      expect(screen.getByText('Tirelire')).toBeInTheDocument()
      expect(screen.getByText('Économies des budgets')).toBeInTheDocument()
      expect(screen.getByText('Puiser dans les budgets existants')).toBeInTheDocument()
    })

    it('recomputes the deficit live from recap trackers (piggy=30 already refloated)', () => {
      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary()}
          recap={makeRecap({ refloatedFromPiggy: 30 })}
        />,
      )

      // deficit = 100 - 30 - 0 - 0 = 70€
      expect(screen.getByText(/70,00 €/)).toBeInTheDocument()
    })

    it('disables piggy line when piggyAmount is 0 but keeps the savings + snapshot lines active', () => {
      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 0 })}
          recap={makeRecap()}
        />,
      )

      expect(screen.getByText("Pas d'argent dans la tirelire.")).toBeInTheDocument()
      // Savings line still active
      expect(
        screen.getByRole('button', { name: 'Transférer mes économies dans le déficit' }),
      ).toBeInTheDocument()
      // Snapshot line still active
      expect(
        screen.getByRole('button', {
          name: 'Puiser proportionnellement dans tous les budgets pour renflouer',
        }),
      ).toBeInTheDocument()
    })
  })

  describe('bascule positive (piggy alone covers deficit + residual)', () => {
    it('renders BilanPositiveStep synthetically when refloatedFromPiggy = |bilan| AND piggyAmount > 0 AND savings untouched', () => {
      // Scenario: original deficit 100, piggy was 150, refloated 100. Residual piggy 50, savings 0.
      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 50, totalSavings: 0 })}
          recap={makeRecap({ refloatedFromPiggy: 100 })}
        />,
      )

      // The positive step renders : look for its header.
      expect(screen.getByRole('heading', { name: 'Gestion du bilan positif' })).toBeInTheDocument()
      // The negative header is NOT rendered.
      expect(screen.queryByRole('heading', { name: 'Gestion du déficit' })).not.toBeInTheDocument()
    })

    it('does NOT bascule when savings have been touched (the simplified "Continuer" path applies instead)', () => {
      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 50, totalSavings: 0 })}
          recap={makeRecap({ refloatedFromPiggy: 50, refloatedFromSavings: 50 })}
        />,
      )

      // deficit = 100 - 50 - 50 = 0 → success branch
      expect(screen.getByRole('heading', { name: 'Gestion du déficit' })).toBeInTheDocument()
      expect(screen.getByText('Le déficit est comblé.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument()
    })
  })

  describe('deficit covered without bascule → manual Continuer', () => {
    it('renders success message + "Continuer" button when deficit = 0 (savings used)', () => {
      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 0, totalSavings: 0 })}
          recap={makeRecap({ refloatedFromPiggy: 0, refloatedFromSavings: 100 })}
        />,
      )

      expect(screen.getByText('Le déficit est comblé.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument()
    })

    it('Continuer click calls /advance-step manage_bilan → salary_update', async () => {
      const user = userEvent.setup()
      advanceMock.mockResolvedValueOnce({})

      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 0, totalSavings: 0 })}
          recap={makeRecap({ refloatedFromSavings: 100 })}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Continuer' }))

      await waitFor(() => {
        expect(advanceMock).toHaveBeenCalledWith({
          fromStep: 'manage_bilan',
          toStep: 'salary_update',
        })
      })
    })

    it('shows mapped error copy when advance mutation rejects with invalid_step', async () => {
      const user = userEvent.setup()
      advanceMock.mockRejectedValueOnce(new Error('invalid_step'))

      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 0, totalSavings: 0 })}
          recap={makeRecap({ refloatedFromSavings: 100 })}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Continuer' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/Cette étape n'est plus accessible/)
      })
    })
  })

  describe('error handling (cascade lines)', () => {
    it('renders the mapped alert when the piggy mutation rejects with piggy_insufficient', async () => {
      const user = userEvent.setup()
      refloatPiggyMock.mockRejectedValueOnce(new Error('piggy_insufficient'))

      render(<BilanNegativeStep context="profile" summary={makeSummary()} recap={makeRecap()} />)
      await user.click(screen.getByRole('button', { name: /Renflouer/ }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /La tirelire n'a pas ce montant disponible/,
        )
      })
    })
  })
})
