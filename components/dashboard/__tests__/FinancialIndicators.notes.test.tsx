/**
 * Sprint Notes-Pense-Betes (2026-09-23) — la ligne « Économies » du dashboard
 * est coupée en deux : Économies (montant) | Notes (compteur). Le test pinne
 * les deux moitiés et le contexte transmis au drawer Notes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { state, spies } = vi.hoisted(() => ({
  state: { noteCount: 0 },
  spies: { useNotes: vi.fn(), notesDrawer: vi.fn() },
}))

vi.mock('@/hooks/useNotes', () => ({
  useNotes: (context: string) => {
    spies.useNotes(context)
    return { notes: Array.from({ length: state.noteCount }, (_, i) => ({ id: String(i) })) }
  },
}))

// Les drawers sont hors sujet ici : on ne garde que leurs props.
vi.mock('../PlanningDrawer', () => ({ default: () => null }))
vi.mock('../SavingsDrawer', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="savings-drawer" /> : null,
}))
vi.mock('../NotesDrawer', () => ({
  default: (props: { isOpen: boolean; context: string }) => {
    spies.notesDrawer(props)
    return props.isOpen ? <div data-testid="notes-drawer" /> : null
  },
}))

import FinancialIndicators from '../FinancialIndicators'

function renderIndicators(props: Partial<Parameters<typeof FinancialIndicators>[0]> = {}) {
  return render(
    <FinancialIndicators
      availableBalance={100}
      remainingToLive={50}
      totalSavings={1234.5}
      context="group"
      {...props}
    />,
  )
}

beforeEach(() => {
  state.noteCount = 0
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('FinancialIndicators — demi-lignes Économies | Notes', () => {
  it('affiche le montant des économies dans la moitié gauche', () => {
    renderIndicators()

    expect(screen.getByText(/^Économies \(1\s234,50\s€\)$/)).toBeInTheDocument()
  })

  it('remplace le montant par un skeleton pendant un chargement', () => {
    renderIndicators({ isFetching: true })

    expect(screen.getByText('Économies')).toBeInTheDocument()
    expect(screen.queryByText(/1\s234,50/)).toBeNull()
  })

  it('ouvre le drawer des économies', async () => {
    const user = userEvent.setup()
    renderIndicators()

    await user.click(screen.getByRole('button', { name: /Économies/ }))

    expect(screen.getByTestId('savings-drawer')).toBeInTheDocument()
  })

  it('affiche le nombre de notes et ouvre le drawer dans le bon contexte', async () => {
    state.noteCount = 3
    const user = userEvent.setup()
    renderIndicators()

    expect(spies.useNotes).toHaveBeenCalledWith('group')
    await user.click(screen.getByRole('button', { name: 'Notes (3)' }))

    expect(screen.getByTestId('notes-drawer')).toBeInTheDocument()
    expect(spies.notesDrawer).toHaveBeenLastCalledWith(
      expect.objectContaining({ isOpen: true, context: 'group' }),
    )
  })

  it('sans note, pas de compteur', () => {
    renderIndicators()

    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument()
  })

  it('contexte perso par défaut', () => {
    renderIndicators({ context: undefined })

    expect(spies.useNotes).toHaveBeenCalledWith('profile')
  })
})
