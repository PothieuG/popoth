import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { RealIncome } from '@/hooks/useRealIncomes'

// Sprint Salary-Reception (2026-10-02) — lignes salaire dans l'onglet Revenus.
//   - reçu en avance (`salary_reception`) : dans le solde, hors reste à vivre
//     du mois ; ni « Modifier » ni piège « Revenu supprimé ».
//   - ligne salaire du récap (`recap_origin_id`) : libellée « Salaire ».

vi.mock('@/components/dashboard/SalaryValidationModal', () => ({ default: () => null }))

import TransactionListItem from '../TransactionListItem'

const buildIncome = (overrides: Partial<RealIncome> = {}): RealIncome => ({
  id: 'income-1',
  amount: 2760.18,
  description: 'Salaire',
  entry_date: '2026-09-28',
  is_exceptional: false,
  created_at: '2026-09-28T07:57:00Z',
  applied_to_balance_at: '2026-09-28T07:57:00Z',
  last_applied_amount: 2760.18,
  ...overrides,
})

function renderItem(transaction: RealIncome) {
  render(
    <TransactionListItem
      transaction={transaction}
      type="income"
      onEdit={vi.fn()}
      onDelete={vi.fn(async () => true)}
      onToggleApplied={vi.fn(async () => 'applied' as const)}
      currentRemainingToLive={68.78}
    />,
  )
}

describe('<TransactionListItem> lignes salaire', () => {
  it('salaire reçu en avance : libellé dédié + rappel « hors reste à vivre du mois »', () => {
    renderItem(buildIncome({ salary_reception: true }))

    expect(screen.getByText('Salaire reçu en avance')).toBeInTheDocument()
    expect(screen.queryByText('Revenu supprimé')).toBeNull()
    expect(
      screen.getByText(
        /Finance le mois prochain : compté dans le solde, pas dans le reste à vivre/,
      ),
    ).toBeInTheDocument()
  })

  it('salaire reçu en avance : menu sans « Modifier », suppression bloquée tant qu’il est dans le solde', async () => {
    const user = userEvent.setup()
    renderItem(buildIncome({ salary_reception: true }))

    await user.click(screen.getByLabelText('Options'))

    expect(screen.queryByRole('menuitem', { name: 'Modifier' })).toBeNull()
    expect(screen.queryByText('Modifier')).toBeNull()
    expect(screen.getByText('Retirer du solde')).toBeInTheDocument()
    expect(screen.getByText('Supprimer').closest('button')).toBeDisabled()
  })

  it('revenu ordinaire : pas de rappel, « Modifier » présent', async () => {
    const user = userEvent.setup()
    renderItem(
      buildIncome({ description: 'Remboursement', is_exceptional: true, salary_reception: null }),
    )

    expect(screen.queryByText(/Finance le mois prochain/)).toBeNull()
    await user.click(screen.getByLabelText('Options'))
    expect(screen.getByText('Modifier')).toBeInTheDocument()
  })

  it('ligne salaire du récap : libellée « Salaire », plus « Revenu supprimé »', () => {
    renderItem(buildIncome({ amount: 2752.08, recap_origin_id: 'recap-sept' }))

    // Description et catégorie valent toutes deux « Salaire ».
    expect(screen.getAllByText('Salaire')).toHaveLength(2)
    expect(screen.queryByText('Revenu supprimé')).toBeNull()
    expect(screen.queryByText(/Finance le mois prochain/)).toBeNull()
  })
})
