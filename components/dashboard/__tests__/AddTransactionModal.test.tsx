import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import type { ExpenseBreakdownPreviewData } from '@/hooks/useExpenseBreakdownPreview'

// 5 hooks mocked — AddTransactionModal has the broadest data surface of any
// client form. Fixtures kept stable across tests.

const addExpense = vi.fn(
  async (): Promise<{ ok: true } | { ok: false; error: string }> => ({
    ok: true,
  }),
)
const addIncome = vi.fn(async () => true)

const BUDGET_UUID = '11111111-1111-4111-8111-111111111111'
const INCOME_UUID = '22222222-2222-4222-8222-222222222222'
const OTHER_BUDGET_UUID = '33333333-3333-4333-8333-333333333333'

// Aperçu de la route preview-breakdown (Sprint Expense-Overflow-Coverage).
// Par défaut : pas de dépassement → la dépense budgétée s'ajoute directement.
// Les tests « couvrir le dépassement » le remplacent par `OVERFLOW_PREVIEW`.
const NO_OVERFLOW_PREVIEW: ExpenseBreakdownPreviewData = {
  total_amount: 100,
  from_piggy_bank: 0,
  from_budget_savings: 50,
  from_budget: 50,
  piggy_bank_before: 0,
  piggy_bank_after: 0,
  savings_before: 50,
  savings_after: 0,
  budget_spent_before: 0,
  budget_spent_after: 50,
  budget_estimated: 500,
  budget_name: 'Alimentation',
  cross_budget_debits: [],
  overflow: 0,
  other_budgets_savings: [],
}
// 600 € sur un budget de 500 € (+ 50 € d'économies) → 50 € de dépassement.
// Réserves : 20 € de tirelire + 30 € d'économies « Loisirs ».
const OVERFLOW_PREVIEW: ExpenseBreakdownPreviewData = {
  ...NO_OVERFLOW_PREVIEW,
  total_amount: 600,
  from_budget: 550,
  piggy_bank_before: 20,
  piggy_bank_after: 20,
  budget_spent_after: 550,
  overflow: 50,
  other_budgets_savings: [{ budget_id: OTHER_BUDGET_UUID, budget_name: 'Loisirs', available: 30 }],
}
let previewData: ExpenseBreakdownPreviewData = NO_OVERFLOW_PREVIEW
const fetchFresh = vi.fn(async () => previewData)
vi.mock('@/hooks/useExpenseBreakdownPreview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useExpenseBreakdownPreview')>()),
  useExpenseBreakdownPreview: (params: { amount: number }) => ({
    data: params.amount > 0 ? previewData : undefined,
    isLoading: false,
    error: null,
    fetchFresh,
  }),
}))

// Arguments reçus par `useBudgets` — épingle la fenêtre du mois recapé. Le
// dépensé renvoyé en dépend, comme côté serveur (35 € en septembre, 0 € sinon).
const useBudgetsCalls: unknown[][] = []
vi.mock('@/hooks/useBudgets', () => ({
  useBudgets: (...args: unknown[]) => {
    useBudgetsCalls.push(args)
    const monthWindow = args[1] as { month: number; year: number } | undefined
    return {
      budgets: [
        {
          id: BUDGET_UUID,
          name: 'Alimentation',
          estimated_amount: 500,
          cumulated_savings: 50,
          spent_this_month: monthWindow?.month === 9 ? 35 : 0,
        },
      ],
    }
  },
}))
vi.mock('@/hooks/useIncomes', () => ({
  useIncomes: () => ({
    incomes: [{ id: INCOME_UUID, name: 'Salaire', estimated_amount: 1500 }],
  }),
}))
vi.mock('@/hooks/useRealExpenses', () => ({
  useRealExpenses: () => ({ addExpense, expenses: [] }),
}))
vi.mock('@/hooks/useRealIncomes', () => ({
  useRealIncomes: () => ({ addIncome, incomes: [] }),
}))
const useFinancialDataCalls: unknown[][] = []
vi.mock('@/hooks/useFinancialData', () => ({
  useFinancialData: (...args: unknown[]) => {
    useFinancialDataCalls.push(args)
    return { financialData: { remainingToLive: 1000 } }
  },
}))
vi.mock('@/components/dashboard/RemainingToLivePreview', () => ({
  default: ({ month, year }: { month?: number; year?: number }) => (
    <div data-testid="rav-preview" data-month={month ?? ''} data-year={year ?? ''} />
  ),
}))
vi.mock('@/components/dashboard/ExpenseBreakdownPreview', () => ({
  default: () => null,
}))
vi.mock('@/components/ui/CustomDropdown', () => ({
  default: ({
    options,
    value,
    onChange,
  }: {
    options: Array<{ id: string; name: string; spentAmount?: number }>
    value: string
    onChange: (v: string) => void
  }) => (
    <select data-testid="fk-dropdown" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— select —</option>
      {options.map((o) => (
        <option key={o.id} value={o.id} data-spent={o.spentAmount}>
          {o.name}
        </option>
      ))}
    </select>
  ),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import AddTransactionModal from '../AddTransactionModal'

beforeEach(() => {
  previewData = NO_OVERFLOW_PREVIEW
})

/**
 * Wizard navigation helpers (Sprint P4-P5-P6 / Phase B3).
 * Each test that needs to reach the form fields navigates the wizard first.
 */
// The wizard cards have multi-line content (title + description), so the
// accessible name is the full concatenation. We match partially.
async function navigateToFieldsExpense(user: UserEvent, opts: { exceptional?: boolean } = {}) {
  // Step 1: select-type → click Dépense card
  await user.click(screen.getByRole('button', { name: /Dépense/i }))
  // Step 2: select-kind → click Budgétée OR Exceptionnelle
  if (opts.exceptional) {
    await user.click(screen.getByRole('button', { name: /Exceptionnelle/i }))
  } else {
    await user.click(screen.getByRole('button', { name: /Budgétée/i }))
  }
}

async function navigateToFieldsIncome(user: UserEvent, opts: { exceptional?: boolean } = {}) {
  // Step 1: select-type → click Revenu card
  await user.click(screen.getByRole('button', { name: /Revenu/i }))
  // Step 2: select-kind → click Régulier OR Exceptionnel
  if (opts.exceptional) {
    await user.click(screen.getByRole('button', { name: /Exceptionnel/i }))
  } else {
    await user.click(screen.getByRole('button', { name: /Régulier/i }))
  }
}

describe('AddTransactionModal — wizard navigation (Sprint P4-P5-P6 / B1)', () => {
  beforeEach(() => {
    addExpense.mockClear()
    addIncome.mockClear()
    addExpense.mockResolvedValue({ ok: true })
    addIncome.mockResolvedValue(true)
  })

  it('Step 1 renders type selection cards', () => {
    render(<AddTransactionModal onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Dépense/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Revenu/i })).toBeInTheDocument()
    // Fields not visible yet
    expect(screen.queryByLabelText(/description/i)).not.toBeInTheDocument()
  })

  it('Dépense → Step 2 renders Budgétée / Exceptionnelle cards', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Dépense/i }))
    expect(screen.getByRole('button', { name: /Budgétée/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Exceptionnelle/i })).toBeInTheDocument()
    // Fields still not visible yet
    expect(screen.queryByLabelText(/description/i)).not.toBeInTheDocument()
  })

  it('Revenu → Step 2 renders Régulier / Exceptionnel cards', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Revenu/i }))
    expect(screen.getByRole('button', { name: /Régulier/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Exceptionnel/i })).toBeInTheDocument()
    // The expense kind cards must NOT appear in the income flow
    expect(screen.queryByRole('button', { name: /Budgétée/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Exceptionnelle/i })).not.toBeInTheDocument()
    // Fields not yet rendered — we're still at the kind step
    expect(screen.queryByLabelText(/description/i)).not.toBeInTheDocument()
  })

  it('Revenu Régulier → lands on fields with FK dropdown', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsIncome(user)
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
    expect(screen.getByTestId('fk-dropdown')).toBeInTheDocument()
  })

  it('Revenu Exceptionnel → lands on fields WITHOUT FK dropdown', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsIncome(user, { exceptional: true })
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
    expect(screen.queryByTestId('fk-dropdown')).toBeNull()
  })

  it('back button preserves description + amount across step transitions', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user)
    // Fill description + amount
    await user.type(screen.getByLabelText(/description/i), 'Achat')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '50')
    // Go back to Step 2 (back button is icon-only with aria-label)
    await user.click(screen.getByRole('button', { name: /retour à l'étape précédente/i }))
    expect(screen.getByRole('button', { name: /Budgétée/i })).toBeInTheDocument()
    // Forward again → description + amount preserved
    await user.click(screen.getByRole('button', { name: /Budgétée/i }))
    expect((screen.getByLabelText(/description/i) as HTMLInputElement).value).toBe('Achat')
    expect((screen.getByLabelText(/montant/i) as HTMLInputElement).value).toBe('50')
  })

  it('Exceptionnelle path hides the FK dropdown', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user, { exceptional: true })
    // No FK dropdown for exceptional expense
    expect(screen.queryByTestId('fk-dropdown')).toBeNull()
  })

  it('Budgétée path shows the FK dropdown', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user)
    expect(screen.getByTestId('fk-dropdown')).toBeInTheDocument()
  })
})

describe('AddTransactionModal — use_savings auto-enabled (Sprint 2026-05-21 / Auto-Use-Savings)', () => {
  beforeEach(() => {
    addExpense.mockClear()
    addExpense.mockResolvedValue({ ok: true })
  })

  it('no longer renders a "Utiliser les économies" toggle UI', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user)
    await user.selectOptions(screen.getByTestId('fk-dropdown'), BUDGET_UUID)
    // Toggle UI was removed Sprint Auto-Use-Savings — savings used by default.
    expect(screen.queryByLabelText(/utiliser les économies/i)).not.toBeInTheDocument()
  })

  it('passes use_savings: true to addExpense on budgeted expense submit', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user)
    await user.selectOptions(screen.getByTestId('fk-dropdown'), BUDGET_UUID)
    await user.type(screen.getByLabelText(/description/i), 'Courses')
    await user.clear(screen.getByLabelText(/montant/i))
    await user.type(screen.getByLabelText(/montant/i), '40')
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/i }))
    await waitFor(() => {
      expect(addExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Courses',
          amount: 40,
          estimated_budget_id: BUDGET_UUID,
          use_savings: true,
        }),
      )
    })
  })
})

describe('AddTransactionModal — submit flows', () => {
  beforeEach(() => {
    addExpense.mockClear()
    addIncome.mockClear()
    addExpense.mockResolvedValue({ ok: true })
    addIncome.mockResolvedValue(true)
  })

  it('calls addExpense with correct data on happy budgétée submit', async () => {
    const onClose = vi.fn()
    const onTransactionAdded = vi.fn()
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={onClose} onTransactionAdded={onTransactionAdded} />)
    await navigateToFieldsExpense(user)
    await user.selectOptions(screen.getByTestId('fk-dropdown'), BUDGET_UUID)
    await user.type(screen.getByLabelText(/description/i), 'Courses')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '100')
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/i }))
    await waitFor(() => {
      expect(addExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Courses',
          amount: 100,
          estimated_budget_id: BUDGET_UUID,
        }),
      )
    })
    expect(onTransactionAdded).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('allows submit even when expense exceeds remaining-to-live (RAV may go negative)', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user, { exceptional: true })
    await user.type(screen.getByLabelText(/description/i), 'Achat hors budget')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '2000')
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/i }))
    await waitFor(() => {
      expect(addExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Achat hors budget',
          amount: 2000,
        }),
      )
    })
  })

  it('calls addIncome on happy income submit', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsIncome(user)
    await user.selectOptions(screen.getByTestId('fk-dropdown'), INCOME_UUID)
    await user.type(screen.getByLabelText(/description/i), 'Paie')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '1500')
    await user.click(screen.getByRole('button', { name: /^Ajouter le revenu$/i }))
    await waitFor(() => {
      expect(addIncome).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Paie',
          amount: 1500,
          estimated_income_id: INCOME_UUID,
        }),
      )
    })
  })

  it('exceptional income submit → addIncome called with estimated_income_id undefined', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsIncome(user, { exceptional: true })
    await user.type(screen.getByLabelText(/description/i), 'Cadeau anniversaire')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '150')
    await user.click(screen.getByRole('button', { name: /^Ajouter le revenu$/i }))
    await waitFor(() => {
      expect(addIncome).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Cadeau anniversaire',
          amount: 150,
          estimated_income_id: undefined,
        }),
      )
    })
  })

  // Sprint Zod-Rollout v6 / Axe 3 — regression-guards for Axe 1 (a11y
  // attribute linkage) + Axe 2 (setFocus on invalid submit). Updated for
  // wizard (Sprint P4-P5-P6 / B3) — navigation to fields first.
  it('aria-describedby + aria-invalid + setFocus on invalid description (Axe 1 + 2)', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await navigateToFieldsExpense(user)
    // Submit empty form — description (min 1) is the first failing field
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/i }))
    const descInput = screen.getByLabelText(/description/i)
    await waitFor(() => {
      expect(descInput).toHaveAttribute('aria-invalid', 'true')
      expect(descInput).toHaveAttribute('aria-describedby', 'add-transaction-description-error')
    })
    const errorBox = document.getElementById('add-transaction-description-error')
    expect(errorBox).toBeTruthy()
    // Axe 2 setFocus assertion : focus moved to the first faulty field
    // waitFor : setFocus suit le rendu de l'erreur (cf. AddBudgetDialog.test.tsx).
    await waitFor(() => expect(descInput).toHaveFocus())
    expect(addExpense).not.toHaveBeenCalled()
  })
})

// Régression 2026-10-01 — étape 2 du récap : le menu « Budget associé »
// affichait le dépensé du mois courant (0,00 €/66,43 € pour un budget entamé
// le mois recapé). La modale transmet désormais le mois recapé à `useBudgets`.
describe('AddTransactionModal — dépensé du mois recapé dans le menu budget', () => {
  beforeEach(() => {
    useBudgetsCalls.length = 0
  })

  it('wizard récap : useBudgets reçoit le mois recapé et le menu affiche son dépensé', async () => {
    const user = userEvent.setup()
    render(
      <AddTransactionModal onClose={vi.fn()} context="profile" recapMonth={9} recapYear={2026} />,
    )
    await navigateToFieldsExpense(user)

    expect(useBudgetsCalls[useBudgetsCalls.length - 1]).toEqual([
      'profile',
      { month: 9, year: 2026 },
    ])
    expect(screen.getByRole('option', { name: 'Alimentation' })).toHaveAttribute('data-spent', '35')
  })

  it('dashboard : pas de fenêtre, mois courant inchangé', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} context="profile" />)
    await navigateToFieldsExpense(user)

    expect(useBudgetsCalls[useBudgetsCalls.length - 1]).toEqual(['profile', undefined])
    expect(screen.getByRole('option', { name: 'Alimentation' })).toHaveAttribute('data-spent', '0')
  })
})

// Régression 2026-10-01 — même cause que le menu budget : le reste à vivre de
// départ des aperçus doit inclure les dépassements du mois RECAPÉ.
describe('AddTransactionModal — reste à vivre du mois recapé', () => {
  beforeEach(() => {
    useFinancialDataCalls.length = 0
  })

  it('wizard récap : useFinancialData et l’aperçu RAV reçoivent le mois recapé', async () => {
    const user = userEvent.setup()
    render(
      <AddTransactionModal onClose={vi.fn()} context="profile" recapMonth={9} recapYear={2026} />,
    )
    await navigateToFieldsExpense(user, { exceptional: true })
    await user.type(screen.getByLabelText(/montant/i), '20')

    expect(useFinancialDataCalls[useFinancialDataCalls.length - 1]).toEqual([
      'profile',
      { month: 9, year: 2026 },
    ])
    const preview = screen.getByTestId('rav-preview')
    expect(preview).toHaveAttribute('data-month', '9')
    expect(preview).toHaveAttribute('data-year', '2026')
  })

  it('dashboard : pas de fenêtre', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} context="profile" />)
    await navigateToFieldsExpense(user, { exceptional: true })
    await user.type(screen.getByLabelText(/montant/i), '20')

    expect(useFinancialDataCalls[useFinancialDataCalls.length - 1]).toEqual(['profile', undefined])
    expect(screen.getByTestId('rav-preview')).toHaveAttribute('data-month', '')
  })
})

describe('AddTransactionModal — couvrir le dépassement (Sprint Expense-Overflow-Coverage)', () => {
  beforeEach(() => {
    addExpense.mockClear()
    addExpense.mockResolvedValue({ ok: true })
    fetchFresh.mockClear()
    previewData = OVERFLOW_PREVIEW
  })

  async function fillOverflowingExpense(user: UserEvent) {
    await navigateToFieldsExpense(user)
    await user.selectOptions(screen.getByTestId('fk-dropdown'), BUDGET_UUID)
    await user.type(screen.getByLabelText(/description/i), 'Concert')
    const amount = screen.getByLabelText(/montant/i)
    await user.clear(amount)
    await user.type(amount, '600')
  }

  it('dépassement avec réserves : encart + bouton « Suivant » → étape dédiée', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await fillOverflowingExpense(user)

    expect(screen.getByText(/Dépassement de 50,00/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Suivant$/ }))

    expect(
      await screen.findByRole('heading', { name: 'Couvrir le dépassement' }),
    ).toBeInTheDocument()
    expect(fetchFresh).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 600, budgetId: BUDGET_UUID }),
    )
    // Reste à vivre présélectionné : aucune réserve prise sans action.
    expect(screen.getByRole('radio', { name: /Imputer au reste à vivre/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(addExpense).not.toHaveBeenCalled()
  })

  it('choix « reste à vivre » : ajout sans couverture', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await fillOverflowingExpense(user)
    await user.click(screen.getByRole('button', { name: /^Suivant$/ }))
    await user.click(await screen.findByRole('button', { name: /^Ajouter la dépense$/ }))

    await waitFor(() => expect(addExpense).toHaveBeenCalledTimes(1))
    expect(addExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 600, overflow_coverage: undefined }),
    )
  })

  it('choix « réserves » + répartition automatique : tirelire puis économies', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await fillOverflowingExpense(user)
    await user.click(screen.getByRole('button', { name: /^Suivant$/ }))
    await user.click(await screen.findByRole('radio', { name: /Puiser dans mes réserves/ }))
    await user.click(screen.getByRole('button', { name: /Répartir automatiquement/ }))
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/ }))

    await waitFor(() => expect(addExpense).toHaveBeenCalledTimes(1))
    expect(addExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        overflow_coverage: {
          piggy: 20,
          budgets: [{ budget_id: OTHER_BUDGET_UUID, amount: 30 }],
        },
      }),
    )
  })

  it('réserves choisies puis retour à « reste à vivre » : rien n’est pris', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await fillOverflowingExpense(user)
    await user.click(screen.getByRole('button', { name: /^Suivant$/ }))
    await user.click(await screen.findByRole('radio', { name: /Puiser dans mes réserves/ }))
    await user.click(screen.getByRole('button', { name: /Répartir automatiquement/ }))
    await user.click(screen.getByRole('radio', { name: /Imputer au reste à vivre/ }))
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/ }))

    await waitFor(() => expect(addExpense).toHaveBeenCalledTimes(1))
    expect(addExpense).toHaveBeenCalledWith(
      expect.objectContaining({ overflow_coverage: undefined }),
    )
  })

  it('montants changés entre-temps (409) : message, répartition remise à zéro', async () => {
    addExpense.mockResolvedValueOnce({ ok: false, error: 'overflow-coverage-outdated' })
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={onClose} />)
    await fillOverflowingExpense(user)
    await user.click(screen.getByRole('button', { name: /^Suivant$/ }))
    await user.click(await screen.findByRole('radio', { name: /Puiser dans mes réserves/ }))
    await user.click(screen.getByRole('button', { name: /Répartir automatiquement/ }))
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/montants disponibles ont changé/)
    expect(onClose).not.toHaveBeenCalled()
    // Couverture remise à 0 : le bouton « Tout remettre à 0 » disparaît.
    expect(screen.queryByRole('button', { name: /Tout remettre à 0/ })).not.toBeInTheDocument()
  })

  it('retour aux champs : valeurs conservées', async () => {
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await fillOverflowingExpense(user)
    await user.click(screen.getByRole('button', { name: /^Suivant$/ }))
    await user.click(await screen.findByRole('button', { name: /Retour à l'étape précédente/ }))

    expect(screen.getByLabelText(/description/i)).toHaveValue('Concert')
    expect(screen.getByRole('button', { name: /^Suivant$/ })).toBeInTheDocument()
  })

  it('dépassement sans aucune réserve : ajout direct, imputé au reste à vivre', async () => {
    previewData = { ...OVERFLOW_PREVIEW, piggy_bank_before: 0, other_budgets_savings: [] }
    const user = userEvent.setup()
    render(<AddTransactionModal onClose={vi.fn()} />)
    await fillOverflowingExpense(user)

    expect(screen.getByText(/Aucune réserve disponible/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Ajouter la dépense$/ }))

    await waitFor(() => expect(addExpense).toHaveBeenCalledTimes(1))
    expect(addExpense).toHaveBeenCalledWith(
      expect.objectContaining({ overflow_coverage: undefined }),
    )
  })
})
