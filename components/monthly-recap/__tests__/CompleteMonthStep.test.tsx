/**
 * Sprint Complete-Month-Step (2026-05-29). Tests RTL pour le nouvel écran
 * inséré entre WelcomeStep (étape 1) et SummaryStep (étape 3) du wizard récap.
 *
 * Stratégie de mock :
 *   - `useAdvanceStep` mocké comme les autres tests d'étape.
 *   - `AddTransactionModal` + `EditTransactionModal` + `TransactionTabsComponent`
 *     mockés en stubs qui rendent leurs props clés via `data-*` — on vérifie
 *     le câblage (defaultDate, dateMin/dateMax, readOnly, dateRange,
 *     recapMonth/recapYear) sans dérouler tout le sous-arbre Dashboard qui
 *     dépend de useBudgets/useIncomes/etc.
 *
 * Sprint Fix-Recap-EditPath-Month (2026-08-31) : le stub des tabs expose un
 * bouton qui déclenche `onEditTransaction`, pour épingler le câblage du modal
 * d'édition — auparavant absent, ce qui rendait le kebab « Modifier » inerte.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const advanceMock = vi.fn()

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useAdvanceStep: () => ({ mutateAsync: advanceMock, isPending: false }),
}))

vi.mock('@/hooks/useFinancialData', () => ({
  useFinancialData: () => ({
    financialData: {
      availableBalance: 1234.56,
      remainingToLive: 78.9,
      totalSavings: 0,
      totalEstimatedIncome: 0,
      totalEstimatedBudgets: 0,
      totalRealIncome: 0,
      totalRealExpenses: 0,
    },
    loading: false,
    isFetching: false,
    error: null,
    context: 'profile',
    refreshFinancialData: vi.fn(),
  }),
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
    onEditTransaction,
  }: {
    context?: string
    readOnly?: boolean
    dateRange?: { startDate: string; endDate: string } | null
    onEditTransaction?: (transaction: { id: string }, type: 'expense' | 'income') => void
  }) => (
    <div
      data-testid="transaction-tabs"
      data-context={context}
      data-read-only={readOnly ? 'true' : 'false'}
      data-range-start={dateRange?.startDate ?? ''}
      data-range-end={dateRange?.endDate ?? ''}
      data-has-edit-handler={onEditTransaction ? 'true' : 'false'}
    >
      Stub tabs
      <button type="button" onClick={() => onEditTransaction?.({ id: 'exp-1' }, 'expense')}>
        Stub modifier dépense
      </button>
    </div>
  ),
}))

vi.mock('@/components/dashboard/EditTransactionModal', () => ({
  default: ({
    isOpen,
    onClose,
    transactionType,
    context,
    dateMin,
    dateMax,
    recapMonth,
    recapYear,
  }: {
    isOpen?: boolean
    onClose: () => void
    transactionType?: string
    context?: string
    dateMin?: string
    dateMax?: string
    recapMonth?: number
    recapYear?: number
  }) =>
    isOpen ? (
      <div
        data-testid="edit-transaction-modal"
        data-context={context}
        data-transaction-type={transactionType}
        data-date-min={dateMin}
        data-date-max={dateMax}
        data-recap-month={recapMonth}
        data-recap-year={recapYear}
      >
        <button type="button" onClick={onClose}>
          Fermer édition stub
        </button>
      </div>
    ) : null,
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

  it('passes dateRange of the recapped month to the tabs in full-interaction mode (no readOnly)', () => {
    render(<CompleteMonthStep context="profile" recapYear={2026} recapMonth={5} />)

    const tabs = screen.getByTestId('transaction-tabs')
    // readOnly retiré : kebab Modifier/Supprimer + long-press Valider activés
    // sur l'écran 2, exactement comme le Dashboard.
    expect(tabs).toHaveAttribute('data-read-only', 'false')
    expect(tabs).toHaveAttribute('data-context', 'profile')
    expect(tabs).toHaveAttribute('data-range-start', '2026-05-01')
    // May has 31 days
    expect(tabs).toHaveAttribute('data-range-end', '2026-05-31')
  })

  // Sprint Fix-Recap-EditPath-Month 2026-08-31 — régression : le kebab
  // « Modifier » était rendu mais `onEditTransaction` n'était jamais fourni,
  // donc le clic était un no-op silencieux.
  it('wires onEditTransaction and opens the edit modal on the recapped month', async () => {
    const user = userEvent.setup()
    render(<CompleteMonthStep context="profile" recapYear={2026} recapMonth={5} />)

    expect(screen.getByTestId('transaction-tabs')).toHaveAttribute('data-has-edit-handler', 'true')
    expect(screen.queryByTestId('edit-transaction-modal')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stub modifier dépense' }))

    const modal = await screen.findByTestId('edit-transaction-modal')
    expect(modal).toHaveAttribute('data-transaction-type', 'expense')
    expect(modal).toHaveAttribute('data-context', 'profile')
    // Le recalcul serveur ET l'aperçu doivent viser le mois recapé, pas today.
    expect(modal).toHaveAttribute('data-recap-month', '5')
    expect(modal).toHaveAttribute('data-recap-year', '2026')
    // La date reste bornée au mois recapé.
    expect(modal).toHaveAttribute('data-date-min', '2026-05-01')
    expect(modal).toHaveAttribute('data-date-max', '2026-05-31')
  })

  it('closes the edit modal without leaving it mounted', async () => {
    const user = userEvent.setup()
    render(<CompleteMonthStep context="profile" recapYear={2026} recapMonth={5} />)

    await user.click(screen.getByRole('button', { name: 'Stub modifier dépense' }))
    await screen.findByTestId('edit-transaction-modal')

    await user.click(screen.getByRole('button', { name: 'Fermer édition stub' }))
    await waitFor(() => {
      expect(screen.queryByTestId('edit-transaction-modal')).not.toBeInTheDocument()
    })
  })

  it('renders Solde Disponible + Reste à Vivre cards with formatted amounts from useFinancialData', () => {
    render(<CompleteMonthStep context="profile" recapYear={2026} recapMonth={5} />)

    expect(screen.getByText('Solde Disponible')).toBeInTheDocument()
    expect(screen.getByText('Reste à Vivre')).toBeInTheDocument()
    // Intl format fr-FR : "1 234,56 €" / "78,90 €" (NBSP entre nombre et symbole)
    expect(screen.getByText(/1.?234,56/)).toBeInTheDocument()
    expect(screen.getByText(/78,90/)).toBeInTheDocument()
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
