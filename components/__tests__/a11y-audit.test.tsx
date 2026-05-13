import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { axe } from 'jest-axe'

// Sprint Zod-Rollout v6 / Axe 5 — automated a11y audit via axe-core ruleset.
// Covers 2 representative surfaces (1 auth page + 1 client modal) ; can be
// extended PR-by-PR. ~500ms per case (DOM parse + ruleset evaluation).
//
// Note: jest-axe's `toHaveNoViolations` matcher is incompatible with vitest
// 4.x (uses Jest-specific `this.utils` API). We use `axe()` directly + assert
// on `results.violations`. On failure, the assertion message lists each rule
// that fired — sufficient signal for diagnosis.

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

import ConnexionPage from '@/app/connexion/page'
import AddBudgetDialog from '@/components/dashboard/AddBudgetDialog'

describe('axe-core a11y audit (regression-guard)', () => {
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
})
