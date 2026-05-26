import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SavingsProjectMeta } from '@/lib/finance/types'

const refloatProjectsMock = vi.fn()
let refloatProjectsPending = false

vi.mock('@/hooks/useMonthlyRecap', () => ({
  useRefloatFromProjects: () => ({
    mutateAsync: refloatProjectsMock,
    isPending: refloatProjectsPending,
  }),
}))

import { RefloatProjectsLine } from '../RefloatProjectsLine'

function makeProject(overrides: Partial<SavingsProjectMeta> = {}): SavingsProjectMeta {
  return {
    id: 'p1',
    name: 'Japon',
    monthlyAllocation: 100,
    amountSaved: 600,
    targetAmount: 7000,
    deadlineDate: '2029-01-01',
    monthsRemaining: 36,
    ...overrides,
  }
}

beforeEach(() => {
  refloatProjectsMock.mockReset()
  refloatProjectsPending = false
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RefloatProjectsLine', () => {
  describe('state=locked', () => {
    it('renders waiting copy + no button when savings is not yet drained', () => {
      render(
        <RefloatProjectsLine
          context="profile"
          state="locked"
          projects={[makeProject()]}
          deficitRemaining={100}
          projectSnapshotData={null}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(
        screen.getByText(/Disponible après avoir transféré la tirelire et les économies/),
      ).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('state=empty', () => {
    it('renders "Aucun projet à utiliser" grey card', () => {
      render(
        <RefloatProjectsLine
          context="profile"
          state="empty"
          projects={[]}
          deficitRemaining={100}
          projectSnapshotData={null}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(screen.getByText(/Aucun projet à utiliser/)).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('state=unneeded', () => {
    it('renders "déficit déjà comblé" grey card', () => {
      render(
        <RefloatProjectsLine
          context="profile"
          state="unneeded"
          projects={[makeProject()]}
          deficitRemaining={0}
          projectSnapshotData={null}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(screen.getByText(/Pas nécessaire — le déficit est déjà comblé/)).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('state=done', () => {
    it('renders cumulative refund + per-project remaining mensualité', () => {
      const projects = [
        makeProject({ id: 'p1', name: 'Japon', monthlyAllocation: 100 }),
        makeProject({ id: 'p2', name: 'Voiture', monthlyAllocation: 50 }),
      ]

      render(
        <RefloatProjectsLine
          context="profile"
          state="done"
          projects={projects}
          deficitRemaining={0}
          projectSnapshotData={{ p1: 40, p2: 20 }}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      // Cumulative total = 60
      const totalLine = screen
        .getByText(/de mensualités projets utilisés pour combler le déficit/)
        .closest('p')!
      expect(totalLine).toHaveTextContent(/60,00/)
      // Both project names visible
      expect(screen.getByText('Japon')).toBeInTheDocument()
      expect(screen.getByText('Voiture')).toBeInTheDocument()
      // Remaining mensualités : 60/100 and 30/50
      expect(screen.getByText(/60,00.+\/.+100,00/)).toBeInTheDocument()
      expect(screen.getByText(/30,00.+\/.+50,00/)).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('state=active', () => {
    it('renders per-project preview with monthlyAllocation → after format + button', () => {
      const projects = [
        makeProject({ id: 'p1', name: 'Japon', monthlyAllocation: 100 }),
        makeProject({ id: 'p2', name: 'Voiture', monthlyAllocation: 50 }),
      ]

      render(
        <RefloatProjectsLine
          context="profile"
          state="active"
          projects={projects}
          deficitRemaining={60}
          projectSnapshotData={null}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(screen.getByText('Japon')).toBeInTheDocument()
      expect(screen.getByText('Voiture')).toBeInTheDocument()
      // "→" preview rows (one per project)
      expect(screen.getAllByText('→')).toHaveLength(2)
      // Button mentions the proposed amount
      expect(
        screen.getByRole('button', { name: /Utiliser .+ depuis les projets/ }),
      ).toBeInTheDocument()
    })

    it('click triggers mutation + onSuccess receives the refunded amount', async () => {
      const user = userEvent.setup()
      const onSuccess = vi.fn()
      refloatProjectsMock.mockResolvedValueOnce({
        newDeficit: 0,
        allocation: { p1: 40, p2: 20 },
        perProject: [
          { projectId: 'p1', amount: 40 },
          { projectId: 'p2', amount: 20 },
        ],
        shortfall: 0,
      })

      render(
        <RefloatProjectsLine
          context="profile"
          state="active"
          projects={[
            makeProject({ id: 'p1', name: 'Japon', monthlyAllocation: 100 }),
            makeProject({ id: 'p2', name: 'Voiture', monthlyAllocation: 50 }),
          ]}
          deficitRemaining={60}
          projectSnapshotData={null}
          onError={vi.fn()}
          onSuccess={onSuccess}
        />,
      )
      await user.click(screen.getByRole('button', { name: /Utiliser .+ depuis les projets/ }))

      await waitFor(() => {
        expect(refloatProjectsMock).toHaveBeenCalledTimes(1)
      })
      expect(onSuccess).toHaveBeenCalledWith(
        expect.stringMatching(/60,00.+mensualités projets utilisés/),
      )
    })

    it('forwards error code to onError on mutation failure', async () => {
      const user = userEvent.setup()
      const onError = vi.fn()
      refloatProjectsMock.mockRejectedValueOnce(new Error('no_projects_available'))

      render(
        <RefloatProjectsLine
          context="profile"
          state="active"
          projects={[makeProject()]}
          deficitRemaining={50}
          projectSnapshotData={null}
          onError={onError}
          onSuccess={vi.fn()}
        />,
      )
      await user.click(screen.getByRole('button', { name: /Utiliser .+ depuis les projets/ }))

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('no_projects_available')
      })
    })

    it('filters out projects with monthlyAllocation = 0 from the preview', () => {
      const projects = [
        makeProject({ id: 'p1', name: 'Japon', monthlyAllocation: 100 }),
        makeProject({ id: 'p2', name: 'Vide', monthlyAllocation: 0 }),
      ]

      render(
        <RefloatProjectsLine
          context="profile"
          state="active"
          projects={projects}
          deficitRemaining={50}
          projectSnapshotData={null}
          onError={vi.fn()}
          onSuccess={vi.fn()}
        />,
      )

      expect(screen.getByText('Japon')).toBeInTheDocument()
      expect(screen.queryByText('Vide')).not.toBeInTheDocument()
    })
  })
})
