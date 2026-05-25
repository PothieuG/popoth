import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RecapProgressFrieze } from '../RecapProgressFrieze'

describe('RecapProgressFrieze', () => {
  it('renders step 1/6 (welcome) with 17% bar width (sprint Complete-Month-Step)', () => {
    render(<RecapProgressFrieze currentStep="welcome" />)
    expect(screen.getByText(/Étape 1 sur 6 — Bienvenue/)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveStyle({ width: '17%' })
    expect(bar).toHaveAttribute('aria-valuenow', '17')
  })

  it('renders step 2/6 (complete_month) with 33% bar width', () => {
    render(<RecapProgressFrieze currentStep="complete_month" />)
    expect(screen.getByText(/Étape 2 sur 6 — Compléter le mois/)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveStyle({ width: '33%' })
  })

  it('renders step 5/6 (salary_update) with 83% bar width', () => {
    render(<RecapProgressFrieze currentStep="salary_update" />)
    expect(screen.getByText(/Étape 5 sur 6 — Salaire/)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveStyle({ width: '83%' })
  })

  it('renders step 6/6 with 100% bar when step is completed (defensive)', () => {
    render(<RecapProgressFrieze currentStep="completed" />)
    expect(screen.getByText(/Étape 6 sur 6 — Final/)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveStyle({ width: '100%' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
  })
})
