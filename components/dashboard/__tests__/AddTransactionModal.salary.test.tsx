import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'

import type { RealIncome, ReceiveSalaryOutcome } from '@/hooks/useRealIncomes'

// Sprint Salary-Reception (2026-10-02) — option « Réception du salaire » du
// dialogue d'ajout. Montants du cas réel : salaire déclaré 2 752,08 €, paie de
// 2 760,18 € reçue le 28/09 pour octobre.

const addIncome = vi.fn(async () => true)
const receiveSalary = vi.fn<(data: unknown) => Promise<ReceiveSalaryOutcome>>()

const { fixtures } = vi.hoisted(() => ({
  fixtures: {
    realIncomes: [] as unknown[],
    declaredSalary: 2752.08,
  },
}))

vi.mock('@/hooks/useBudgets', () => ({ useBudgets: () => ({ budgets: [] }) }))
vi.mock('@/hooks/useIncomes', () => ({ useIncomes: () => ({ incomes: [] }) }))
vi.mock('@/hooks/useRealExpenses', () => ({
  useRealExpenses: () => ({ addExpense: vi.fn(), expenses: [] }),
}))
vi.mock('@/hooks/useRealIncomes', () => ({
  useRealIncomes: () => ({ addIncome, receiveSalary, incomes: fixtures.realIncomes }),
}))
vi.mock('@/hooks/useProgressData', () => ({
  useProgressData: () => ({ expenseProgress: {} }),
}))
vi.mock('@/hooks/useFinancialData', () => ({
  useFinancialData: () => ({
    financialData: {
      remainingToLive: 68.78,
      meta: {
        readOnlyIncomes:
          fixtures.declaredSalary > 0
            ? [{ kind: 'salary', label: 'Salaire', amount: fixtures.declaredSalary }]
            : [],
        totalMonthlyProjects: 0,
        savingsProjects: [],
      },
    },
  }),
}))
vi.mock('@/components/dashboard/RemainingToLivePreview', () => ({
  default: () => <div data-testid="rav-preview" />,
}))
vi.mock('@/components/dashboard/ExpenseBreakdownPreview', () => ({ default: () => null }))
vi.mock('@/components/ui/CustomDropdown', () => ({ default: () => null }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import AddTransactionModal from '../AddTransactionModal'

const income = (overrides: Partial<RealIncome>): RealIncome => ({
  id: 'income-1',
  amount: 2752.08,
  description: 'Salaire',
  entry_date: '2026-09-28',
  is_exceptional: false,
  created_at: '2026-09-28T07:57:00Z',
  ...overrides,
})

/** Wizard « Compléter le mois » de septembre 2026 : libellés de mois stables. */
function renderModal(props: Partial<React.ComponentProps<typeof AddTransactionModal>> = {}) {
  const onClose = vi.fn()
  render(
    <AddTransactionModal
      onClose={onClose}
      context="profile"
      defaultDate="2026-09-28"
      recapMonth={9}
      recapYear={2026}
      {...props}
    />,
  )
  return { onClose }
}

async function openIncomeKinds(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: /Revenu/i }))
}

const salaryCard = () => screen.queryByRole('button', { name: /Réception du salaire/i })

beforeEach(() => {
  fixtures.realIncomes = []
  fixtures.declaredSalary = 2752.08
  addIncome.mockClear()
  receiveSalary.mockReset()
  receiveSalary.mockResolvedValue({
    ok: true,
    result: {
      mode: 'advance',
      incomeId: 'income-1',
      expected: 2752.08,
      received: 2760.18,
      delta: 8.1,
      balance: 3042.7,
    },
  })
})

describe('AddTransactionModal — Réception du salaire', () => {
  it('espace perso avec salaire déclaré : l’option annonce le mois financé', async () => {
    const user = userEvent.setup()
    renderModal()
    await openIncomeKinds(user)

    expect(salaryCard()).toBeEnabled()
    expect(salaryCard()).toHaveTextContent(/Paie d'octobre/)
  })

  it('espace groupe : pas d’option (un groupe n’a pas de salaire)', async () => {
    const user = userEvent.setup()
    renderModal({ context: 'group' })
    await openIncomeKinds(user)

    expect(salaryCard()).toBeNull()
  })

  it('pas de salaire déclaré : pas d’option', async () => {
    fixtures.declaredSalary = 0
    const user = userEvent.setup()
    renderModal()
    await openIncomeKinds(user)

    expect(salaryCard()).toBeNull()
  })

  it('formulaire : montant pré-rempli au salaire prévu, pas de description, pas d’aperçu « + montant »', async () => {
    const user = userEvent.setup()
    renderModal()
    await openIncomeKinds(user)
    await user.click(salaryCard()!)

    expect(screen.getByRole('heading', { name: 'Réception du salaire' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/description/i)).toBeNull()
    expect((screen.getByLabelText(/Montant reçu/i) as HTMLInputElement).value).toBe('2752.08')
    // Le salaire n'entre jamais en entier dans le reste à vivre.
    expect(screen.queryByTestId('rav-preview')).toBeNull()

    const panel = screen.getByTestId('salary-reception-panel')
    expect(panel).toHaveTextContent(/Salaire prévu/)
    expect(panel).toHaveTextContent(/Ce salaire finance octobre/)
    expect(panel).toHaveTextContent(/reste à vivre de septembre/)
  })

  it('reçu plus que prévu : écart annoncé sur le mois financé, envoi vers receiveSalary', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()
    await openIncomeKinds(user)
    await user.click(salaryCard()!)

    const amount = screen.getByLabelText(/Montant reçu/i)
    await user.clear(amount)
    await user.type(amount, '2760,18')

    const panel = screen.getByTestId('salary-reception-panel')
    expect(panel).toHaveTextContent(/\+8,10/)
    expect(panel).toHaveTextContent(
      /de plus que prévu s'ajouteront à votre reste à vivre d'octobre/,
    )

    await user.click(screen.getByRole('button', { name: 'Enregistrer le salaire' }))

    await waitFor(() => expect(receiveSalary).toHaveBeenCalledTimes(1))
    expect(receiveSalary).toHaveBeenCalledWith({ amount: 2760.18, entry_date: '2026-09-28' })
    expect(addIncome).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('reçu moins que prévu : écart négatif annoncé', async () => {
    const user = userEvent.setup()
    renderModal()
    await openIncomeKinds(user)
    await user.click(salaryCard()!)

    const amount = screen.getByLabelText(/Montant reçu/i)
    await user.clear(amount)
    await user.type(amount, '2700')

    const panel = screen.getByTestId('salary-reception-panel')
    expect(panel).toHaveTextContent(/−52,08/)
    expect(panel).toHaveTextContent(
      /de moins que prévu seront retirés de votre reste à vivre d'octobre/,
    )
  })

  it('ligne salaire du mois encore à valider : la paie est celle du mois en cours', async () => {
    fixtures.realIncomes = [
      income({ amount: 2700, recap_origin_id: 'recap-aout', applied_to_balance_at: null }),
    ]
    const user = userEvent.setup()
    renderModal()
    await openIncomeKinds(user)

    expect(salaryCard()).toHaveTextContent(/Paie de septembre/)
    await user.click(salaryCard()!)

    // Attendu = montant de la ligne en attente, pas le salaire déclaré.
    expect((screen.getByLabelText(/Montant reçu/i) as HTMLInputElement).value).toBe('2700')
    expect(screen.getByTestId('salary-reception-panel')).toHaveTextContent(
      /la ligne « Salaire » en attente sera validée/,
    )
  })

  it('paie du mois suivant déjà enregistrée : option désactivée, avec la raison', async () => {
    fixtures.realIncomes = [
      income({
        amount: 2760.18,
        salary_reception: true,
        applied_to_balance_at: '2026-09-28T07:57:00Z',
      }),
    ]
    const user = userEvent.setup()
    renderModal()
    await openIncomeKinds(user)

    expect(salaryCard()).toBeDisabled()
    expect(salaryCard()).toHaveTextContent(/Paie d'octobre déjà enregistrée/)
    expect(salaryCard()).toHaveTextContent(/2[\s  ]?760,18/)
  })

  it('refus du serveur : message lisible, le dialogue reste ouvert', async () => {
    receiveSalary.mockResolvedValue({ ok: false, error: 'salary-already-received' })
    const user = userEvent.setup()
    const { onClose } = renderModal()
    await openIncomeKinds(user)
    await user.click(salaryCard()!)
    await user.click(screen.getByRole('button', { name: 'Enregistrer le salaire' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /salaire du mois prochain est déjà enregistré/i,
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('retour puis « Exceptionnel » : description et montant imposés ne traînent pas', async () => {
    const user = userEvent.setup()
    renderModal()
    await openIncomeKinds(user)
    await user.click(salaryCard()!)
    await user.click(screen.getByRole('button', { name: /retour à l'étape précédente/i }))
    await user.click(screen.getByRole('button', { name: /Exceptionnel/i }))

    expect((screen.getByLabelText(/description/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^Montant/i) as HTMLInputElement).value).toBe('0')
    expect(screen.queryByTestId('salary-reception-panel')).toBeNull()
    expect(screen.getByRole('button', { name: /Ajouter le revenu/i })).toBeInTheDocument()
  })
})
