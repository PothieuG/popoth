import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import type { ReadOnlyIncome } from '@/lib/finance'

// Sprint 16 Monthly Recap V3 — RTL coverage for virtual read-only rows
// (salaire perso, contribution groupe) injected via the new `readOnlyIncomes`
// prop. The drawer used to hardcode the salary row from `useProfile()` ; that
// path is gone and replaced by a generic loop driven by `FinancialData.meta`.

// ─── Mocks (hoisted) ─────────────────────────────────────────────────────

const BUDGET_UUID = '11111111-1111-4111-8111-111111111111'
const INCOME_UUID = '22222222-2222-4222-8222-222222222222'

vi.mock('@/hooks/useBudgets', () => ({
  useBudgets: () => ({
    budgets: [
      { id: BUDGET_UUID, name: 'Alimentation', estimated_amount: 500, cumulated_savings: 0 },
    ],
    loading: false,
    isFetching: false,
    error: null,
    addBudget: vi.fn(async () => true),
    updateBudget: vi.fn(async () => true),
    deleteBudget: vi.fn(async () => ({ success: true, transferredAmount: 0 })),
    refreshBudgets: vi.fn(),
    totalBudgets: 500,
  }),
}))

const incomesState: {
  list: Array<{ id: string; name: string; estimated_amount: number; is_monthly_recurring: boolean }>
  total: number
} = {
  list: [
    { id: INCOME_UUID, name: 'Salaire perso', estimated_amount: 100, is_monthly_recurring: true },
  ],
  total: 100,
}

vi.mock('@/hooks/useIncomes', () => ({
  useIncomes: () => ({
    incomes: incomesState.list,
    loading: false,
    isFetching: false,
    error: null,
    addIncome: vi.fn(async () => true),
    updateIncome: vi.fn(async () => true),
    deleteIncome: vi.fn(async () => true),
    refreshIncomes: vi.fn(),
    totalIncomes: incomesState.total,
  }),
}))

vi.mock('@/hooks/useBudgetProgress', () => ({
  useBudgetProgress: () => ({
    budgetProgresses: [
      {
        budgetId: BUDGET_UUID,
        budgetName: 'Alimentation',
        estimatedAmount: 500,
        spentAmount: 0,
        progressPercentage: 0,
        remainingAmount: 500,
      },
    ],
    loading: false,
    isFetching: false,
    error: null,
    refreshProgress: vi.fn(),
  }),
}))

vi.mock('@/hooks/useIncomeProgress', () => ({
  useIncomeProgress: () => ({
    incomeProgresses: incomesState.list.map((i) => ({
      incomeId: i.id,
      incomeName: i.name,
      estimatedAmount: i.estimated_amount,
      receivedAmount: 0,
      progressPercentage: 0,
      remainingAmount: i.estimated_amount,
    })),
    loading: false,
    isFetching: false,
    error: null,
    refreshProgress: vi.fn(),
  }),
}))

// Sprint Projets-Épargne 04 — mock `useProjects` avec état mutable pour
// pouvoir tester empty state + list state dans le même fichier.
const projectsState: { list: ReturnType<typeof buildProject>[]; total: number } = {
  list: [],
  total: 0,
}

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    profile_id: 'user-1',
    group_id: null,
    name: 'Voyage Japon',
    target_amount: 7000,
    monthly_allocation: 195,
    deadline_date: '2029-05-01',
    amount_saved: 4084,
    pending_delay_fraction: 0,
    created_at: '2026-05-26T10:00:00Z',
    updated_at: '2026-05-26T10:00:00Z',
    ...overrides,
  } as unknown as import('@/hooks/useProjects').SavingsProject
}

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({
    projects: projectsState.list,
    loading: false,
    isFetching: false,
    error: null,
    addProject: vi.fn(async () => true),
    updateProject: vi.fn(async () => true),
    deleteProject: vi.fn(async () => ({ success: true })),
    refreshProjects: vi.fn(),
    totalMonthlyAllocations: projectsState.total,
  }),
}))

vi.mock('@/hooks/usePeriodParam', () => ({
  usePeriodParam: () => ({ period: undefined, setPeriod: vi.fn() }),
}))

// Lazy-loaded children — stub to plain `<div>` so we can assert "did Edit/Add
// open ?" without exercising the deep dialog tree.
vi.mock('@/components/dashboard/AddBudgetDialog', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="add-budget-dialog" /> : null,
}))
vi.mock('@/components/dashboard/AddIncomeDialog', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="add-income-dialog" /> : null,
}))
vi.mock('@/components/dashboard/EditBudgetDialog', () => ({
  default: ({ budget }: { budget: { id: string; name: string } }) => (
    <div data-testid="edit-budget-dialog">{budget.name}</div>
  ),
}))
vi.mock('@/components/dashboard/EditIncomeDialog', () => ({
  default: ({ income }: { income: { id: string; name: string } }) => (
    <div data-testid="edit-income-dialog">{income.name}</div>
  ),
}))
vi.mock('@/components/ui/ConfirmationDialog', () => ({
  default: () => null,
}))

// ─── Imports (after mocks) ──────────────────────────────────────────────

import PlanningDrawer from '@/components/dashboard/PlanningDrawer'

const SALARY_ROW: ReadOnlyIncome = { kind: 'salary', label: 'Salaire', amount: 2500 }
const CONTRIBUTION_ROW: ReadOnlyIncome = {
  kind: 'contribution',
  label: 'Contribution de Alice',
  amount: 1000,
}
const CONTRIBUTION_ROW_BOB: ReadOnlyIncome = {
  kind: 'contribution',
  label: 'Contribution de Bob',
  amount: 500,
}

function switchToRevenusTab(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: /^Revenus$/ }))
}

describe('PlanningDrawer — virtual read-only rows (Sprint 16 V3)', () => {
  it('renders the salary row with lock badge "Profil" when readOnlyIncomes=[salary]', async () => {
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={() => {}} readOnlyIncomes={[SALARY_ROW]} />)
    await switchToRevenusTab(user)

    const salaryRow = await screen.findByTestId('readonly-income-salary')
    expect(salaryRow).toHaveTextContent('Salaire')
    expect(salaryRow).toHaveTextContent('Profil')
    expect(salaryRow).toHaveTextContent(/2\s*500,00\s*€/)
    // Lecture seule signalée via aria-label sur l'icône cadenas.
    expect(salaryRow.querySelector('[aria-label="Lecture seule"]')).not.toBeNull()
  })

  it('renders the contribution row with lock badge "Groupe" when readOnlyIncomes=[contribution]', async () => {
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={() => {}} readOnlyIncomes={[CONTRIBUTION_ROW]} />)
    await switchToRevenusTab(user)

    const row = await screen.findByTestId('readonly-income-contribution')
    expect(row).toHaveTextContent('Contribution de Alice')
    expect(row).toHaveTextContent('Groupe')
    expect(row).toHaveTextContent(/1\s*000,00\s*€/)
  })

  it('renders one line per member when readOnlyIncomes contains multiple contributions', async () => {
    const user = userEvent.setup()
    render(
      <PlanningDrawer
        isOpen
        onClose={() => {}}
        readOnlyIncomes={[CONTRIBUTION_ROW, CONTRIBUTION_ROW_BOB]}
      />,
    )
    await switchToRevenusTab(user)

    const rows = await screen.findAllByTestId('readonly-income-contribution')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Contribution de Alice')
    expect(rows[0]).toHaveTextContent(/1\s*000,00\s*€/)
    expect(rows[1]).toHaveTextContent('Contribution de Bob')
    expect(rows[1]).toHaveTextContent(/500,00\s*€/)
  })

  it('renders virtual row(s) BEFORE the real income rows', async () => {
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={() => {}} readOnlyIncomes={[SALARY_ROW]} />)
    await switchToRevenusTab(user)

    const list = await screen.findByText('Salaire').then((el) => el.closest('.space-y-2'))
    expect(list).not.toBeNull()
    const rows = Array.from(list!.children) as HTMLElement[]
    // Au moins 2 lignes (virtual salary + 1 mock real income), virtual en tête.
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0]?.getAttribute('data-testid')).toBe('readonly-income-salary')
  })

  it('does NOT render Modifier/Supprimer affordance on a read-only row', async () => {
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={() => {}} readOnlyIncomes={[SALARY_ROW]} />)
    await switchToRevenusTab(user)

    const salaryRow = await screen.findByTestId('readonly-income-salary')
    // Le dropdown kebab des real incomes pose un button trigger ; sur les
    // virtual rows, aucun bouton n'est rendu dans la carte.
    expect(salaryRow.querySelector('button')).toBeNull()
  })

  it('"Total estimé" reflects sum(real incomes) + sum(readOnlyIncomes)', async () => {
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={() => {}} readOnlyIncomes={[SALARY_ROW]} />)
    await switchToRevenusTab(user)

    // Mock totalIncomes = 100 (Salaire perso) + readOnly 2500 = 2 600,00 €.
    await waitFor(() => {
      expect(screen.getByText(/2\s*600,00\s*€/)).toBeInTheDocument()
    })
  })

  it('falls back to empty state when both incomes and readOnlyIncomes are empty', async () => {
    incomesState.list = []
    incomesState.total = 0
    try {
      const user = userEvent.setup()
      render(<PlanningDrawer isOpen onClose={() => {}} readOnlyIncomes={[]} />)
      await switchToRevenusTab(user)

      expect(await screen.findByText(/Aucun revenu configuré/i)).toBeInTheDocument()
    } finally {
      // Restore for other tests
      incomesState.list = [
        {
          id: INCOME_UUID,
          name: 'Salaire perso',
          estimated_amount: 100,
          is_monthly_recurring: true,
        },
      ]
      incomesState.total = 100
    }
  })

  it('passes axe-core a11y audit with a mix of virtual + real rows', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <PlanningDrawer isOpen onClose={() => {}} readOnlyIncomes={[SALARY_ROW, CONTRIBUTION_ROW]} />,
    )
    await switchToRevenusTab(user)
    await screen.findByTestId('readonly-income-salary')

    const results = await axe(container)
    expect(results.violations).toEqual([])
  })
})

// ─── Sprint Projets-Épargne 04 — onglet "Projets" ────────────────────────

function switchToProjetsTab(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: /^Projets$/ }))
}

describe('PlanningDrawer — onglet "Projets" (Sprint Projets-Épargne 04)', () => {
  it('renders empty state when there are no projects', async () => {
    projectsState.list = []
    projectsState.total = 0
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={() => {}} />)
    await switchToProjetsTab(user)

    expect(await screen.findByText(/Aucun projet en cours/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Créer votre premier projet/i })).toBeInTheDocument()
  })

  it('renders one row per project with the test id "projects-list"', async () => {
    projectsState.list = [buildProject()]
    projectsState.total = 195
    try {
      const user = userEvent.setup()
      render(<PlanningDrawer isOpen onClose={() => {}} />)
      await switchToProjetsTab(user)

      const list = await screen.findByTestId('projects-list')
      expect(list).toBeInTheDocument()
      expect(screen.getByText('Voyage Japon')).toBeInTheDocument()
      // Total mensuel discret affiche la somme des allocations
      expect(screen.getByText(/195,00\s*€/)).toBeInTheDocument()
    } finally {
      projectsState.list = []
      projectsState.total = 0
    }
  })

  it('Esc closes the drawer when the Projets tab is active (focus-trap regression-guard)', async () => {
    projectsState.list = []
    projectsState.total = 0
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={onClose} />)
    await switchToProjetsTab(user)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
