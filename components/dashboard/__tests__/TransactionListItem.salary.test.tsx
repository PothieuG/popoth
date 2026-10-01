import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { RealIncome } from '@/hooks/useRealIncomes'

// Sprint Salary-Reception (2026-10-02) — lignes salaire dans l'onglet Revenus.
// Une ligne salaire porte le mois qu'elle FINANCE (`salary_month`) :
//   - libellé « Salaire d'<mois> » ;
//   - mois postérieur au mois ouvert → rappel « pas dans le reste à vivre de
//     ce mois » ;
//   - saisie par « Réception du salaire » → pas de « Modifier ».

vi.mock('@/components/dashboard/SalaryValidationModal', () => ({ default: () => null }))

import TransactionListItem from '../TransactionListItem'

const SEPTEMBER = { month: 9, year: 2026 }
const OCTOBER = { month: 10, year: 2026 }

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

function renderItem(transaction: RealIncome, openMonth = SEPTEMBER) {
  render(
    <TransactionListItem
      transaction={transaction}
      type="income"
      onEdit={vi.fn()}
      onDelete={vi.fn(async () => true)}
      onToggleApplied={vi.fn(async () => 'applied' as const)}
      currentRemainingToLive={68.78}
      openMonth={openMonth}
    />,
  )
}

const REMINDER = /Finance octobre : compté dans le solde, pas dans le reste à vivre de\s+ce mois/

describe('<TransactionListItem> lignes salaire', () => {
  it('salaire du mois suivant (payé le 28) : libellé du mois + rappel « hors reste à vivre »', () => {
    renderItem(buildIncome({ salary_month: '2026-10-01' }), SEPTEMBER)

    expect(screen.getByText("Salaire d'octobre")).toBeInTheDocument()
    expect(screen.queryByText('Revenu supprimé')).toBeNull()
    expect(screen.getByText(REMINDER)).toBeInTheDocument()
  })

  it('salaire du mois en cours (payé le 3) : libellé du mois, pas de rappel', () => {
    renderItem(buildIncome({ amount: 2752.08, salary_month: '2026-10-01' }), OCTOBER)

    expect(screen.getByText("Salaire d'octobre")).toBeInTheDocument()
    expect(screen.queryByText(/Finance octobre/)).toBeNull()
  })

  it('même ligne, un mois plus tard : le rappel disparaît tout seul', () => {
    renderItem(buildIncome({ salary_month: '2026-10-01', recap_origin_id: 'recap-sept' }), OCTOBER)

    expect(screen.getByText("Salaire d'octobre")).toBeInTheDocument()
    expect(screen.queryByText(/Finance octobre/)).toBeNull()
  })

  it('saisie par « Réception du salaire » : menu sans « Modifier », suppression bloquée tant qu’elle est dans le solde', async () => {
    const user = userEvent.setup()
    renderItem(buildIncome({ salary_month: '2026-10-01' }))

    await user.click(screen.getByLabelText('Options'))

    expect(screen.queryByText('Modifier')).toBeNull()
    expect(screen.getByText('Retirer du solde')).toBeInTheDocument()
    expect(screen.getByText('Supprimer').closest('button')).toBeDisabled()
  })

  it('ligne salaire du récap : pas de menu (verrouillée)', () => {
    renderItem(buildIncome({ salary_month: '2026-10-01', recap_origin_id: 'recap-sept' }), OCTOBER)

    expect(screen.queryByLabelText('Options')).toBeNull()
  })

  it('ligne salaire du récap sans mois (ancienne ligne) : « Salaire », plus « Revenu supprimé »', () => {
    renderItem(buildIncome({ amount: 2752.08, recap_origin_id: 'recap-sept' }))

    // Description et catégorie valent toutes deux « Salaire ».
    expect(screen.getAllByText('Salaire')).toHaveLength(2)
    expect(screen.queryByText('Revenu supprimé')).toBeNull()
  })

  it('revenu ordinaire : pas de rappel, « Modifier » présent', async () => {
    const user = userEvent.setup()
    renderItem(buildIncome({ description: 'Remboursement', is_exceptional: true }))

    expect(screen.queryByText(/Finance/)).toBeNull()
    await user.click(screen.getByLabelText('Options'))
    expect(screen.getByText('Modifier')).toBeInTheDocument()
  })
})
