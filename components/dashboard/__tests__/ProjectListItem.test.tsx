import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProjectListItem from '../ProjectListItem'
import type { SavingsProject } from '@/hooks/useProjects'

/**
 * Sprint Projets-Épargne 04 — RTL coverage du composant row du 3ème onglet
 * "Projets" du PlanningDrawer. Couvre :
 *   - rendu happy path (nom, %, deadline fr-FR, montants)
 *   - dropdown Modifier déclenche onEdit avec la row
 *   - dropdown Supprimer déclenche onDelete avec la row
 *   - over-funded (saved > target) reste à 100% côté visuel
 *   - "Échéance dépassée" pour deadline past
 *
 * Note : on évite `vi.useFakeTimers()` pour ne pas casser userEvent (qui
 * dépend de timers réels pour les clicks). Les assertions sur "X mois
 * restants" sont volontairement omises — la valeur dérive avec la date
 * système, couverte côté unit dans `lib/finance/__tests__/projects-meta.test.ts`.
 */

const buildProject = (overrides: Partial<SavingsProject> = {}): SavingsProject => ({
  id: 'proj-1',
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
})

describe('<ProjectListItem>', () => {
  it('renders name, percentage, deadline (fr-FR), and amounts', () => {
    render(<ProjectListItem project={buildProject()} onEdit={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('Voyage Japon')).toBeInTheDocument()
    // 4084 / 7000 = 58.34 → 58%
    expect(screen.getByText('58%')).toBeInTheDocument()
    // Deadline en fr-FR
    expect(screen.getByText(/01\/05\/2029/)).toBeInTheDocument()
    // Montants 4 084 € / 7 000 € (formatage Intl strip ,00 via 0 décimales)
    expect(screen.getByText(/4\s*084\s*€/)).toBeInTheDocument()
    expect(screen.getByText(/\/\s*7\s*000\s*€/)).toBeInTheDocument()
  })

  it('clicks Modifier → calls onEdit with the project', async () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const project = buildProject()
    const user = userEvent.setup()
    render(<ProjectListItem project={project} onEdit={onEdit} onDelete={onDelete} />)

    await user.click(screen.getByLabelText('Options'))
    await user.click(screen.getByRole('button', { name: /modifier/i }))

    expect(onEdit).toHaveBeenCalledWith(project)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('clicks Supprimer → calls onDelete with the project', async () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const project = buildProject()
    const user = userEvent.setup()
    render(<ProjectListItem project={project} onEdit={onEdit} onDelete={onDelete} />)

    await user.click(screen.getByLabelText('Options'))
    await user.click(screen.getByRole('button', { name: /supprimer/i }))

    expect(onDelete).toHaveBeenCalledWith(project)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('clamps visual percentage to 100% when over-funded (saved > target)', () => {
    render(
      <ProjectListItem
        project={buildProject({ amount_saved: 8000, target_amount: 7000 })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    // % visuel borné à 100 mais le ratio numérique reste lisible dans le montant
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText(/8\s*000\s*€/)).toBeInTheDocument()
  })

  it('shows "Échéance dépassée" when deadline is in the past', () => {
    render(
      <ProjectListItem
        project={buildProject({ deadline_date: '2000-01-01' })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/Échéance dépassée/)).toBeInTheDocument()
  })

  it('renders 0% when target_amount is 0 (defensive guard)', () => {
    render(
      <ProjectListItem
        project={buildProject({ amount_saved: 0, target_amount: 0 })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})
