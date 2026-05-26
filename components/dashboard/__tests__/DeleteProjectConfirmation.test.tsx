import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Sprint Projets-Épargne 06 — RTL coverage pour la confirmation de
// suppression projet branchée dans `PlanningDrawer`. Monte le drawer
// minimal avec mocks de hooks pour exercer le flow complet : click kebab
// "Supprimer" → ConfirmationDialog → confirm → mutation + snackbar.
//
// Mirror la structure de mocks de `PlanningDrawer.test.tsx` mais laisse
// le `ConfirmationDialog` réel (non-stubbé) pour pouvoir vérifier message
// + bouton confirm.

const BUDGET_UUID = '11111111-1111-4111-8111-111111111111'
const INCOME_UUID = '22222222-2222-4222-8222-222222222222'
const PROJECT_UUID = '33333333-3333-4333-8333-333333333333'

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

vi.mock('@/hooks/useIncomes', () => ({
  useIncomes: () => ({
    incomes: [
      { id: INCOME_UUID, name: 'Salaire perso', estimated_amount: 100, is_monthly_recurring: true },
    ],
    loading: false,
    isFetching: false,
    error: null,
    addIncome: vi.fn(async () => true),
    updateIncome: vi.fn(async () => true),
    deleteIncome: vi.fn(async () => true),
    refreshIncomes: vi.fn(),
    totalIncomes: 100,
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
    incomeProgresses: [
      {
        incomeId: INCOME_UUID,
        incomeName: 'Salaire perso',
        estimatedAmount: 100,
        receivedAmount: 0,
        progressPercentage: 0,
        remainingAmount: 100,
      },
    ],
    loading: false,
    isFetching: false,
    error: null,
    refreshProgress: vi.fn(),
  }),
}))

// useProjects state mutable + spies — chaque test peut customiser
// `projectsState.list` et `deleteProjectMock.mockResolvedValueOnce(...)`.
const projectsState: {
  list: Array<{
    id: string
    profile_id: string | null
    group_id: string | null
    name: string
    target_amount: number
    monthly_allocation: number
    deadline_date: string
    amount_saved: number
    pending_delay_fraction: number
    created_at: string
    updated_at: string
  }>
} = { list: [] }

const deleteProjectMock = vi.fn<
  (id: string) => Promise<{ success: boolean; transferredAmount?: number }>
>(async () => ({ success: true, transferredAmount: 0 }))

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({
    projects: projectsState.list,
    loading: false,
    isFetching: false,
    error: null,
    addProject: vi.fn(async () => true),
    updateProject: vi.fn(async () => true),
    deleteProject: deleteProjectMock,
    refreshProjects: vi.fn(),
    totalMonthlyAllocations: projectsState.list.reduce(
      (s, p) => s + Number(p.monthly_allocation),
      0,
    ),
  }),
}))

vi.mock('@/hooks/usePeriodParam', () => ({
  usePeriodParam: () => ({ period: undefined, setPeriod: vi.fn() }),
}))

// Stub les lazy-loaded modals other-que ConfirmationDialog pour réduire
// la noise — on garde le vrai ConfirmationDialog (testé).
vi.mock('@/components/dashboard/AddBudgetDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/dashboard/AddIncomeDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/dashboard/AddProjectDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/dashboard/EditBudgetDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/dashboard/EditIncomeDialog', () => ({
  default: () => null,
}))
vi.mock('@/components/dashboard/EditProjectDialog', () => ({
  default: () => null,
}))

// ─── Imports (after mocks) ───────────────────────────────────────────────

import PlanningDrawer from '@/components/dashboard/PlanningDrawer'

function buildProject(
  overrides: Partial<(typeof projectsState.list)[number]> = {},
): (typeof projectsState.list)[number] {
  return {
    id: PROJECT_UUID,
    profile_id: 'user-1',
    group_id: null,
    name: 'Voyage Japon',
    target_amount: 7000,
    monthly_allocation: 195,
    deadline_date: '2030-01-01',
    amount_saved: 4084,
    pending_delay_fraction: 0,
    created_at: '2026-05-26T10:00:00Z',
    updated_at: '2026-05-26T10:00:00Z',
    ...overrides,
  }
}

async function openProjectDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
  // Switch vers l'onglet Projets puis click "Supprimer" via le kebab menu.
  await user.click(screen.getByRole('button', { name: /^Projets$/ }))
  await screen.findByText('Voyage Japon')
  // Le DropdownMenu rend un kebab button avec aria-label "Options" (cf.
  // components/ui/DropdownMenu.tsx). Plusieurs trigger buttons existent
  // (budget + projet) → on prend le dernier (le projet, rendu après).
  const kebabs = screen.getAllByRole('button', { name: /options/i })
  await user.click(kebabs[kebabs.length - 1]!)
  // L'item "Supprimer" du projet apparaît dans le menu — il y a aussi
  // celui du budget potentiellement déjà ouvert. On filtre par variant
  // visible.
  const deleteItems = await screen.findAllByText('Supprimer')
  // Le dernier "Supprimer" rendu correspond au menu projet ouvert le plus
  // récemment (Radix portal le pose en fin de DOM).
  await user.click(deleteItems[deleteItems.length - 1]!)
}

describe('PlanningDrawer — confirmation suppression projet (Sprint Projets-Épargne 06)', () => {
  it('amount_saved > 0 → message annonce le transfert + bouton "Supprimer et transférer"', async () => {
    projectsState.list = [buildProject({ amount_saved: 4084 })]
    deleteProjectMock.mockResolvedValueOnce({ success: true, transferredAmount: 4084 })
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={() => {}} />)

    await openProjectDeleteDialog(user)

    expect(
      await screen.findByText(/Êtes-vous sûr de vouloir supprimer le projet "Voyage Japon"/i),
    ).toBeInTheDocument()
    // Le montant épargné est affiché dans les details.
    expect(screen.getByText(/4\s*084,00\s*€/)).toBeInTheDocument()
    expect(screen.getByText(/reversé dans votre tirelire/i)).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /supprimer et transférer/i })).toBeInTheDocument()
  })

  it('confirm avec amount_saved > 0 → appelle deleteProject + snackbar tirelire visible', async () => {
    projectsState.list = [buildProject({ amount_saved: 4084 })]
    deleteProjectMock.mockReset()
    deleteProjectMock.mockResolvedValueOnce({ success: true, transferredAmount: 4084 })
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={() => {}} />)

    await openProjectDeleteDialog(user)
    await user.click(screen.getByRole('button', { name: /supprimer et transférer/i }))

    await waitFor(() => {
      expect(deleteProjectMock).toHaveBeenCalledWith(PROJECT_UUID)
    })

    const snackbar = await screen.findByRole('status')
    expect(snackbar).toHaveTextContent(/4\s*084,00\s*€/)
    expect(snackbar).toHaveTextContent(/transféré dans la tirelire/i)
  })

  it('amount_saved = 0 → message court "Projet supprimé" après confirm', async () => {
    projectsState.list = [buildProject({ amount_saved: 0 })]
    deleteProjectMock.mockReset()
    deleteProjectMock.mockResolvedValueOnce({ success: true, transferredAmount: 0 })
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={() => {}} />)

    await openProjectDeleteDialog(user)
    // Message court sans annonce tirelire.
    expect(screen.queryByText(/reversé dans votre tirelire/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^supprimer$/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^supprimer$/i }))
    await waitFor(() => {
      expect(deleteProjectMock).toHaveBeenCalledWith(PROJECT_UUID)
    })

    const snackbar = await screen.findByRole('status')
    expect(snackbar).toHaveTextContent(/projet supprimé/i)
  })

  it('cancel — ferme la modal sans appeler deleteProject', async () => {
    projectsState.list = [buildProject()]
    deleteProjectMock.mockReset()
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={() => {}} />)

    await openProjectDeleteDialog(user)
    await user.click(screen.getByRole('button', { name: /annuler/i }))

    await waitFor(() => {
      expect(
        screen.queryByText(/Êtes-vous sûr de vouloir supprimer le projet/i),
      ).not.toBeInTheDocument()
    })
    expect(deleteProjectMock).not.toHaveBeenCalled()
  })
})
