import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { expectEscClose } from './a11y-helpers'
import EditBudgetDialog from '@/components/dashboard/EditBudgetDialog'

// Sprint Zod-Rollout v6 / Axe 5 — automated a11y audit via axe-core ruleset.
// Sprint v7 / Axe 2 — extended from 2 → 7 surfaces (3 auth pages + 2 client
// modals added).
//
// Note: jest-axe's `toHaveNoViolations` matcher is incompatible with vitest
// 4.x (uses Jest-specific `this.utils` API). We use `axe()` directly + assert
// on `results.violations`. On failure, the assertion message lists each rule
// that fired — sufficient signal for diagnosis.

// ─── Shared mocks (hoisted) ─────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
}))

vi.mock('@/hooks/useAuth', () => ({
  useLogin: () => ({
    handleLogin: vi.fn(async () => ({ success: true })),
    isSubmitting: false,
    error: null,
    clearError: vi.fn(),
  }),
  useRequireGuest: () => ({ loading: false, isLoggedIn: false }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// Supabase auth surface — shared by forgot-password / reset-password / inscription
type ResetResp = { error: null | { message: string } }
type SessionResp = { data: { session: unknown }; error: null | { message: string } }
type UpdateResp = { error: null | { message: string } }
type SignUpResp = { data: { user: { id: string } | null }; error: null | { message: string } }

const resetPasswordForEmail = vi.fn(
  async (_email: string, _opts: unknown): Promise<ResetResp> => ({ error: null }),
)
const getSession = vi.fn(
  async (): Promise<SessionResp> => ({
    data: { session: { user: { id: 'u1' } } },
    error: null,
  }),
)
const updateUser = vi.fn(async (_args: unknown): Promise<UpdateResp> => ({ error: null }))
const signUp = vi.fn(
  async (_args: unknown): Promise<SignUpResp> => ({
    data: { user: { id: 'u1' } },
    error: null,
  }),
)

vi.mock('@/lib/supabase-client', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (email: string, opts: unknown) => resetPasswordForEmail(email, opts),
      getSession: () => getSession(),
      updateUser: (args: unknown) => updateUser(args),
      signUp: (args: unknown) => signUp(args),
    },
  },
}))

// ─── AddTransactionModal mock surface (5 hooks + 3 children) ────────────

const addExpense = vi.fn(async () => true)
const addIncome = vi.fn(async () => true)

const BUDGET_UUID = '11111111-1111-4111-8111-111111111111'
const INCOME_UUID = '22222222-2222-4222-8222-222222222222'

vi.mock('@/hooks/useBudgets', () => ({
  useBudgets: () => ({
    budgets: [
      { id: BUDGET_UUID, name: 'Alimentation', estimated_amount: 500, cumulated_savings: 0 },
    ],
    loading: false,
    error: null,
    addBudget: vi.fn(async () => true),
    updateBudget: vi.fn(async () => true),
    deleteBudget: vi.fn(async () => true),
    refreshBudgets: vi.fn(),
    totalBudgets: 500,
  }),
}))
vi.mock('@/hooks/useIncomes', () => ({
  useIncomes: () => ({
    incomes: [{ id: INCOME_UUID, name: 'Salaire', estimated_amount: 1500 }],
    loading: false,
    error: null,
    addIncome: vi.fn(async () => true),
    updateIncome: vi.fn(async () => true),
    deleteIncome: vi.fn(async () => true),
    refreshIncomes: vi.fn(),
    totalIncomes: 1500,
  }),
}))
vi.mock('@/hooks/useRealExpenses', () => ({
  useRealExpenses: () => ({
    addExpense,
    updateExpense: vi.fn(async () => true),
    deleteExpense: vi.fn(async () => true),
    expenses: [],
  }),
}))
vi.mock('@/hooks/useRealIncomes', () => ({
  useRealIncomes: () => ({
    addIncome,
    updateIncome: vi.fn(async () => true),
    deleteIncome: vi.fn(async () => true),
    incomes: [],
  }),
}))
vi.mock('@/hooks/useProgressData', () => ({
  useProgressData: () => ({ expenseProgress: {} }),
}))
vi.mock('@/hooks/useFinancialData', () => ({
  useFinancialData: () => ({ financialData: { remainingToLive: 1000 } }),
}))
vi.mock('@/components/dashboard/RemainingToLivePreview', () => ({
  default: () => null,
}))
vi.mock('@/components/dashboard/ExpenseBreakdownPreview', () => ({
  default: () => null,
}))
vi.mock('@/components/ui/CustomDropdown', () => ({
  default: ({
    options,
    value,
    onChange,
    placeholder,
  }: {
    options: Array<{ id: string; name: string }>
    value: string
    onChange: (v: string) => void
    placeholder?: string
  }) => (
    <select
      aria-label={placeholder ?? 'Sélection'}
      data-testid="fk-dropdown"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— select —</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  ),
}))

// ─── Sprint v9 mocks (PlanningDrawer + SavingsDistribution + Group modals) ───

vi.mock('@/hooks/useBudgetProgress', () => ({
  useBudgetProgress: () => ({
    budgetProgresses: [],
    loading: false,
    error: null,
    refreshProgress: vi.fn(),
  }),
}))
vi.mock('@/hooks/useIncomeProgress', () => ({
  useIncomeProgress: () => ({
    incomeProgresses: [],
    loading: false,
    error: null,
    refreshProgress: vi.fn(),
  }),
}))
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 'u1', group_id: null } }),
}))
vi.mock('@/hooks/useGroupMembers', () => ({
  useGroupMembers: () => ({
    members: [],
    isLoading: false,
    error: null,
    fetchGroupMembers: vi.fn(),
    clearMembers: vi.fn(),
  }),
}))
vi.mock('@/hooks/useGroupContributions', () => ({
  useGroupContributions: () => ({
    contributions: [],
    groupInfo: null,
    isLoading: false,
    error: null,
    fetchContributions: vi.fn(),
  }),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => undefined),
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
  useQueryClient: () => ({
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    getQueryData: vi.fn(),
  }),
}))

// ─── Imports (after mocks) ──────────────────────────────────────────────

import ConnexionPage from '@/app/connexion/page'
import AddBudgetDialog from '@/components/dashboard/AddBudgetDialog'
import ForgotPasswordPage from '@/app/forgot-password/page'
import NouveauMotDePassePage from '@/app/reset-password/page'
import InscriptionPage from '@/app/inscription/page'
import AddIncomeDialog from '@/components/dashboard/AddIncomeDialog'
import AddTransactionModal from '@/components/dashboard/AddTransactionModal'
import EditIncomeDialog from '@/components/dashboard/EditIncomeDialog'
import EditTransactionModal from '@/components/dashboard/EditTransactionModal'
import GroupMembersWithContributionsModal from '@/components/groups/GroupMembersWithContributionsModal'
import DeleteGroupModal from '@/components/groups/DeleteGroupModal'
import ConfirmationDialog from '@/components/ui/ConfirmationDialog'
import PlanningDrawer from '@/components/dashboard/PlanningDrawer'
import SavingsDistributionDrawer from '@/components/dashboard/SavingsDistributionDrawer'
import type { GroupData } from '@/app/api/groups/route'
import type { RealExpense } from '@/hooks/useRealExpenses'

describe('axe-core a11y audit (regression-guard)', () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset()
    getSession.mockReset()
    updateUser.mockReset()
    signUp.mockReset()
    resetPasswordForEmail.mockResolvedValue({ error: null })
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    updateUser.mockResolvedValue({ error: null })
    signUp.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  })

  it('connexion page has no critical a11y violations', async () => {
    const { container } = render(<ConnexionPage />)
    const results = await axe(container)
    expect(results.violations).toEqual([])
  })

  it('AddBudgetDialog has no critical a11y violations', async () => {
    const { container } = render(
      <AddBudgetDialog isOpen onClose={() => {}} onSave={() => {}} currentRav={1500} />,
    )
    const results = await axe(container)
    expect(results.violations).toEqual([])
  })

  it('ForgotPasswordPage has no critical a11y violations', async () => {
    const { container } = render(<ForgotPasswordPage />)
    const results = await axe(container)
    expect(results.violations).toEqual([])
  })

  it('ResetPasswordPage (valid session, form visible) has no critical a11y violations', async () => {
    const { container } = render(<NouveauMotDePassePage />)
    // Wait for the useEffect that calls getSession to mount the form
    await waitFor(() => {
      expect(screen.getByLabelText(/nouveau mot de passe/i)).toBeInTheDocument()
    })
    const results = await axe(container)
    expect(results.violations).toEqual([])
  })

  it('InscriptionPage has no critical a11y violations', async () => {
    const { container } = render(<InscriptionPage />)
    const results = await axe(container)
    expect(results.violations).toEqual([])
  })

  it('AddIncomeDialog has no critical a11y violations', async () => {
    const { container } = render(
      <AddIncomeDialog isOpen onClose={() => {}} onSave={() => {}} currentRav={1500} />,
    )
    const results = await axe(container)
    expect(results.violations).toEqual([])
  })

  it('AddTransactionModal has no critical a11y violations', async () => {
    const { container } = render(<AddTransactionModal onClose={() => {}} />)
    const results = await axe(container)
    expect(results.violations).toEqual([])
  })
})

// Sprint Zod-Rollout v8 / Commit 6 — focus-trap + Esc-to-close regression-guards.
// Pin the Radix Dialog contract on representative surfaces : EditBudget (simple
// centered form modal) + AddTransactionModal (heavy 6-hook surface). Esc closing
// proves that Radix's onEscapeKeyDown wiring fires through to our onOpenChange
// handler which calls onClose. If a future migration breaks this (e.g. wrap a
// modal in raw `<div>` again), these tests will catch it before merge.
describe('Radix Dialog focus-trap + Esc-to-close (regression-guard)', () => {
  it('EditBudgetDialog: Esc keydown invokes onClose', async () => {
    const onClose = vi.fn()
    await expectEscClose(
      <EditBudgetDialog
        isOpen
        onClose={onClose}
        onSave={async () => true}
        budget={{ id: 'b-1', name: 'Alimentation', estimated_amount: 500 }}
        currentRav={1500}
      />,
      onClose,
      'Modifier le budget',
    )
  })

  it('AddTransactionModal: Esc keydown invokes onClose', async () => {
    // Sprint P4-P5-P6 / B1 — wizard refactored. Step 1 title is now
    // "Type de transaction" (was "Ajouter une transaction" pre-wizard).
    const onClose = vi.fn()
    await expectEscClose(<AddTransactionModal onClose={onClose} />, onClose, 'Type de transaction')
  })

  // ─── Sprint v9 / Axe 1 — extended focus-trap coverage for remaining v8 modals ──

  it('AddBudgetDialog: Esc keydown invokes onClose', async () => {
    const onClose = vi.fn()
    await expectEscClose(
      <AddBudgetDialog isOpen onClose={onClose} onSave={async () => true} currentRav={1500} />,
      onClose,
      'Nouveau Budget',
    )
  })

  it('AddIncomeDialog: Esc keydown invokes onClose', async () => {
    const onClose = vi.fn()
    await expectEscClose(
      <AddIncomeDialog isOpen onClose={onClose} onSave={async () => true} currentRav={1500} />,
      onClose,
      'Nouveau Revenu',
    )
  })

  it('EditIncomeDialog: Esc keydown invokes onClose', async () => {
    const onClose = vi.fn()
    const income = {
      id: INCOME_UUID,
      name: 'Salaire',
      estimated_amount: 1500,
      is_monthly_recurring: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    await expectEscClose(
      <EditIncomeDialog
        isOpen
        onClose={onClose}
        onSave={async () => true}
        income={income}
        currentRav={1500}
      />,
      onClose,
      'Modifier le revenu',
    )
  })

  it('EditTransactionModal: Esc keydown invokes onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const transaction: RealExpense = {
      id: '33333333-3333-4333-8333-333333333333',
      amount: 50,
      description: 'Test expense',
      expense_date: '2026-05-14',
      is_exceptional: false,
      created_at: '2026-05-14T00:00:00Z',
      estimated_budget_id: BUDGET_UUID,
    }
    render(
      <EditTransactionModal
        isOpen
        onClose={onClose}
        transaction={transaction}
        transactionType="expense"
      />,
    )
    // Title "Modifier la dépense" appears in both the H2 heading and the submit
    // button. Target the heading specifically (level 2) to disambiguate.
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: /Modifier la dépense/i }),
      ).toBeInTheDocument()
    })
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('ConfirmationDialog: Esc keydown invokes onClose', async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    await expectEscClose(
      <ConfirmationDialog
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        title="Confirmer l'action"
        message="Êtes-vous sûr ?"
      />,
      onClose,
      "Confirmer l'action",
    )
  })

  it('DeleteGroupModal: Esc keydown invokes onClose', async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn(async () => true)
    const group: GroupData = {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Mon groupe',
      monthly_budget_estimate: 2000,
      creator_id: 'u1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    await expectEscClose(
      <DeleteGroupModal group={group} isOpen onClose={onClose} onConfirm={onConfirm} />,
      onClose,
      'Supprimer le groupe',
    )
  })

  it('GroupMembersWithContributionsModal: Esc keydown invokes onClose', async () => {
    const onClose = vi.fn()
    const group: GroupData = {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Mon groupe',
      monthly_budget_estimate: 2000,
      creator_id: 'u1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    await expectEscClose(
      <GroupMembersWithContributionsModal group={group} isOpen onClose={onClose} />,
      onClose,
      'Membres et contributions',
    )
  })

  it('PlanningDrawer: Esc keydown invokes onClose', async () => {
    const onClose = vi.fn()
    await expectEscClose(
      <PlanningDrawer isOpen onClose={onClose} />,
      onClose,
      'Planification Financière',
    )
  })

  it('SavingsDistributionDrawer: Esc keydown invokes onClose', async () => {
    const onClose = vi.fn()
    await expectEscClose(
      <SavingsDistributionDrawer isOpen onClose={onClose} />,
      onClose,
      'Répartition des Économies',
    )
  })

  it('PlanningDrawer with AddBudget child: Esc closes child first, then drawer', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<PlanningDrawer isOpen onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText('Planification Financière')).toBeInTheDocument()
    })

    // Open child via the "Ajouter un budget" button (PlanningDrawer.tsx L468-473)
    const addBudgetBtn = screen.getByRole('button', { name: /ajouter un budget/i })
    await user.click(addBudgetBtn)

    // Wait for lazy-loaded AddBudgetDialog (next/dynamic ssr:false)
    await waitFor(
      () => {
        expect(screen.getByText('Nouveau Budget')).toBeInTheDocument()
      },
      { timeout: 3000 },
    )

    // First Esc — closes the child (Radix portal stacking)
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByText('Nouveau Budget')).not.toBeInTheDocument()
    })
    expect(onClose).not.toHaveBeenCalled()

    // Second Esc — closes the parent drawer
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
