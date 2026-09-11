/**
 * Sprint Fix-Avatar-Payload (2026-09-11) — l'avatar du créateur d'une ligne
 * vient désormais du parent (`creatorAvatarUrl`, résolu depuis la liste des
 * membres), plus de la jointure `created_by` des réponses de liste.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TransactionListItem from '../TransactionListItem'
import type { RealExpense } from '@/hooks/useRealExpenses'

const CREATOR = { id: 'member-2', first_name: 'Bob', last_name: 'Martin' }
const SMALL_AVATAR = 'data:image/jpeg;base64,AAAA'

function expense(overrides: Partial<RealExpense> = {}): RealExpense {
  return {
    id: 'exp-1',
    amount: 42,
    description: 'Courses',
    expense_date: '2026-09-10',
    is_exceptional: true,
    created_at: '2026-09-10T10:00:00Z',
    created_by: CREATOR,
    ...overrides,
  }
}

const noop = vi.fn(async () => true)
const noopToggle = vi.fn(async () => 'applied' as const)

function renderItem(props: Partial<React.ComponentProps<typeof TransactionListItem>> = {}) {
  return render(
    <TransactionListItem
      transaction={expense()}
      type="expense"
      context="group"
      onEdit={() => {}}
      onDelete={noop}
      onToggleApplied={noopToggle}
      {...props}
    />,
  )
}

describe('<TransactionListItem> — avatar du créateur', () => {
  it("affiche l'avatar fourni par le parent (contexte groupe)", () => {
    renderItem({ creatorAvatarUrl: SMALL_AVATAR })
    const img = screen.getByRole('img', { name: /Avatar de Bob Martin/ })
    expect(img).toHaveAttribute('src', SMALL_AVATAR)
  })

  it('sans avatar connu : initiales, aucune image', () => {
    renderItem({ creatorAvatarUrl: null })
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('BM')).toBeInTheDocument()
  })

  it("`undefined` (membre inconnu) retombe sur l'avatar porté par la ligne, s'il existe", () => {
    renderItem({
      transaction: expense({ created_by: { ...CREATOR, avatar_url: SMALL_AVATAR } }),
      creatorAvatarUrl: undefined,
    })
    expect(screen.getByRole('img', { name: /Avatar de Bob Martin/ })).toHaveAttribute(
      'src',
      SMALL_AVATAR,
    )
  })

  it('contexte perso : aucun avatar rendu, même fourni', () => {
    renderItem({ context: 'profile', creatorAvatarUrl: SMALL_AVATAR })
    expect(screen.queryByRole('img')).toBeNull()
  })
})
