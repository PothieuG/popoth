import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RecapProgressFrieze } from '../RecapProgressFrieze'

describe('RecapProgressFrieze', () => {
  it('renders step 1/5 (welcome) with 20% bar width', () => {
    render(<RecapProgressFrieze currentStep="welcome" />)
    expect(screen.getByText(/Étape 1 sur 5 — Bienvenue/)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveStyle({ width: '20%' })
    expect(bar).toHaveAttribute('aria-valuenow', '20')
  })

  it('renders step 4/5 (salary_update) with 80% bar width', () => {
    render(<RecapProgressFrieze currentStep="salary_update" />)
    expect(screen.getByText(/Étape 4 sur 5 — Salaire/)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveStyle({ width: '80%' })
  })

  it('renders step 5/5 with 100% bar when step is completed (defensive)', () => {
    render(<RecapProgressFrieze currentStep="completed" />)
    expect(screen.getByText(/Étape 5 sur 5 — Final/)).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveStyle({ width: '100%' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
  })
})
