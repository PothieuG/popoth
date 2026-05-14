import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, vi } from 'vitest'
import type { ReactElement } from 'react'

/**
 * Asserts that pressing Escape inside the rendered Dialog invokes its onClose
 * callback. Centralizes the focus-trap regression-guard boilerplate that was
 * duplicated across 10 test cases in [a11y-audit.test.tsx](./a11y-audit.test.tsx)
 * since Sprint Zod-Rollout v8/v9 (Sprint Zod-Rollout v10 / Axe 2).
 *
 * Limitation : only supports `screen.getByText(titleText)` for mount assertion.
 * Tests using `getByRole('heading', { level: 2 })` (e.g. EditTransactionModal
 * disambiguation between H2 + submit button sharing the same text) or complex
 * stacking flows (nested PlanningDrawer + AddBudget child with 2 Esc keystrokes)
 * must stay manual.
 *
 * @example
 *   const onClose = vi.fn()
 *   await expectEscClose(
 *     <AddBudgetDialog isOpen onClose={onClose} onSave={async () => true} ... />,
 *     onClose,
 *     'Nouveau Budget',
 *   )
 */
export async function expectEscClose(
  element: ReactElement,
  onClose: ReturnType<typeof vi.fn>,
  titleText: string | RegExp,
): Promise<void> {
  const user = userEvent.setup()
  render(element)
  await waitFor(() => {
    expect(screen.getByText(titleText)).toBeInTheDocument()
  })
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
}
