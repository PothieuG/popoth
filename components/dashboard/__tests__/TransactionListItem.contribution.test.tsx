import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TransactionListItem from '../TransactionListItem'
import type { RealExpense } from '@/hooks/useRealExpenses'

// Feature "Contribution au groupe — dépense virtuelle perso" (2026-05-28)
// RTL coverage. États du state machine (post auto-devalidate v2) :
//   A. applied=false, last_applied=null     → warning court "doit être validée".
//   B. applied=true,  last_applied=amount   → aucun warning (in-sync).
//   C. applied=false, last_applied≠amount   → warning delta "ajouter|retirer X€".
//   D. applied=false, last_applied=amount   → warning court (came back, no delta).
//
// Note state C est atteint par le trigger DB auto-devalidate quand la
// contribution change pendant que la row était applied (state B).

const buildContrib = (overrides: Partial<RealExpense> = {}): RealExpense => ({
  id: 'contrib-1',
  amount: 500,
  description: 'Contribution au groupe Coloc',
  expense_date: '2026-05-28',
  is_exceptional: true,
  created_at: '2026-05-28T10:00:00Z',
  contribution_id: 'gc-1',
  applied_to_balance_at: null,
  last_applied_amount: null,
  ...overrides,
})

describe('<TransactionListItem> contribution row (Feature 2026-05-28)', () => {
  it('jamais validée → warning "La valeur de la contribution doit être validée" (pas de mention long-press)', () => {
    render(
      <TransactionListItem
        transaction={buildContrib()}
        type="expense"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={vi.fn(async () => 'applied' as const)}
      />,
    )
    // Catégorie générique
    expect(screen.getByText('Contribution groupe')).toBeInTheDocument()
    // Description du trigger
    expect(screen.getByText('Contribution au groupe Coloc')).toBeInTheDocument()
    // Warning visible — message court sans mention long-press ni montant.
    const warning = screen.getByRole('status')
    expect(warning).toHaveTextContent(/La valeur de la contribution doit être validée/i)
    expect(warning).not.toHaveTextContent(/long-press/i)
  })

  it('kebab dropdown absent — pas de bouton Options sur une row contribution', () => {
    render(
      <TransactionListItem
        transaction={buildContrib()}
        type="expense"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={vi.fn(async () => 'applied' as const)}
      />,
    )
    expect(screen.queryByLabelText('Options')).toBeNull()
  })

  it('state D (was-validated then changed back to same amount) → warning court "doit être validée" (pas de delta)', () => {
    // Cas atteint si user a validé à 500, puis budget change → trigger
    // auto-devalidate, puis budget revient → amount=last_applied à nouveau.
    // L'UI doit retomber sur le warning court, pas le warning delta.
    render(
      <TransactionListItem
        transaction={buildContrib({
          amount: 500,
          applied_to_balance_at: null,
          last_applied_amount: 500, // came back
        })}
        type="expense"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={vi.fn(async () => 'applied' as const)}
      />,
    )
    const warning = screen.getByRole('status')
    expect(warning).toHaveTextContent(/La valeur de la contribution doit être validée/i)
    expect(warning).not.toHaveTextContent(/ajouter|retirer/i)
  })

  it('validée et in sync → aucun bloc warning, role=status absent', () => {
    render(
      <TransactionListItem
        transaction={buildContrib({
          amount: 500,
          applied_to_balance_at: '2026-05-28T11:00:00Z',
          last_applied_amount: 500,
        })}
        type="expense"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={vi.fn(async () => 'applied' as const)}
      />,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('state C drift positif (contribution augmentée, auto-devalidated) → "vous devez ajouter X€ au groupe"', () => {
    // Trigger DB auto-devalide → applied_to_balance_at est NULL mais
    // last_applied_amount (snapshot du dernier validé) est PRÉSERVÉ pour
    // que l'UI puisse afficher le delta.
    render(
      <TransactionListItem
        transaction={buildContrib({
          amount: 800, // nouvelle contribution
          applied_to_balance_at: null, // auto-devalidated
          last_applied_amount: 500, // dernier montant validé (préservé)
        })}
        type="expense"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={vi.fn(async () => 'applied' as const)}
      />,
    )
    const warning = screen.getByRole('status')
    expect(warning).toHaveTextContent(/La contribution au groupe a changé/i)
    expect(warning).toHaveTextContent(/ajouter\s+300,00\s*€/i)
    expect(warning).toHaveTextContent(/au groupe avant de valider cette dépense/i)
    // Pas de "retirer", pas de symbole +/- explicite dans le montant.
    expect(warning).not.toHaveTextContent(/retirer/i)
  })

  it('state C drift négatif (contribution réduite, auto-devalidated) → "vous devez retirer X€ au groupe"', () => {
    render(
      <TransactionListItem
        transaction={buildContrib({
          amount: 300, // nouvelle contribution plus petite
          applied_to_balance_at: null, // auto-devalidated
          last_applied_amount: 500,
        })}
        type="expense"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={vi.fn(async () => 'applied' as const)}
      />,
    )
    const warning = screen.getByRole('status')
    expect(warning).toHaveTextContent(/La contribution au groupe a changé/i)
    expect(warning).toHaveTextContent(/retirer\s+200,00\s*€/i)
    expect(warning).not.toHaveTextContent(/ajouter/i)
    // Pas de signe négatif explicite — on utilise la valeur absolue + le verbe.
    expect(warning).not.toHaveTextContent(/-200/)
  })

  it('category text color is gray (pas yellow exceptionnel ni blue budgetée)', () => {
    render(
      <TransactionListItem
        transaction={buildContrib()}
        type="expense"
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => true)}
        onToggleApplied={vi.fn(async () => 'applied' as const)}
      />,
    )
    const categorySpan = screen.getByText('Contribution groupe')
    expect(categorySpan.className).toContain('text-gray-600')
    expect(categorySpan.className).not.toContain('text-yellow-700')
    expect(categorySpan.className).not.toContain('text-blue-700')
  })
})
