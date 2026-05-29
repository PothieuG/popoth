import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import GroupMembersContributionsRecap from '../GroupMembersContributionsRecap'
import type { GroupMemberContributionRow } from '@/lib/finance/group-members-contributions-preview'

/**
 * RTL coverage de `<GroupMembersContributionsRecap>` (modals revenu groupe).
 * Sprint « RAV vert/rouge dans le planificateur » : l'encart montre désormais,
 * par membre, sa contribution (actuel → projeté) ET son reste à vivre projeté
 * coloré vert/rouge. Le calcul des rows est testé dans
 * `lib/finance/__tests__/group-members-contributions-preview.test.ts`.
 */

const ALICE: GroupMemberContributionRow = {
  profileId: 'alice-uuid',
  firstName: 'Alice',
  salary: 3000,
  currentContribution: 600,
  projectedContribution: 420,
  delta: -180,
  currentRav: 1000,
  projectedRav: 1180,
}
const BOB_NEGATIVE: GroupMemberContributionRow = {
  profileId: 'bob-uuid',
  firstName: 'Bob',
  salary: 2000,
  currentContribution: 400,
  projectedContribution: 280,
  delta: -120,
  currentRav: -200,
  projectedRav: -80,
}

describe('<GroupMembersContributionsRecap>', () => {
  it('rend rien quand showPreview=false', () => {
    const { container } = render(
      <GroupMembersContributionsRecap
        rows={[ALICE]}
        showPreview={false}
        projectedGroupSurplus={0}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('affiche contribution + reste à vivre par membre, RAV projeté positif en vert', () => {
    render(
      <GroupMembersContributionsRecap
        rows={[ALICE]}
        showPreview={true}
        projectedGroupSurplus={0}
      />,
    )
    expect(screen.getByTestId('group-members-contributions-recap')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Contribution')).toBeInTheDocument()
    expect(screen.getByText('Reste à vivre')).toBeInTheDocument()
    // RAV projeté 1180 (positif, unique) → vert ; pas d'avertissement.
    expect(screen.getByText(/1\s*180/)).toHaveClass('text-green-600')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('RAV projeté négatif → rouge + avertissement role=alert', () => {
    render(
      <GroupMembersContributionsRecap
        rows={[BOB_NEGATIVE]}
        showPreview={true}
        projectedGroupSurplus={0}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/Bob/)
    expect(alert).toHaveClass('text-red-600')
  })

  it('affiche le surplus groupe quand projectedGroupSurplus > 0', () => {
    render(
      <GroupMembersContributionsRecap
        rows={[ALICE]}
        showPreview={true}
        projectedGroupSurplus={500}
      />,
    )
    const recap = screen.getByTestId('group-members-contributions-recap')
    expect(within(recap).getByText(/Surplus groupe/i)).toBeInTheDocument()
  })
})
