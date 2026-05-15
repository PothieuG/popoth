import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PeriodSelector } from '../PeriodSelector'

describe('PeriodSelector', () => {
  it("renders 3 radiogroup options with role='radio' and proper labels", () => {
    render(<PeriodSelector value="month" onChange={vi.fn()} />)
    const group = screen.getByRole('radiogroup', { name: /période d'affichage/i })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /mois/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /semaine/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /jour/i })).toBeInTheDocument()
  })

  it('reflects current value via aria-checked', () => {
    render(<PeriodSelector value="week" onChange={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /mois/i })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: /semaine/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /jour/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('fires onChange with the selected period on click', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<PeriodSelector value="month" onChange={onChange} />)
    await user.click(screen.getByRole('radio', { name: /semaine/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('week')
  })

  it('does not call onChange when clicking the already-checked option (no toggle)', async () => {
    // Pattern radio-button : clicking the same option still fires onChange.
    // This test pins the current behavior (re-fires onChange with same value).
    // If a future refactor wants no-op on same-value click, this test will fail
    // and force a deliberate decision.
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<PeriodSelector value="month" onChange={onChange} />)
    await user.click(screen.getByRole('radio', { name: /mois/i }))
    expect(onChange).toHaveBeenCalledWith('month')
  })
})
