import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { axe } from 'jest-axe'

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
  useRouter: () => ({ push: vi.fn() }),
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

// ─── AddTransactionModal mock surface (6 hooks + 3 children) ────────────

const addExpense = vi.fn(async () => true)
const addIncome = vi.fn(async () => true)
const ravState: { blocked: boolean; newRav: number } = { blocked: false, newRav: 0 }

const BUDGET_UUID = '11111111-1111-4111-8111-111111111111'
const INCOME_UUID = '22222222-2222-4222-8222-222222222222'

vi.mock('@/hooks/useBudgets', () => ({
  useBudgets: () => ({
    budgets: [
      { id: BUDGET_UUID, name: 'Alimentation', estimated_amount: 500, cumulated_savings: 0 },
    ],
  }),
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
vi.mock('@/hooks/useProgressData', () => ({
  useProgressData: () => ({ expenseProgress: {} }),
}))
vi.mock('@/hooks/useFinancialData', () => ({
  useFinancialData: () => ({ financialData: { remainingToLive: 1000 } }),
}))
vi.mock('@/hooks/useRavValidation', () => ({
  useRavValidation: () => ravState,
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

// ─── Imports (after mocks) ──────────────────────────────────────────────

import ConnexionPage from '@/app/connexion/page'
import AddBudgetDialog from '@/components/dashboard/AddBudgetDialog'
import ForgotPasswordPage from '@/app/forgot-password/page'
import NouveauMotDePassePage from '@/app/reset-password/page'
import InscriptionPage from '@/app/inscription/page'
import AddIncomeDialog from '@/components/dashboard/AddIncomeDialog'
import AddTransactionModal from '@/components/dashboard/AddTransactionModal'

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
    ravState.blocked = false
    ravState.newRav = 0
  })

  it('connexion page has no critical a11y violations', async () => {
    const { container } = render(<ConnexionPage />)
    const results = await axe(container)
    expect(results.violations).toEqual([])
  })

  it('AddBudgetDialog has no critical a11y violations', async () => {
    const { container } = render(
      <AddBudgetDialog
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        currentBudgetsTotal={500}
        totalEstimatedIncome={2000}
      />,
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
      <AddIncomeDialog
        isOpen
        onClose={() => {}}
        onSave={() => {}}
        currentIncomesTotal={1500}
      />,
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
