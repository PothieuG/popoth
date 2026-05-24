import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RecapSummary } from '@/lib/recap'

const transferMock = vi.fn()
const transformMock = vi.fn()
let transferPending = false
let transformPending = false

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useTransferSurplusesToPiggy: () => ({ mutateAsync: transferMock, isPending: transferPending }),
  useTransformRemainingSurplusesToSavings: () => ({
    mutateAsync: transformMock,
    isPending: transformPending,
  }),
}))

import { BilanPositiveStep } from '../steps/BilanPositiveStep'

function makeSummary(overrides: Partial<RecapSummary> = {}): RecapSummary {
  return {
    currentBalance: 1500,
    ravEstime: 800,
    ravEffectif: 950,
    totalSurplus: 230,
    totalSavings: 100,
    piggyAmount: 50,
    bilan: 150,
    bilanSign: 'positive',
    budgets: [
      {
        budgetId: 'b1',
        budgetName: 'Courses',
        estimatedAmount: 400,
        spentThisMonth: 280,
        cumulatedSavings: 25,
        surplus: 120,
        deficit: 0,
      },
      {
        budgetId: 'b2',
        budgetName: 'Loisirs',
        estimatedAmount: 100,
        spentThisMonth: 40,
        cumulatedSavings: 0,
        surplus: 60,
        deficit: 0,
      },
      {
        budgetId: 'b3',
        budgetName: 'Transport',
        estimatedAmount: 80,
        spentThisMonth: 30,
        cumulatedSavings: 10,
        surplus: 50,
        deficit: 0,
      },
    ],
    ...overrides,
  }
}

const emptySurplusSummary = makeSummary({
  totalSurplus: 0,
  bilan: 0,
  bilanSign: 'zero',
  budgets: [
    {
      budgetId: 'b1',
      budgetName: 'Courses',
      estimatedAmount: 200,
      spentThisMonth: 200,
      cumulatedSavings: 0,
      surplus: 0,
      deficit: 0,
    },
  ],
})

beforeEach(() => {
  transferMock.mockReset()
  transformMock.mockReset()
  transferPending = false
  transformPending = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('BilanPositiveStep', () => {
  describe('with surplus', () => {
    it('renders the indicative section with old → new (+delta) per budget', () => {
      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)

      expect(screen.getByText('Économies après transformation')).toBeInTheDocument()
      // Each budget row shows : old € → new € (+delta €)
      //   Courses :   25,00 € → 145,00 € (+120,00 €)
      //   Loisirs :    0,00 € →  60,00 € (+60,00 €)
      //   Transport : 10,00 € →  60,00 € (+50,00 €)
      expect(screen.getByText('Courses')).toBeInTheDocument()
      expect(screen.getByText('Loisirs')).toBeInTheDocument()
      expect(screen.getByText('Transport')).toBeInTheDocument()

      // Unique amounts surface once each :
      //   25,00 (Courses old), 145,00 (Courses new), +120,00 (Courses delta),
      //   0,00 (Loisirs old), 10,00 (Transport old), +50,00 (Transport delta)
      expect(screen.getByText(/25,00/)).toBeInTheDocument()
      expect(screen.getByText(/145,00/)).toBeInTheDocument()
      expect(screen.getByText(/\+120,00/)).toBeInTheDocument()
      expect(screen.getByText(/\+50,00/)).toBeInTheDocument()
      // 60,00 appears 3 times (Loisirs new, Loisirs delta, Transport new).
      expect(screen.getAllByText(/60,00/)).toHaveLength(3)

      // Arrow separator present per budget row (3 budgets → 3 arrows)
      expect(screen.getAllByText('→')).toHaveLength(3)
    })

    it('renders both the persistent "Répartir" button and the "Continuer" button', () => {
      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)

      expect(
        screen.getByRole('button', { name: 'Répartir un surplus vers la tirelire ?' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument()
    })

    it('opens the drawer when "Répartir" is clicked', async () => {
      const user = userEvent.setup()
      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)

      await user.click(
        screen.getByRole('button', { name: 'Répartir un surplus vers la tirelire ?' }),
      )

      expect(screen.getByRole('heading', { name: 'Répartir vers la tirelire' })).toBeInTheDocument()
    })

    it('"Répartir" button remains visible after the user closes the drawer without transferring', async () => {
      const user = userEvent.setup()
      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)

      await user.click(
        screen.getByRole('button', { name: 'Répartir un surplus vers la tirelire ?' }),
      )
      // User mis-clicks Fermer
      await user.click(screen.getByRole('button', { name: 'Fermer' }))

      // The key UX guarantee : the "Répartir" button must still be there so
      // the user can re-open the drawer.
      expect(
        screen.getByRole('button', { name: 'Répartir un surplus vers la tirelire ?' }),
      ).toBeInTheDocument()
      // Drawer should be unmounted
      expect(
        screen.queryByRole('heading', { name: 'Répartir vers la tirelire' }),
      ).not.toBeInTheDocument()
    })

    it('Continuer click calls transform mutation', async () => {
      const user = userEvent.setup()
      transformMock.mockResolvedValueOnce({})

      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)
      await user.click(screen.getByRole('button', { name: 'Continuer' }))

      await waitFor(() => {
        expect(transformMock).toHaveBeenCalledTimes(1)
      })
      expect(transferMock).not.toHaveBeenCalled()
    })

    it('shows "Chargement…" + disables Continuer while transform mutation is pending', async () => {
      transformPending = true
      const user = userEvent.setup()

      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)

      const continueBtn = screen.getByRole('button', { name: 'Chargement…' })
      expect(continueBtn).toBeDisabled()

      // Répartir is also disabled to prevent a race (open drawer while
      // transform is in-flight).
      const repartirBtn = screen.getByRole('button', {
        name: 'Répartir un surplus vers la tirelire ?',
      })
      expect(repartirBtn).toBeDisabled()

      await user.click(repartirBtn)
      expect(
        screen.queryByRole('heading', { name: 'Répartir vers la tirelire' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('without surplus (bilanSign=zero edge case OR all transferred)', () => {
    it('shows "Aucun surplus" copy + only Continuer button (no Répartir)', () => {
      render(<BilanPositiveStep context="profile" summary={emptySurplusSummary} />)

      expect(screen.getByText('Aucun surplus à transformer.')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Répartir un surplus vers la tirelire ?' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument()
    })

    it('Continuer click calls transform mutation (no-op safe + advances step)', async () => {
      const user = userEvent.setup()
      transformMock.mockResolvedValueOnce({})

      render(<BilanPositiveStep context="profile" summary={emptySurplusSummary} />)
      await user.click(screen.getByRole('button', { name: 'Continuer' }))

      await waitFor(() => {
        expect(transformMock).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('drawer transfer interactions', () => {
    it('after PARTIAL transfer: drawer closes, "Répartir" still visible, list shows remaining surpluses', async () => {
      const user = userEvent.setup()
      transferMock.mockResolvedValueOnce({
        transferred: [{ budgetId: 'b2', amount: 60 }],
        failed: [],
        summary: makeSummary(),
      })

      const { rerender } = render(<BilanPositiveStep context="profile" summary={makeSummary()} />)
      await user.click(
        screen.getByRole('button', { name: 'Répartir un surplus vers la tirelire ?' }),
      )
      await user.click(screen.getByRole('button', { name: /Loisirs/ }))
      await user.click(screen.getByRole('button', { name: /Transférer.+60,00/ }))

      // Parent re-renders with Loisirs gone (the hook's setQueryData would
      // do this in the real app via TanStack Query; in tests we simulate
      // by passing a fresh summary prop).
      rerender(
        <BilanPositiveStep
          context="profile"
          summary={makeSummary({
            totalSurplus: 170,
            budgets: [
              {
                budgetId: 'b1',
                budgetName: 'Courses',
                estimatedAmount: 400,
                spentThisMonth: 280,
                cumulatedSavings: 25,
                surplus: 120,
                deficit: 0,
              },
              {
                budgetId: 'b3',
                budgetName: 'Transport',
                estimatedAmount: 80,
                spentThisMonth: 30,
                cumulatedSavings: 10,
                surplus: 50,
                deficit: 0,
              },
            ],
          })}
        />,
      )

      await waitFor(() => {
        // Drawer is closed
        expect(
          screen.queryByRole('heading', { name: 'Répartir vers la tirelire' }),
        ).not.toBeInTheDocument()
      })
      // The Répartir button is back, and Continuer is still there.
      expect(
        screen.getByRole('button', { name: 'Répartir un surplus vers la tirelire ?' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument()
      // Loisirs row is gone, Courses + Transport remain in the indicative list.
      expect(screen.queryByText('Loisirs')).not.toBeInTheDocument()
      expect(screen.getByText('Courses')).toBeInTheDocument()
      expect(screen.getByText('Transport')).toBeInTheDocument()
    })

    it('after FULL transfer: drawer closes, Répartir disappears, only Continuer left', async () => {
      const user = userEvent.setup()
      transferMock.mockResolvedValueOnce({
        transferred: [
          { budgetId: 'b1', amount: 120 },
          { budgetId: 'b2', amount: 60 },
          { budgetId: 'b3', amount: 50 },
        ],
        failed: [],
        summary: makeSummary(),
      })

      const { rerender } = render(<BilanPositiveStep context="profile" summary={makeSummary()} />)
      await user.click(
        screen.getByRole('button', { name: 'Répartir un surplus vers la tirelire ?' }),
      )
      await user.click(screen.getByRole('button', { name: /Courses/ }))
      await user.click(screen.getByRole('button', { name: /Transférer/ }))

      // Parent re-renders with all surpluses cleared.
      rerender(<BilanPositiveStep context="profile" summary={emptySurplusSummary} />)

      await waitFor(() => {
        expect(screen.getByText('Aucun surplus à transformer.')).toBeInTheDocument()
      })
      expect(
        screen.queryByRole('button', { name: 'Répartir un surplus vers la tirelire ?' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('renders alert with mapped copy when transform mutation rejects with invalid_step', async () => {
      const user = userEvent.setup()
      transformMock.mockRejectedValueOnce(new Error('invalid_step'))

      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)
      await user.click(screen.getByRole('button', { name: 'Continuer' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/Cette étape n'est plus accessible/)
      })
    })

    it('renders alert with generic copy when transform mutation rejects with unknown error', async () => {
      const user = userEvent.setup()
      transformMock.mockRejectedValueOnce(new Error('boom'))

      render(<BilanPositiveStep context="profile" summary={emptySurplusSummary} />)
      await user.click(screen.getByRole('button', { name: 'Continuer' }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/Une erreur est survenue/)
      })
    })

    it('renders alert with mapped copy when transfer mutation rejects with not_initiator', async () => {
      const user = userEvent.setup()
      transferMock.mockRejectedValueOnce(new Error('not_initiator'))

      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)
      await user.click(
        screen.getByRole('button', { name: 'Répartir un surplus vers la tirelire ?' }),
      )
      await user.click(screen.getByRole('button', { name: /Courses/ }))
      await user.click(screen.getByRole('button', { name: /Transférer/ }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/Tu n'es pas l'initiateur du récap/)
      })
    })
  })
})
