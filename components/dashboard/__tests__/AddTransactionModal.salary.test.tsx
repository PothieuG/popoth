import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'

import type { RealIncome, ReceiveSalaryOutcome } from '@/hooks/useRealIncomes'

// Sprint Salary-Reception (2026-10-02) — option « Réception du salaire » du
// dialogue d'ajout, avec le choix du mois financé. Montants du cas réel :
// salaire déclaré 2 752,08 €, paie de 2 760,18 €.

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

/**
 * Wizard « Compléter le mois » de septembre 2026 : le mois ouvert est
 * septembre, les deux mois proposés sont septembre et octobre. `defaultDate`
 * fixe la date de réception, dont le jour pilote le mois proposé.
 */
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
const monthRadio = (name: RegExp) => screen.getByRole('radio', { name })
const amountInput = () => screen.getByLabelText(/Montant reçu/i) as HTMLInputElement
const panel = () => screen.getByTestId('salary-reception-panel')

async function openSalaryForm(user: UserEvent) {
  await openIncomeKinds(user)
  await user.click(salaryCard()!)
}

beforeEach(() => {
  fixtures.realIncomes = []
  fixtures.declaredSalary = 2752.08
  addIncome.mockClear()
  receiveSalary.mockReset()
  receiveSalary.mockResolvedValue({
    ok: true,
    result: {
      incomeId: 'income-1',
      salaryMonth: '2026-10-01',
      expected: 2752.08,
      received: 2760.18,
      delta: 8.1,
      deltaApplied: false,
      balance: 3042.7,
    },
  })
})

describe('AddTransactionModal — Réception du salaire : disponibilité', () => {
  it('espace perso avec salaire déclaré : option proposée', async () => {
    const user = userEvent.setup()
    renderModal()
    await openIncomeKinds(user)

    expect(salaryCard()).toBeEnabled()
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

  it('les deux mois déjà réglés : option désactivée, avec la raison', async () => {
    fixtures.realIncomes = [
      income({ salary_month: '2026-09-01', applied_to_balance_at: '2026-09-03T08:00:00Z' }),
      income({
        id: 'income-2',
        amount: 2760.18,
        salary_month: '2026-10-01',
        applied_to_balance_at: '2026-09-28T07:57:00Z',
      }),
    ]
    const user = userEvent.setup()
    renderModal()
    await openIncomeKinds(user)

    expect(salaryCard()).toBeDisabled()
    expect(salaryCard()).toHaveTextContent(/Salaires de septembre et d'octobre déjà enregistrés/)
  })
})

describe('AddTransactionModal — Réception du salaire : choix du mois', () => {
  it('formulaire : montant pré-rempli, pas de description, pas d’aperçu « + montant »', async () => {
    const user = userEvent.setup()
    renderModal()
    await openSalaryForm(user)

    expect(screen.getByRole('heading', { name: 'Réception du salaire' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/description/i)).toBeNull()
    expect(amountInput().value).toBe('2752.08')
    // Le salaire n'entre jamais en entier dans le reste à vivre.
    expect(screen.queryByTestId('rav-preview')).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Ce salaire finance' })).toBeInTheDocument()
  })

  it('payé le 28 : le mois SUIVANT est proposé, écart reporté sur ce mois', async () => {
    const user = userEvent.setup()
    renderModal({ defaultDate: '2026-09-28' })
    await openSalaryForm(user)

    expect(monthRadio(/Octobre/)).toHaveAttribute('aria-checked', 'true')
    expect(monthRadio(/Septembre/)).toHaveAttribute('aria-checked', 'false')
    expect(monthRadio(/Octobre/)).toHaveTextContent('Mois prochain')
    expect(panel()).toHaveTextContent(/Ce salaire finance octobre/)
    expect(panel()).toHaveTextContent(/n'entre pas dans le reste à vivre de septembre/)

    await user.clear(amountInput())
    await user.type(amountInput(), '2760,18')

    expect(panel()).toHaveTextContent(/\+8,10/)
    expect(panel()).toHaveTextContent(
      /de plus que prévu s'ajouteront à votre reste à vivre d'octobre/,
    )
  })

  it('payé le 3 : le mois EN COURS est proposé, écart compté tout de suite', async () => {
    const user = userEvent.setup()
    renderModal({ defaultDate: '2026-09-03' })
    await openSalaryForm(user)

    expect(monthRadio(/Septembre/)).toHaveAttribute('aria-checked', 'true')
    expect(monthRadio(/Septembre/)).toHaveTextContent('Mois en cours')
    expect(panel()).toHaveTextContent(/C'est le salaire de septembre/)

    await user.clear(amountInput())
    await user.type(amountInput(), '2700')

    expect(panel()).toHaveTextContent(/−52,08/)
    expect(panel()).toHaveTextContent(
      /de moins que prévu sont retirés tout de suite de votre reste à vivre/,
    )
  })

  it('l’utilisateur peut contredire la proposition', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal({ defaultDate: '2026-09-28' })
    await openSalaryForm(user)

    await user.click(monthRadio(/Septembre/))

    expect(monthRadio(/Septembre/)).toHaveAttribute('aria-checked', 'true')
    expect(panel()).toHaveTextContent(/C'est le salaire de septembre/)

    await user.clear(amountInput())
    await user.type(amountInput(), '2760,18')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le salaire' }))

    await waitFor(() => expect(receiveSalary).toHaveBeenCalledTimes(1))
    expect(receiveSalary).toHaveBeenCalledWith({
      amount: 2760.18,
      salary_month: '2026-09',
      entry_date: '2026-09-28',
    })
    expect(addIncome).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('envoi sans toucher au choix : le mois proposé part avec la paie', async () => {
    const user = userEvent.setup()
    renderModal({ defaultDate: '2026-09-28' })
    await openSalaryForm(user)
    await user.click(screen.getByRole('button', { name: 'Enregistrer le salaire' }))

    await waitFor(() => expect(receiveSalary).toHaveBeenCalledTimes(1))
    expect(receiveSalary).toHaveBeenCalledWith({
      amount: 2752.08,
      salary_month: '2026-10',
      entry_date: '2026-09-28',
    })
  })

  it('ligne du récap à valider : ce mois est proposé, au montant de la ligne', async () => {
    fixtures.realIncomes = [
      income({
        amount: 2700,
        salary_month: '2026-09-01',
        recap_origin_id: 'recap-aout',
        applied_to_balance_at: null,
      }),
    ]
    const user = userEvent.setup()
    // Le 28 désignerait octobre : la ligne en attente l'emporte.
    renderModal({ defaultDate: '2026-09-28' })
    await openSalaryForm(user)

    expect(monthRadio(/Septembre/)).toHaveAttribute('aria-checked', 'true')
    expect(amountInput().value).toBe('2700')
    expect(panel()).toHaveTextContent(/la ligne « Salaire » en attente sera validée/)

    // Changer de mois sans avoir retouché le montant : il suit le salaire prévu.
    await user.click(monthRadio(/Octobre/))
    expect(amountInput().value).toBe('2752.08')
  })

  it('montant déjà saisi : changer de mois ne l’écrase pas', async () => {
    const user = userEvent.setup()
    renderModal({ defaultDate: '2026-09-28' })
    await openSalaryForm(user)

    await user.clear(amountInput())
    await user.type(amountInput(), '2760,18')
    await user.click(monthRadio(/Septembre/))

    expect(amountInput().value).toBe('2760.18')
  })

  it('mois déjà réglé : visible, grisé, non sélectionnable — l’autre est proposé', async () => {
    fixtures.realIncomes = [
      income({
        amount: 2760.18,
        salary_month: '2026-10-01',
        applied_to_balance_at: '2026-09-28T07:57:00Z',
      }),
    ]
    const user = userEvent.setup()
    renderModal({ defaultDate: '2026-09-28' })
    await openSalaryForm(user)

    expect(monthRadio(/Octobre/)).toBeDisabled()
    expect(monthRadio(/Octobre/)).toHaveTextContent('Déjà reçu')
    expect(monthRadio(/Septembre/)).toHaveAttribute('aria-checked', 'true')
  })

  it('dashboard (hors récap) : le mois ouvert est le mois du jour', async () => {
    const today = new Date()
    const thisMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(today)
    const user = userEvent.setup()
    renderModal({ recapMonth: undefined, recapYear: undefined, defaultDate: undefined })
    await openSalaryForm(user)

    const current = screen
      .getAllByRole('radio')
      .find((radio) => radio.textContent?.includes('Mois en cours'))
    expect(current?.textContent?.toLowerCase()).toContain(thisMonth)
  })
})

describe('AddTransactionModal — Réception du salaire : erreurs et retour', () => {
  it('refus du serveur : message lisible, le dialogue reste ouvert', async () => {
    receiveSalary.mockResolvedValue({ ok: false, error: 'salary-already-received' })
    const user = userEvent.setup()
    const { onClose } = renderModal()
    await openSalaryForm(user)
    await user.click(screen.getByRole('button', { name: 'Enregistrer le salaire' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /salaire de ce mois est déjà enregistré/i,
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('retour puis « Exceptionnel » : description et montant imposés ne traînent pas', async () => {
    const user = userEvent.setup()
    renderModal()
    await openSalaryForm(user)
    await user.click(screen.getByRole('button', { name: /retour à l'étape précédente/i }))
    await user.click(screen.getByRole('button', { name: /Exceptionnel/i }))

    expect((screen.getByLabelText(/description/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^Montant/i) as HTMLInputElement).value).toBe('0')
    expect(screen.queryByTestId('salary-reception-panel')).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByRole('button', { name: /Ajouter le revenu/i })).toBeInTheDocument()
  })
})
