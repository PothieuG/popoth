import { render, screen } from '@testing-library/react'
import { axe } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'

import type { SavingsProjectMeta } from '@/lib/finance/types'

import { SavingsProjectsDetailDrawer } from '../SavingsProjectsDetailDrawer'
import { expectEscClose } from '../../__tests__/a11y-helpers'

function makeProject(overrides: Partial<SavingsProjectMeta>): SavingsProjectMeta {
  return {
    id: 'p1',
    name: 'Japon',
    monthlyAllocation: 200,
    amountSaved: 4084,
    targetAmount: 7000,
    deadlineDate: '2027-12-31',
    monthsRemaining: 19,
    pendingDelayFraction: 0,
    ...overrides,
  }
}

describe('SavingsProjectsDetailDrawer', () => {
  it('renders each project with name, progress %, amount saved/target and deadline copy', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Japon', amountSaved: 4084, targetAmount: 7000 }),
      makeProject({
        id: 'p2',
        name: 'Voiture',
        amountSaved: 320,
        targetAmount: 1500,
        deadlineDate: '2027-06-30',
        monthsRemaining: 13,
      }),
      makeProject({
        id: 'p3',
        name: 'Vélo',
        amountSaved: 500,
        targetAmount: 500,
        deadlineDate: '2026-08-15',
        monthsRemaining: 3,
      }),
    ]
    render(<SavingsProjectsDetailDrawer isOpen onClose={vi.fn()} projects={projects} />)

    expect(screen.getByRole('heading', { name: 'Projets en cours' })).toBeInTheDocument()
    expect(screen.getByText('Japon')).toBeInTheDocument()
    expect(screen.getByText('Voiture')).toBeInTheDocument()
    expect(screen.getByText('Vélo')).toBeInTheDocument()

    // Japon : 4084 / 7000 ≈ 58.34% → rounded to 58
    expect(screen.getByLabelText('58% atteint')).toBeInTheDocument()
    // Voiture : 320 / 1500 ≈ 21.33% → rounded to 21
    expect(screen.getByLabelText('21% atteint')).toBeInTheDocument()
    // Vélo : 500 / 500 = 100%
    expect(screen.getByLabelText('100% atteint')).toBeInTheDocument()

    // Montant Japon : 4 084,00 € / 7 000,00 €
    expect(screen.getByText(/4\s084,00/)).toBeInTheDocument()
    expect(screen.getByText(/7\s000,00/)).toBeInTheDocument()

    // Deadline + months remaining copy (Japon : 19 mois → pluriel)
    expect(screen.getByText(/Échéance : 31\/12\/2027 · 19 mois restants/)).toBeInTheDocument()
    // Voiture deadline + 13 mois
    expect(screen.getByText(/Échéance : 30\/06\/2027 · 13 mois restants/)).toBeInTheDocument()
    // Vélo deadline + 3 mois (still plural for any value ≠ 1)
    expect(screen.getByText(/Échéance : 15\/08\/2026 · 3 mois restants/)).toBeInTheDocument()
  })

  it('uses singular copy when a project has exactly 1 month remaining', () => {
    const projects = [makeProject({ monthsRemaining: 1 })]
    render(<SavingsProjectsDetailDrawer isOpen onClose={vi.fn()} projects={projects} />)

    expect(screen.getByText(/1 mois restant\b/)).toBeInTheDocument()
  })

  it('shows empty-state copy when projects list is empty', () => {
    render(<SavingsProjectsDetailDrawer isOpen onClose={vi.fn()} projects={[]} />)

    expect(screen.getByText("Tu n'as aucun projet en cours pour l'instant.")).toBeInTheDocument()
  })

  it('does NOT render content when isOpen=false (Radix unmounts)', () => {
    render(
      <SavingsProjectsDetailDrawer isOpen={false} onClose={vi.fn()} projects={[makeProject({})]} />,
    )

    expect(screen.queryByRole('heading', { name: 'Projets en cours' })).not.toBeInTheDocument()
  })

  it('renders the close button with aria-label="Fermer"', () => {
    render(<SavingsProjectsDetailDrawer isOpen onClose={vi.fn()} projects={[]} />)
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument()
  })

  it('calls onClose when Escape is pressed (focus-trap regression guard)', async () => {
    const onClose = vi.fn()
    await expectEscClose(
      <SavingsProjectsDetailDrawer isOpen onClose={onClose} projects={[makeProject({})]} />,
      onClose,
      'Projets en cours',
    )
  })

  it('has no axe-core a11y violations with projects rendered', async () => {
    const { container } = render(
      <SavingsProjectsDetailDrawer
        isOpen
        onClose={vi.fn()}
        projects={[
          makeProject({ id: 'p1', name: 'Japon' }),
          makeProject({ id: 'p2', name: 'Voiture', amountSaved: 0 }),
        ]}
      />,
    )
    const results = await axe(container)
    expect(results.violations).toEqual([])
  })
})
