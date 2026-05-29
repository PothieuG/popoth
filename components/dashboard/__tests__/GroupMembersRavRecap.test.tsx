import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import GroupMembersRavRecap from '../GroupMembersRavRecap'
import type { GroupMemberRavRow } from '@/lib/finance/group-members-rav-preview'

/**
 * RTL coverage du composant `<GroupMembersRavRecap>` (Sprint Group-RAV-Recap).
 * Vérifie le rendu par membre, la mise en évidence visuelle d'un membre en
 * RAV négatif projeté, et l'absence de rendu quand showPreview=false ou rows
 * vide. Le calcul des rows est testé séparément dans
 * `lib/finance/__tests__/group-members-rav-preview.test.ts`.
 */

const ALICE_OK: GroupMemberRavRow = {
  profileId: 'alice-uuid',
  firstName: 'Alice',
  currentRav: 1600,
  projectedRav: 1400,
  willGoNegative: false,
}
const BOB_NEGATIVE: GroupMemberRavRow = {
  profileId: 'bob-uuid',
  firstName: 'Bob',
  currentRav: 800,
  projectedRav: -50,
  willGoNegative: true,
}

describe('<GroupMembersRavRecap>', () => {
  it('rend rien quand showPreview=false', () => {
    const { container } = render(<GroupMembersRavRecap rows={[ALICE_OK]} showPreview={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('rend rien quand rows est vide', () => {
    const { container } = render(<GroupMembersRavRecap rows={[]} showPreview={true} />)
    expect(container.firstChild).toBeNull()
  })

  it('affiche un membre sans warning quand willGoNegative=false (RAV projeté positif → vert)', () => {
    render(<GroupMembersRavRecap rows={[ALICE_OK]} showPreview={true} />)
    expect(screen.getByTestId('group-members-rav-recap')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    // RAV projeté 1400 (positif, unique vs 1600) → vert.
    expect(screen.getByText(/1\s*400/)).toHaveClass('text-green-600')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('affiche un warning rouge + role=alert quand willGoNegative=true', () => {
    render(<GroupMembersRavRecap rows={[BOB_NEGATIVE]} showPreview={true} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/Avertissement/)
    expect(alert).toHaveTextContent(/Bob/)
    expect(alert).toHaveClass('text-red-600')
  })

  it('rend les membres dans l’ordre fourni (tri pilote par le parent)', () => {
    render(<GroupMembersRavRecap rows={[ALICE_OK, BOB_NEGATIVE]} showPreview={true} />)
    const recap = screen.getByTestId('group-members-rav-recap')
    // Each member row is the direct child of the inner space-y-2 container
    const memberRows = within(recap).getAllByText(/Alice|Bob/)
    expect(memberRows[0]).toHaveTextContent('Alice')
    expect(memberRows[1]).toHaveTextContent('Bob')
  })

  it('utilise un fallback "Membre" quand firstName est vide', () => {
    const ANONYMOUS: GroupMemberRavRow = {
      profileId: 'anon-uuid',
      firstName: '',
      currentRav: 500,
      projectedRav: 100,
      willGoNegative: false,
    }
    render(<GroupMembersRavRecap rows={[ANONYMOUS]} showPreview={true} />)
    expect(screen.getByText('Membre')).toBeInTheDocument()
  })
})
