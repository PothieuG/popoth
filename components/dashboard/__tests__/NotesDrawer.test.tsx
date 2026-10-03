/**
 * Sprint Notes-Pense-Betes (2026-09-23) — `<NotesDrawer>`, étendu Sprint
 * Notes-Tabs (2026-10-03) : 3 onglets Courses / Notes / Projets.
 *
 * Contrats pinnés :
 *   - l'avatar de l'auteur précède chaque note, résolu depuis le profil courant
 *     ou la liste des membres (jamais depuis la note elle-même) ;
 *   - ajout / modification / suppression passent par `useNotes` avec le contenu
 *     trimé, et une note vide est refusée côté client ;
 *   - perso vs groupe : seul le libellé change, le composant est le même ;
 *   - chaque onglet n'affiche que ses lignes et crée dans son onglet ;
 *   - Courses : cochés barrés et en bas, case → `toggleChecked` ;
 *   - le drawer rouvre le dernier onglet utilisé (Courses la première fois).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import type { Note } from '@/hooks/useNotes'
import type { GroupMember } from '@/hooks/useGroupMembers'
import type { ProfileData } from '@/app/api/profile/route'
import { expectEscClose } from '@/components/__tests__/a11y-helpers'

const ME_ID = '11111111-1111-4111-8111-111111111111'
const PARTNER_ID = '22222222-2222-4222-8222-222222222222'
const GONE_ID = '33333333-3333-4333-8333-333333333333'
const GROUP_ID = '44444444-4444-4444-8444-444444444444'

const { state, spies } = vi.hoisted(() => ({
  state: {
    notes: [] as Note[],
    loading: false,
    isFetching: false,
    error: null as string | null,
    members: [] as GroupMember[],
  },
  spies: {
    addNote: vi.fn(async (_content: string, _kind?: string) => true),
    updateNote: vi.fn(async (_id: string, _content: string) => true),
    toggleChecked: vi.fn(async (_id: string, _checked: boolean) => true),
    deleteNote: vi.fn(async (_id: string) => true),
    useGroupMembers: vi.fn(),
  },
}))

const ME: ProfileData = {
  id: ME_ID,
  first_name: 'Guillaume',
  last_name: 'Martin',
  salary: 0,
  group_id: GROUP_ID,
  group_name: 'Maison',
  avatar_url: 'data:image/jpeg;base64,moi',
  created_at: null,
  updated_at: null,
}

vi.mock('@/hooks/useNotes', () => ({
  useNotes: () => ({
    notes: state.notes,
    loading: state.loading,
    isFetching: state.isFetching,
    error: state.error,
    addNote: spies.addNote,
    updateNote: spies.updateNote,
    toggleChecked: spies.toggleChecked,
    deleteNote: spies.deleteNote,
  }),
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: ME }),
}))

vi.mock('@/hooks/useGroupMembers', () => ({
  useGroupMembers: (...args: unknown[]) => {
    spies.useGroupMembers(...args)
    return { members: state.members }
  },
}))

vi.mock('@/components/ui/ConfirmationDialog', () => ({
  default: ({
    title,
    onConfirm,
    onClose,
  }: {
    title: string
    onConfirm: () => void
    onClose: () => void
  }) => (
    <div data-testid="confirm-dialog">
      <p>{title}</p>
      <button type="button" onClick={onConfirm}>
        Confirmer la suppression
      </button>
      <button type="button" onClick={onClose}>
        Annuler la suppression
      </button>
    </div>
  ),
}))

import NotesDrawer, { formatNoteDate, resolveNoteAuthor, splitShoppingItems } from '../NotesDrawer'

/** Clé de l'onglet retenu par le drawer (préférence locale au téléphone). */
const TAB_KEY = 'notes-drawer-tab'

function buildNote(overrides: Partial<Note> = {}): Note {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    profile_id: null,
    group_id: GROUP_ID,
    created_by_profile_id: ME_ID,
    kind: 'note',
    content: 'Payer la cantine',
    checked_at: null,
    created_at: '2026-09-20T10:00:00Z',
    updated_at: '2026-09-20T10:00:00Z',
    created_by: { id: ME_ID, first_name: 'Guillaume', last_name: 'Martin' },
    ...overrides,
  }
}

const PARTNER: GroupMember = {
  id: PARTNER_ID,
  first_name: 'Claire',
  last_name: 'Martin',
  avatar_url: 'data:image/jpeg;base64,claire',
  joined_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  state.notes = []
  state.loading = false
  state.isFetching = false
  state.error = null
  state.members = []
  // Les blocs d'avant les onglets testent l'onglet Notes : on le rouvre.
  window.localStorage.setItem(TAB_KEY, 'note')
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('NotesDrawer — liste et auteurs', () => {
  it('précède chaque note de l’avatar de son auteur (moi, un membre, un ancien membre)', () => {
    state.members = [PARTNER]
    state.notes = [
      buildNote({ id: 'a', content: 'Ma note' }),
      buildNote({
        id: 'b',
        content: 'Note de Claire',
        created_by_profile_id: PARTNER_ID,
        created_by: { id: PARTNER_ID, first_name: 'Claire', last_name: 'Martin' },
      }),
      buildNote({
        id: 'c',
        content: 'Note d’un ancien membre',
        created_by_profile_id: GONE_ID,
        created_by: { id: GONE_ID, first_name: 'Paul', last_name: 'Durand' },
      }),
    ]

    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)

    const [mine, partner, gone] = items as [HTMLElement, HTMLElement, HTMLElement]
    expect(within(mine).getByText('Vous')).toBeInTheDocument()
    expect(within(mine).getByRole('img')).toHaveAttribute('src', ME.avatar_url)

    expect(within(partner).getByText('Claire')).toBeInTheDocument()
    expect(within(partner).getByRole('img')).toHaveAttribute('src', PARTNER.avatar_url)

    // Plus membre : pas d'avatar connu → initiales depuis le JOIN de la note.
    expect(within(gone).getByText('Paul')).toBeInTheDocument()
    expect(within(gone).queryByRole('img')).toBeNull()
    expect(within(gone).getByText('PD')).toBeInTheDocument()
  })

  it('ne charge les membres qu’en contexte groupe', () => {
    render(<NotesDrawer isOpen onClose={() => {}} context="profile" />)

    expect(spies.useGroupMembers).toHaveBeenCalledWith(GROUP_ID, { enabled: false })
    expect(screen.getByText('Visibles par vous seul')).toBeInTheDocument()
  })

  it('annonce le partage en contexte groupe, y compris dans l’état vide', () => {
    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    expect(screen.getByText('Partagées avec votre groupe')).toBeInTheDocument()
    expect(screen.getByText("Aucune note pour l'instant")).toBeInTheDocument()
    expect(
      screen.getByText('Les notes ajoutées ici sont visibles par tous les membres du groupe.'),
    ).toBeInTheDocument()
  })

  it('remplace la liste par des skeletons pendant un chargement', () => {
    state.isFetching = true
    state.notes = [buildNote()]

    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('signale une erreur de chargement', () => {
    state.error = 'boom'

    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Impossible de charger les notes')
  })
})

describe('NotesDrawer — ajout', () => {
  it('ajoute une note trimée puis vide le champ', async () => {
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    const field = screen.getByLabelText('Contenu de la note')
    await user.type(field, '  Rappeler le plombier  ')
    await user.click(screen.getByRole('button', { name: 'Ajouter' }))

    await waitFor(() => expect(spies.addNote).toHaveBeenCalledWith('Rappeler le plombier', 'note'))
    await waitFor(() => expect(field).toHaveValue(''))
  })

  it('refuse une note vide sans appeler l’API', async () => {
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    await user.type(screen.getByLabelText('Contenu de la note'), '   ')
    await user.click(screen.getByRole('button', { name: 'Ajouter' }))

    expect(await screen.findByText('Le texte ne peut pas être vide')).toBeInTheDocument()
    expect(screen.getByLabelText('Contenu de la note')).toHaveAttribute(
      'aria-describedby',
      'new-note-content-error',
    )
    expect(spies.addNote).not.toHaveBeenCalled()
  })

  it('garde le texte et affiche une erreur si l’enregistrement échoue', async () => {
    spies.addNote.mockResolvedValueOnce(false)
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    const field = screen.getByLabelText('Contenu de la note')
    await user.type(field, 'Courses')
    await user.click(screen.getByRole('button', { name: 'Ajouter' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("n'a pas pu être enregistrée")
    expect(field).toHaveValue('Courses')
  })
})

describe('NotesDrawer — modification et suppression', () => {
  it('modifie une note en place', async () => {
    state.notes = [buildNote({ id: 'n1', content: 'Ancien texte' })]
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    await user.click(screen.getByRole('button', { name: 'Options' }))
    await user.click(await screen.findByText('Modifier'))

    const field = screen.getByLabelText('Contenu de la note', { selector: '#edit-note-n1-content' })
    expect(field).toHaveValue('Ancien texte')
    await user.clear(field)
    await user.type(field, 'Nouveau texte')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(spies.updateNote).toHaveBeenCalledWith('n1', 'Nouveau texte'))
  })

  it('supprime une note après confirmation', async () => {
    state.notes = [buildNote({ id: 'n1' })]
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    await user.click(screen.getByRole('button', { name: 'Options' }))
    await user.click(await screen.findByText('Supprimer'))
    expect(screen.getByText('Supprimer cette note ?')).toBeInTheDocument()
    expect(spies.deleteNote).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }))

    await waitFor(() => expect(spies.deleteNote).toHaveBeenCalledWith('n1'))
  })
})

function shopping(id: string, content: string, checkedAt: string | null = null): Note {
  return buildNote({ id, kind: 'shopping', content, checked_at: checkedAt })
}

function project(id: string, content: string): Note {
  return buildNote({ id, kind: 'project', content })
}

describe('NotesDrawer — onglets', () => {
  it('ouvre l’onglet Courses la première fois', () => {
    window.localStorage.removeItem(TAB_KEY)
    render(<NotesDrawer isOpen onClose={() => {}} context="profile" />)

    expect(screen.getByRole('tab', { name: 'Courses' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'notes-tab-shopping')
    expect(screen.getByLabelText('Article de courses')).toBeInTheDocument()
  })

  it('rouvre le dernier onglet utilisé', async () => {
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="profile" />)

    await user.click(screen.getByRole('tab', { name: 'Projets' }))
    expect(window.localStorage.getItem(TAB_KEY)).toBe('project')

    cleanup()
    render(<NotesDrawer isOpen onClose={() => {}} context="profile" />)
    expect(screen.getByRole('tab', { name: 'Projets' })).toHaveAttribute('aria-selected', 'true')
  })

  it('ignore un onglet retenu inconnu', () => {
    window.localStorage.setItem(TAB_KEY, 'autre')
    render(<NotesDrawer isOpen onClose={() => {}} context="profile" />)

    expect(screen.getByRole('tab', { name: 'Courses' })).toHaveAttribute('aria-selected', 'true')
  })

  it('chaque onglet n’affiche que ses lignes', async () => {
    state.notes = [
      shopping('s1', 'Lait'),
      buildNote({ id: 'n1', content: 'Payer la cantine' }),
      project('p1', 'Repeindre la chambre'),
    ]
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Payer la cantine')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Courses' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Lait')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Projets' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Repeindre la chambre')).toBeInTheDocument()
  })
})

describe('NotesDrawer — courses', () => {
  beforeEach(() => {
    window.localStorage.setItem(TAB_KEY, 'shopping')
  })

  it('met les articles cochés en bas, légèrement barrés, derniers cochés en tête', () => {
    state.notes = [
      shopping('s1', 'Pain', '2026-10-02T09:00:00Z'),
      shopping('s2', 'Lait'),
      shopping('s3', 'Œufs', '2026-10-03T09:00:00Z'),
      shopping('s4', 'Café'),
    ]
    render(<NotesDrawer isOpen onClose={() => {}} context="profile" />)

    const order = screen
      .getAllByRole('checkbox')
      .map((box) => (box as HTMLInputElement).labels?.[0]?.textContent)
    expect(order).toEqual(['Lait', 'Café', 'Œufs', 'Pain'])

    expect(screen.getByRole('checkbox', { name: 'Œufs' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Lait' })).not.toBeChecked()
    expect(screen.getByText('Œufs')).toHaveClass('line-through')
    expect(screen.getByText('Lait')).not.toHaveClass('line-through')
    expect(screen.getByText(/retirés au bout de 7 jours/)).toBeInTheDocument()
  })

  it('pas de section « panier » sans article coché', () => {
    state.notes = [shopping('s1', 'Lait')]
    render(<NotesDrawer isOpen onClose={() => {}} context="profile" />)

    expect(screen.queryByText(/retirés au bout/)).toBeNull()
  })

  it('cocher (case ou libellé) et décocher passent par toggleChecked', async () => {
    state.notes = [shopping('s1', 'Lait'), shopping('s2', 'Pain', '2026-10-02T09:00:00Z')]
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    await user.click(screen.getByRole('checkbox', { name: 'Lait' }))
    expect(spies.toggleChecked).toHaveBeenCalledWith('s1', true)

    await user.click(screen.getByText('Pain'))
    expect(spies.toggleChecked).toHaveBeenCalledWith('s2', false)
  })

  it('signale un échec de cochage', async () => {
    spies.toggleChecked.mockResolvedValueOnce(false)
    state.notes = [shopping('s1', 'Lait')]
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="profile" />)

    await user.click(screen.getByRole('checkbox', { name: 'Lait' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "L'article n'a pas pu être mis à jour",
    )
  })

  it('ajoute un article trimé dans Courses et garde le champ actif', async () => {
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    const field = screen.getByLabelText('Article de courses')
    await user.type(field, '  Lait  ')
    await user.click(screen.getByRole('button', { name: 'Ajouter' }))

    await waitFor(() => expect(spies.addNote).toHaveBeenCalledWith('Lait', 'shopping'))
    await waitFor(() => expect(field).toHaveValue(''))
    expect(field).toHaveFocus()
  })

  it('n’affiche pas d’avatar devant un article, même en groupe', () => {
    state.notes = [shopping('s1', 'Lait')]
    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    const item = screen.getByRole('listitem')
    expect(within(item).queryByRole('img')).toBeNull()
    expect(within(item).queryByText('Vous')).toBeNull()
  })
})

describe('NotesDrawer — projets', () => {
  beforeEach(() => {
    window.localStorage.setItem(TAB_KEY, 'project')
  })

  it('liste simple, sans case à cocher ni auteur', () => {
    state.notes = [project('p1', 'Vacances en Bretagne')]
    render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    const item = screen.getByRole('listitem')
    expect(within(item).getByText('Vacances en Bretagne')).toBeInTheDocument()
    expect(within(item).queryByRole('checkbox')).toBeNull()
    expect(within(item).queryByText('Vous')).toBeNull()
  })

  it('ajoute un projet dans l’onglet Projets', async () => {
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="profile" />)

    await user.type(screen.getByLabelText('Projet'), 'Repeindre la chambre')
    await user.click(screen.getByRole('button', { name: 'Ajouter' }))

    await waitFor(() =>
      expect(spies.addNote).toHaveBeenCalledWith('Repeindre la chambre', 'project'),
    )
  })

  it('modifie un projet en place', async () => {
    state.notes = [project('p1', 'Ancien projet')]
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="profile" />)

    await user.click(screen.getByRole('button', { name: 'Options' }))
    await user.click(await screen.findByText('Modifier'))

    const field = screen.getByLabelText('Projet', { selector: '#edit-note-p1-content' })
    expect(field).toHaveValue('Ancien projet')
    await user.clear(field)
    await user.type(field, 'Nouveau projet')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(spies.updateNote).toHaveBeenCalledWith('p1', 'Nouveau projet'))
  })

  it('supprime un projet après confirmation', async () => {
    state.notes = [project('p1', 'Vacances en Bretagne')]
    const user = userEvent.setup()
    render(<NotesDrawer isOpen onClose={() => {}} context="profile" />)

    await user.click(screen.getByRole('button', { name: 'Options' }))
    await user.click(await screen.findByText('Supprimer'))
    expect(screen.getByText('Supprimer ce projet ?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }))

    await waitFor(() => expect(spies.deleteNote).toHaveBeenCalledWith('p1'))
  })
})

describe('NotesDrawer — accessibilité', () => {
  it('se ferme avec Échap', async () => {
    const onClose = vi.fn()
    await expectEscClose(
      <NotesDrawer isOpen onClose={onClose} context="profile" />,
      onClose,
      // « Notes » est aussi le libellé d'un onglet : on attend le sous-titre.
      'Visibles par vous seul',
    )
  })

  it('n’a aucune violation axe', async () => {
    state.notes = [buildNote()]
    const { baseElement } = render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    expect((await axe(baseElement)).violations).toEqual([])
  })

  it('n’a aucune violation axe sur l’onglet Courses (cochés compris)', async () => {
    window.localStorage.setItem(TAB_KEY, 'shopping')
    state.notes = [shopping('s1', 'Lait'), shopping('s2', 'Pain', '2026-10-02T09:00:00Z')]
    const { baseElement } = render(<NotesDrawer isOpen onClose={() => {}} context="group" />)

    expect((await axe(baseElement)).violations).toEqual([])
  })
})

describe('helpers', () => {
  it('formatNoteDate omet l’année en cours et l’affiche sinon', () => {
    const now = new Date('2026-09-23T12:00:00Z')
    expect(formatNoteDate('2026-09-20T10:00:00Z', now)).toBe('20 sept.')
    expect(formatNoteDate('2025-12-24T10:00:00Z', now)).toBe('24 déc. 2025')
  })

  it('splitShoppingItems garde l’ordre des articles à acheter et trie les cochés', () => {
    const { pending, checked } = splitShoppingItems([
      shopping('a', 'A', '2026-10-01T09:00:00Z'),
      shopping('b', 'B'),
      shopping('c', 'C', '2026-10-03T09:00:00.123Z'),
      shopping('d', 'D'),
      // Horodatage Postgres (+00:00) mêlé à un horodatage optimiste (Z).
      shopping('e', 'E', '2026-10-02T09:00:00.000000+00:00'),
    ])
    expect(pending.map((n) => n.id)).toEqual(['b', 'd'])
    expect(checked.map((n) => n.id)).toEqual(['c', 'e', 'a'])
  })

  it('resolveNoteAuthor renvoie null sans auteur connu', () => {
    expect(
      resolveNoteAuthor({ created_by_profile_id: null, created_by: null }, ME, [PARTNER]),
    ).toBeNull()
  })
})
