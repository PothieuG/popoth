/**
 * Sprint Complete-Month-Step (2026-05-29). Tests RTL pour le nouvel écran
 * inséré entre WelcomeStep (étape 1) et SummaryStep (étape 3) du wizard récap.
 *
 * Stratégie de mock :
 *   - `useAdvanceStep` mocké comme les autres tests d'étape.
 *   - `AddTransactionModal` + `TransactionTabsComponent` mockés en stubs qui
 *     rendent leurs props clés via `data-*` — on vérifie le câblage
 *     (defaultDate, dateMin/dateMax, readOnly, dateRange) sans dérouler tout
 *     le sous-arbre Dashboard qui dépend de useBudgets/useIncomes/etc.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const advanceMock = vi.fn()

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useAdvanceStep: () => ({ mutateAsync: advanceMock, isPending: false }),
}))

vi.mock('@/components/dashboard/AddTransactionModal', () => ({
  default: ({
    isOpen,
    onClose,
    defaultDate,
    dateMin,
    dateMax,
    context,
  }: {
    isOpen?: boolean
    onClose: () => void
    defaultDate?: string
    dateMin?: string
    dateMax?: string
    context?: string
  }) =>
    isOpen ? (
      <div
        data-testid="add-transaction-modal"
        data-context={context}
        data-default-date={defaultDate}
        data-date-min={dateMin}
        data-date-max={dateMax}
      >
        <button type="button" onClick={onClose}>
          Fermer modale stub
        </button>
      </div>
    ) : null,
}))

vi.mock('@/components/dashboard/TransactionTabsComponent', () => ({
  default: ({
    context,
    readOnly,
    dateRange,
  }: {
    context?: string
    readOnly?: boolean
    dateRange?: { startDate: string; endDate: string } | null
  }) => (
    <div
      data-testid="transaction-tabs"
      data-context={context}
      data-read-only={readOnly ? 'true' : 'false'}
      data-range-start={dateRange?.startDate ?? ''}
      data-range-end={dateRange?.endDate ?? ''}
    >
      Stub tabs
    </div>
  ),
}))

import { CompleteMonthStep } from '../steps/CompleteMonthStep'

beforeEach(() => {
  advanceMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('CompleteMonthStep', () => {
  it('renders title + explanation + Ajouter button + tabs + Continuer button', () => {
    render(<CompleteMonthStep context="profile" recapYear={2026} recapMonth={5} />)

    expect(screen.getByRole('heading', { name: 'Compléter le mois' })).toBeInTheDocument()
    expect(screen.getByText(/Avant de continuer/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ajouter une transaction/ })).toBeInTheDocument()
    expect(screen.getByTestId('transaction-tabs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument()
  })

  it('passes readOnly + dateRange of the recapped month to the tabs', () => {
    render(<CompleteMonthStep context="profile" recapYear={2026} recapMonth={5} />)

    const tabs = screen.getByTestId('transaction-tabs')
    expect(tabs).toHaveAttribute('data-read-only', 'true')
    expect(tabs).toHaveAttribute('data-context', 'profile')
    expect(tabs).toHaveAttribute('data-range-start', '2026-05-01')
    // May has 31 days
    expect(tabs).toHaveAttribute('data-range-end', '2026-05-31')
  })

  it('computes the last day of February correctly (28 days non-leap)', () => {
    render(<CompleteMonthStep context="profile" recapYear={2026} recapMonth={2} />)

    const tabs = screen.getByTestId('transaction-tabs')
    expect(tabs).toHaveAttribute('data-range-start', '2026-02-01')
    expect(tabs).toHaveAttribute('data-range-end', '2026-02-28')
  })

  it('computes the last day of February correctly (29 days leap year)', () => {
    render(<CompleteMonthStep context="profile" recapYear={2024} recapMonth={2} />)

    const tabs = screen.getByTestId('transaction-tabs')
    expect(tabs).toHaveAttribute('data-range-start', '2024-02-01')
    expect(tabs).toHaveAttribute('data-range-end', '2024-02-29')
  })

  it('clicking Ajouter opens the modal with defaultDate=last day of recap month + dateMin/dateMax bounds', async () => {
    const user = userEvent.setup()
    render(<CompleteMonthStep context="group" recapYear={2026} recapMonth={4} />)

    expect(screen.queryByTestId('add-transaction-modal')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Ajouter une transaction/ }))

    const modal = await screen.findByTestId('add-transaction-modal')
    expect(modal).toHaveAttribute('data-context', 'group')
    // April has 30 days
    expect(modal).toHaveAttribute('data-default-date', '2026-04-30')
    expect(modal).toHaveAttribute('data-date-min', '2026-04-01')
    expect(modal).toHaveAttribute('data-date-max', '2026-04-30')
  })

  it('clicking Continuer fires advance-step with complete_month → summary', async () => {
    const user = userEvent.setup()
    advanceMock.mockResolvedValueOnce({})

    render(<CompleteMonthStep context="profile" recapYear={2026} recapMonth={5} />)
    await user.click(screen.getByRole('button', { name: 'Continuer' }))

    await waitFor(() => {
      expect(advanceMock).toHaveBeenCalledWith({
        fromStep: 'complete_month',
        toStep: 'summary',
      })
    })
  })

  it('shows generic error message on unknown advance failure', async () => {
    const user = userEvent.setup()
    advanceMock.mockRejectedValueOnce(new Error('boom'))

    render(<CompleteMonthStep context="profile" recapYear={2026} recapMonth={5} />)
    await user.click(screen.getByRole('button', { name: 'Continuer' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Impossible de passer/)
    })
  })

  it('swallows stale_step silently (no alert) — cache invalidation re-routes the wizard', async () => {
    const user = userEvent.setup()
    advanceMock.mockRejectedValueOnce(new Error('stale_step'))

    render(<CompleteMonthStep context="profile" recapYear={2026} recapMonth={5} />)
    await user.click(screen.getByRole('button', { name: 'Continuer' }))

    await waitFor(() => {
      expect(advanceMock).toHaveBeenCalled()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows specific copy on not_initiator error', async () => {
    const user = userEvent.setup()
    advanceMock.mockRejectedValueOnce(new Error('not_initiator'))

    render(<CompleteMonthStep context="group" recapYear={2026} recapMonth={5} />)
    await user.click(screen.getByRole('button', { name: 'Continuer' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Tu n'es pas l'initiateur du récap/)
    })
  })
})
