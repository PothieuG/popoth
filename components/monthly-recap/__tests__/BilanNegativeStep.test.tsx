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
let advancePending = false

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useRefloatFromPiggy: () => ({ mutateAsync: refloatPiggyMock, isPending: false }),
  useRefloatFromSavings: () => ({ mutateAsync: refloatSavingsMock, isPending: false }),
  useSaveBudgetSnapshot: () => ({ mutateAsync: saveSnapshotMock, isPending: false }),
  useAdvanceStep: () => ({ mutateAsync: advanceMock, isPending: advancePending }),
  useTransferSurplusesToPiggy: () => ({ mutateAsync: transferMock, isPending: false }),
  useTransformRemainingSurplusesToSavings: () => ({
    mutateAsync: transformMock,
    isPending: false,
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
    piggyTransfersData: null,
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
  advancePending = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('BilanNegativeStep', () => {
  describe('initial cascade gating', () => {
    it('renders header + deficit counter + 3 lines (piggy active, savings locked, snapshot locked)', () => {
      render(<BilanNegativeStep context="profile" summary={makeSummary()} recap={makeRecap()} />)

      expect(screen.getByRole('heading', { name: 'Gestion du déficit' })).toBeInTheDocument()
      const header = screen.getByText('Montant à renflouer :').parentElement!
      expect(header).toHaveTextContent(/100,00/)

      // Piggy is active (button "Renflouer X€" visible)
      expect(screen.getByRole('button', { name: /Renflouer/ })).toBeInTheDocument()

      // Savings is LOCKED (waiting copy, no button)
      expect(screen.getByText(/Disponible après avoir transféré la tirelire/)).toBeInTheDocument()

      // Snapshot is LOCKED (waiting copy)
      expect(
        screen.getByText(/Disponible après avoir épuisé la tirelire et les économies/),
      ).toBeInTheDocument()
    })

    it('savings unlocks when piggy is empty + has been used (refloatedFromPiggy > 0)', () => {
      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 0 })}
          recap={makeRecap({ refloatedFromPiggy: 50 })}
        />,
      )

      // Piggy done state
      expect(
        screen.getByText(/de la tirelire utilisée pour combler le déficit/),
      ).toBeInTheDocument()
      // Savings active (button visible)
      expect(screen.getByRole('button', { name: 'Transférer les économies' })).toBeInTheDocument()
      // Snapshot still locked
      expect(
        screen.getByText(/Disponible après avoir épuisé la tirelire et les économies/),
      ).toBeInTheDocument()
    })

    it('snapshot unlocks when both piggy and savings are empty', () => {
      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 0, totalSavings: 0 })}
          recap={makeRecap({ refloatedFromPiggy: 50, refloatedFromSavings: 25 })}
        />,
      )

      expect(
        screen.getByText(/de la tirelire utilisée pour combler le déficit/),
      ).toBeInTheDocument()
      expect(screen.getByText(/d'économies transférés vers le déficit/)).toBeInTheDocument()
      // Snapshot active
      expect(screen.getByRole('button', { name: 'Équilibrer' })).toBeInTheDocument()
    })

    it('savings stays empty (greyed "Pas d\'économies") when totalSavings was 0 from the start', () => {
      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 0, totalSavings: 0 })}
          recap={makeRecap({ refloatedFromPiggy: 50 })}
        />,
      )

      // Savings shows empty copy (no money was there to begin with, no transfer happened)
      expect(screen.getByText("Pas d'économies disponibles.")).toBeInTheDocument()
      // Snapshot active right away (both piggy + savings empty)
      expect(screen.getByRole('button', { name: 'Équilibrer' })).toBeInTheDocument()
    })
  })

  describe('deficit covered → "unneeded" cascade lines + Continuer', () => {
    it('piggy alone covers deficit with residual → piggy done (with residual), savings/snapshot unneeded, Continuer visible', () => {
      // Scenario: deficit 100, piggy was 150, refloated 100. Residual piggy 50.
      // Savings has 75€ (default makeSummary) but is not needed.
      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 50 })}
          recap={makeRecap({ refloatedFromPiggy: 100 })}
        />,
      )

      // Stays on BilanNegativeStep (no bascule)
      expect(screen.getByRole('heading', { name: 'Gestion du déficit' })).toBeInTheDocument()
      // Piggy done state visible
      expect(
        screen.getByText(/de la tirelire utilisée pour combler le déficit/),
      ).toBeInTheDocument()
      // Savings + Snapshot are both "unneeded" (deficit already covered)
      expect(screen.getAllByText(/Pas nécessaire — le déficit est déjà comblé/)).toHaveLength(2)
      // Continuer at the bottom
      expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument()
    })

    it('savings cover the deficit → snapshot is unneeded (greyed), Continuer visible', () => {
      // Scenario: deficit 100, piggy 0 from start, savings 100€ → full drain covers it.
      // After: piggyEmpty, savingsEmpty (drained to 0), refloatedFromSavings=100.
      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 0, totalSavings: 0 })}
          recap={makeRecap({ refloatedFromSavings: 100 })}
        />,
      )

      // Savings done state
      expect(screen.getByText(/d'économies transférés vers le déficit/)).toBeInTheDocument()
      // Snapshot is unneeded (deficit covered)
      expect(screen.getByText(/Pas nécessaire — le déficit est déjà comblé/)).toBeInTheDocument()
      // Snapshot button NOT visible (it's unneeded, not active)
      expect(screen.queryByRole('button', { name: 'Équilibrer' })).not.toBeInTheDocument()
      // Continuer visible
      expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument()
    })
  })

  describe('Continuer (deficit = 0 without bascule)', () => {
    it('renders Continuer button at the bottom + click calls advance-step', async () => {
      const user = userEvent.setup()
      advanceMock.mockResolvedValueOnce({})

      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 0, totalSavings: 0 })}
          recap={makeRecap({ refloatedFromPiggy: 0, refloatedFromSavings: 100 })}
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

    it('swallows invalid_step error gracefully (snapshot auto-advance race)', async () => {
      const user = userEvent.setup()
      advanceMock.mockRejectedValueOnce(new Error('invalid_step'))

      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 0, totalSavings: 0 })}
          recap={makeRecap({ snapshotData: { b1: 60, b2: 40 } })}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Continuer' }))

      await waitFor(() => {
        expect(advanceMock).toHaveBeenCalled()
      })
      // No alert should surface for invalid_step
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows mapped error copy when advance mutation rejects with a different code', async () => {
      const user = userEvent.setup()
      advanceMock.mockRejectedValueOnce(new Error('not_initiator'))

      render(
        <BilanNegativeStep
          context="profile"
          summary={makeSummary({ piggyAmount: 0, totalSavings: 0 })}
          recap={makeRecap({ refloatedFromSavings: 100 })}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Continuer' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/Tu n'es pas l'initiateur/)
      })
    })
  })

  describe('success snackbar', () => {
    it('shows a success snackbar after a successful piggy refloat', async () => {
      const user = userEvent.setup()
      refloatPiggyMock.mockResolvedValueOnce({})

      render(<BilanNegativeStep context="profile" summary={makeSummary()} recap={makeRecap()} />)
      await user.click(screen.getByRole('button', { name: /Renflouer/ }))

      const snackbar = await screen.findByRole('status')
      expect(snackbar).toHaveTextContent(/tirelire/)
      // Auto-dismiss timer behavior is covered by the inline `setTimeout` in
      // the component (matches ProfileSettingsCard pattern) — not tested here
      // because user-event + fake timers don't combine reliably in jsdom.
    })

    it('shows error alert when a refloat fails (no snackbar)', async () => {
      const user = userEvent.setup()
      refloatPiggyMock.mockRejectedValueOnce(new Error('piggy_insufficient'))

      render(<BilanNegativeStep context="profile" summary={makeSummary()} recap={makeRecap()} />)
      await user.click(screen.getByRole('button', { name: /Renflouer/ }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/tirelire n'a pas ce montant/)
      })
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })
})
