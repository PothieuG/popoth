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
  describe('initial state (decided=null) with surplus', () => {
    it('renders the indicative section showing cumulatedSavings + surplus per budget', () => {
      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)

      // Section header
      expect(screen.getByText('Transformation surplus → économies')).toBeInTheDocument()

      // Each budget row shows the post-transformation total :
      //   Courses : 25 + 120 = 145,00 €
      //   Loisirs :  0 + 60  =  60,00 €
      //   Transport : 10 + 50 = 60,00 €
      // Intl.NumberFormat fr-FR uses U+202F / U+00A0 — \s matches both.
      expect(screen.getByText('Courses')).toBeInTheDocument()
      expect(screen.getByText(/145,00/)).toBeInTheDocument()
      // 60,00 appears twice (Loisirs + Transport) — assert via length to keep it tight.
      expect(screen.getAllByText(/60,00/)).toHaveLength(2)
    })

    it('renders the Oui/Non question with both buttons', () => {
      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)

      expect(
        screen.getByText('Voulez-vous ajouter un ou plusieurs surplus à la tirelire ?'),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Oui' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Non' })).toBeInTheDocument()
    })
  })

  describe('decided=null without surplus (bilanSign=zero edge case)', () => {
    it('shows "Aucun surplus" copy and a direct Continuer button (no Oui/Non question)', () => {
      render(<BilanPositiveStep context="profile" summary={emptySurplusSummary} />)

      expect(screen.getByText('Aucun surplus à transformer ce mois-ci.')).toBeInTheDocument()
      expect(screen.queryByText(/Voulez-vous ajouter/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Oui' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument()
    })

    it('calls transform mutation on direct Continuer click', async () => {
      const user = userEvent.setup()
      transformMock.mockResolvedValueOnce({})

      render(<BilanPositiveStep context="profile" summary={emptySurplusSummary} />)
      await user.click(screen.getByRole('button', { name: 'Continuer' }))

      await waitFor(() => {
        expect(transformMock).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('decided=no flow', () => {
    it('reveals "Transformer tous les surplus en économies" after Non click', async () => {
      const user = userEvent.setup()
      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)

      await user.click(screen.getByRole('button', { name: 'Non' }))

      expect(
        screen.getByRole('button', { name: 'Transformer tous les surplus en économies' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Oui' })).not.toBeInTheDocument()
    })

    it('on click "Transformer tous", calls transform mutation', async () => {
      const user = userEvent.setup()
      transformMock.mockResolvedValueOnce({})

      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)
      await user.click(screen.getByRole('button', { name: 'Non' }))
      await user.click(
        screen.getByRole('button', { name: 'Transformer tous les surplus en économies' }),
      )

      await waitFor(() => {
        expect(transformMock).toHaveBeenCalledTimes(1)
      })
      expect(transferMock).not.toHaveBeenCalled()
    })

    it('shows "Transformation…" label after Non click while transform mutation is pending', async () => {
      // Set pending=true BEFORE render so the hook closure picks it up on
      // first call. Clicking Non triggers a re-render but the mock keeps
      // returning isPending=true.
      transformPending = true
      const user = userEvent.setup()

      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)
      await user.click(screen.getByRole('button', { name: 'Non' }))

      expect(screen.getByRole('button', { name: 'Transformation…' })).toBeDisabled()
    })
  })

  describe('decided=yes flow', () => {
    it('opens the drawer on Oui click', async () => {
      const user = userEvent.setup()
      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)

      await user.click(screen.getByRole('button', { name: 'Oui' }))

      expect(
        screen.getByRole('heading', { name: 'Sélectionner les surplus à transférer' }),
      ).toBeInTheDocument()
    })

    it('after partial transfer: drawer closes + "Transformer les surplus restants" + "Sélectionner d\'autres surplus" link', async () => {
      const user = userEvent.setup()
      transferMock.mockResolvedValueOnce({
        transferred: [{ budgetId: 'b2', amount: 60 }],
        failed: [],
        // The mutation `setQueryData` is applied in the hook (mocked away here)
        // so the local `summary` prop stays the same. The component routes by
        // its own state — we just check the post-success UI.
        summary: makeSummary(),
      })

      const { rerender } = render(<BilanPositiveStep context="profile" summary={makeSummary()} />)
      await user.click(screen.getByRole('button', { name: 'Oui' }))
      await user.click(screen.getByRole('button', { name: /Loisirs/ }))
      await user.click(screen.getByRole('button', { name: /Transférer.+60,00/ }))

      // Simulate parent re-render after the partial transfer (Loisirs gone,
      // 2 surpluses left).
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
        expect(
          screen.getByRole('button', { name: 'Transformer les surplus restants en économies' }),
        ).toBeInTheDocument()
      })
      expect(
        screen.getByRole('button', { name: "Sélectionner d'autres surplus" }),
      ).toBeInTheDocument()
      // Drawer must be unmounted
      expect(
        screen.queryByRole('heading', { name: 'Sélectionner les surplus à transférer' }),
      ).not.toBeInTheDocument()
    })

    it('after full transfer: shows "Plus de surplus disponible" + Continuer button', async () => {
      const user = userEvent.setup()
      transferMock.mockResolvedValueOnce({
        transferred: [{ budgetId: 'b1', amount: 120 }],
        failed: [],
        summary: makeSummary(),
      })

      const { rerender } = render(<BilanPositiveStep context="profile" summary={makeSummary()} />)
      await user.click(screen.getByRole('button', { name: 'Oui' }))
      await user.click(screen.getByRole('button', { name: /Courses/ }))
      await user.click(screen.getByRole('button', { name: /Transférer/ }))

      // Simulate parent re-render with all surpluses cleared.
      rerender(<BilanPositiveStep context="profile" summary={emptySurplusSummary} />)

      await waitFor(() => {
        expect(screen.getByText('Plus de surplus disponible.')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument()
    })

    it('"Sélectionner d\'autres surplus" link re-opens the drawer', async () => {
      const user = userEvent.setup()
      transferMock.mockResolvedValueOnce({
        transferred: [{ budgetId: 'b2', amount: 60 }],
        failed: [],
        summary: makeSummary(),
      })

      const { rerender } = render(<BilanPositiveStep context="profile" summary={makeSummary()} />)
      await user.click(screen.getByRole('button', { name: 'Oui' }))
      await user.click(screen.getByRole('button', { name: /Loisirs/ }))
      await user.click(screen.getByRole('button', { name: /Transférer/ }))

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

      const reopenLink = await screen.findByRole('button', {
        name: "Sélectionner d'autres surplus",
      })
      await user.click(reopenLink)

      expect(
        screen.getByRole('heading', { name: 'Sélectionner les surplus à transférer' }),
      ).toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('renders alert with mapped copy when transform mutation rejects with invalid_step', async () => {
      const user = userEvent.setup()
      transformMock.mockRejectedValueOnce(new Error('invalid_step'))

      render(<BilanPositiveStep context="profile" summary={makeSummary()} />)
      await user.click(screen.getByRole('button', { name: 'Non' }))
      await user.click(
        screen.getByRole('button', { name: 'Transformer tous les surplus en économies' }),
      )

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
      await user.click(screen.getByRole('button', { name: 'Oui' }))
      await user.click(screen.getByRole('button', { name: /Courses/ }))
      await user.click(screen.getByRole('button', { name: /Transférer/ }))

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/Tu n'es pas l'initiateur du récap/)
      })
    })
  })
})
