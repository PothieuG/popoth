import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { axe } from 'jest-axe'

import type { SavingsTransferOutcome, SavingsTransferRequest } from '@/hooks/useSavingsTransfer'

// Part 50 — « Transfert d'économies » : 3e type du dialogue d'ajout. Envoi ou
// réception, puis montant ; seul le solde disponible bouge, plafonné au total
// des économies (budgets + tirelire = carte « Économies » du dashboard).

const transfer = vi.fn<(request: SavingsTransferRequest) => Promise<SavingsTransferOutcome>>()
const useSavingsTransferCalls: unknown[] = []

const { fixtures } = vi.hoisted(() => ({
  fixtures: { totalSavings: 300 as number | undefined },
}))

vi.mock('@/hooks/useSavingsTransfer', () => ({
  useSavingsTransfer: (context: unknown) => {
    useSavingsTransferCalls.push(context)
    return { transfer }
  },
}))
vi.mock('@/hooks/useBudgets', () => ({ useBudgets: () => ({ budgets: [] }) }))
vi.mock('@/hooks/useIncomes', () => ({ useIncomes: () => ({ incomes: [] }) }))
vi.mock('@/hooks/useRealExpenses', () => ({
  useRealExpenses: () => ({ addExpense: vi.fn(), expenses: [] }),
}))
vi.mock('@/hooks/useRealIncomes', () => ({
  useRealIncomes: () => ({ addIncome: vi.fn(), receiveSalary: vi.fn(), incomes: [] }),
}))
vi.mock('@/hooks/useExpenseBreakdownPreview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useExpenseBreakdownPreview')>()),
  useExpenseBreakdownPreview: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    fetchFresh: vi.fn(),
  }),
}))
vi.mock('@/hooks/useFinancialData', () => ({
  useFinancialData: () => ({
    financialData: {
      remainingToLive: 500,
      availableBalance: 1000,
      totalSavings: fixtures.totalSavings,
    },
  }),
}))
vi.mock('@/components/dashboard/RemainingToLivePreview', () => ({ default: () => null }))
vi.mock('@/components/dashboard/ExpenseBreakdownPreview', () => ({ default: () => null }))
vi.mock('@/components/ui/CustomDropdown', () => ({ default: () => null }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import AddTransactionModal from '../AddTransactionModal'

const transferCard = () => screen.queryByRole('button', { name: /Transfert d’économies/i })
const amountInput = () => screen.getByLabelText(/Montant/i) as HTMLInputElement
const panel = () => screen.getByTestId('savings-transfer-panel')

async function openAmountStep(user: UserEvent, direction: 'Envoi' | 'Réception') {
  await user.click(transferCard()!)
  await user.click(screen.getByRole('button', { name: new RegExp(`^${direction}`) }))
}

async function typeAmount(user: UserEvent, value: string) {
  await user.clear(amountInput())
  await user.type(amountInput(), value)
}

beforeEach(() => {
  fixtures.totalSavings = 300
  useSavingsTransferCalls.length = 0
  transfer.mockReset()
  transfer.mockResolvedValue({ ok: true, balance: 900 })
})

describe('AddTransactionModal — Transfert d’économies : disponibilité', () => {
  it('propose le transfert à côté de Dépense et Revenu', () => {
    render(<AddTransactionModal onClose={vi.fn()} context="profile" />)

    expect(screen.getByRole('button', { name: /Dépense/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Revenu/i })).toBeInTheDocument()
    expect(transferCard()).toBeEnabled()
  })

  it('désactive le transfert, avec la raison, sans économies', () => {
    fixtures.totalSavings = 0
    render(<AddTransactionModal onClose={vi.fn()} context="profile" />)

    expect(transferCard()).toBeDisabled()
    expect(transferCard()).toHaveTextContent('Aucune économie disponible')
  })

  it('désactive le transfert tant que les économies ne sont pas chargées', () => {
    fixtures.totalSavings = undefined
    render(<AddTransactionModal onClose={vi.fn()} context="profile" />)

    expect(transferCard()).toBeDisabled()
  })

  it('n’apparaît pas dans le wizard récap « Compléter le mois »', () => {
    render(
      <AddTransactionModal onClose={vi.fn()} context="profile" recapMonth={9} recapYear={2026} />,
    )

    expect(transferCard()).toBeNull()
  })
})

describe('AddTransactionModal — Transfert d’économies : parcours', () => {
  it('Envoi : montant seul, aperçu du solde qui baisse, puis fermeture', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onTransactionAdded = vi.fn()
    render(
      <AddTransactionModal
        onClose={onClose}
        context="profile"
        onTransactionAdded={onTransactionAdded}
      />,
    )

    await openAmountStep(user, 'Envoi')
    expect(screen.getByRole('heading', { name: 'Transfert d’économies' })).toBeInTheDocument()
    // Pas de description, de date ni de rattachement : le montant seul.
    expect(screen.queryByLabelText(/Description/i)).toBeNull()
    expect(screen.queryByLabelText(/Date/i)).toBeNull()
    expect(screen.getByText(/Maximum : 300,00\s€ \(total de vos économies\)/)).toBeInTheDocument()

    await typeAmount(user, '100')
    expect(panel()).toHaveTextContent(/1\s000,00\s€ → 900,00\s€/)

    await user.click(screen.getByRole('button', { name: 'Valider l’envoi' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(transfer).toHaveBeenCalledWith({ direction: 'send', amount: 100 })
    expect(useSavingsTransferCalls.at(-1)).toBe('profile')
    // Le solde est patché par le hook : pas de rafraîchissement général.
    expect(onTransactionAdded).not.toHaveBeenCalled()
  })

  it('Réception : aperçu du solde qui monte, contexte groupe transmis', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} context="group" />)

    await openAmountStep(user, 'Réception')
    await typeAmount(user, '42,5')
    expect(panel()).toHaveTextContent(/1\s000,00\s€ → 1\s042,50\s€/)

    await user.click(screen.getByRole('button', { name: 'Valider la réception' }))
    await waitFor(() =>
      expect(transfer).toHaveBeenCalledWith({ direction: 'receive', amount: 42.5 }),
    )
    expect(useSavingsTransferCalls.at(-1)).toBe('group')
  })

  it.each(['Envoi', 'Réception'] as const)(
    '%s : refuse un montant au-delà du total des économies',
    async (direction) => {
      const user = userEvent.setup()
      render(<AddTransactionModal onClose={vi.fn()} context="profile" />)

      await openAmountStep(user, direction)
      await typeAmount(user, '300.01')
      await user.click(screen.getByRole('button', { name: /^Valider/ }))

      expect(
        await screen.findByText('Le montant dépasse le total de vos économies'),
      ).toBeInTheDocument()
      expect(transfer).not.toHaveBeenCalled()
      // Pas de solde projeté pour un montant refusé.
      expect(panel()).not.toHaveTextContent('→')
    },
  )

  it('accepte exactement le total des économies', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} context="profile" />)

    await openAmountStep(user, 'Envoi')
    await typeAmount(user, '300')
    await user.click(screen.getByRole('button', { name: 'Valider l’envoi' }))

    await waitFor(() => expect(transfer).toHaveBeenCalledWith({ direction: 'send', amount: 300 }))
  })

  it('affiche l’erreur de plafond renvoyée par le serveur et reste ouvert', async () => {
    transfer.mockResolvedValue({ ok: false, error: 'savings-transfer-exceeds-savings' })
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AddTransactionModal onClose={onClose} context="profile" />)

    await openAmountStep(user, 'Envoi')
    await typeAmount(user, '50')
    await user.click(screen.getByRole('button', { name: 'Valider l’envoi' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Le montant dépasse le total de vos économies/,
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('retour : du montant au choix du sens, puis au choix du type', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} context="profile" />)

    await openAmountStep(user, 'Envoi')
    await user.click(screen.getByRole('button', { name: /retour à l'étape précédente/i }))
    expect(screen.getByRole('button', { name: /^Réception/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /retour à l'étape précédente/i }))
    expect(screen.getByRole('heading', { name: 'Type de transaction' })).toBeInTheDocument()
  })

  it('étapes sens et montant sans violation a11y', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} context="profile" />)

    await user.click(transferCard()!)
    expect((await axe(document.body)).violations).toEqual([])

    await user.click(screen.getByRole('button', { name: /^Envoi/ }))
    await user.click(screen.getByRole('button', { name: 'Valider l’envoi' }))
    await screen.findByText(/Le montant doit être positif/)
    expect((await axe(document.body)).violations).toEqual([])
  })
})
