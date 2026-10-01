/**
 * Régressions 2026-10-01 — la liste utilisée par l'étape 2 du récap
 * (« Compléter le mois »).
 *
 * 1. Défilement : la liste gardait sa zone de défilement interne, pensée pour
 *    le dashboard où le parent borne sa hauteur, alors que `RecapShell` défile
 *    déjà : sur téléphone, un glissé commencé sur la liste ne faisait pas
 *    défiler l'écran, seul le fond bleu le permettait. jsdom ne calcule pas de
 *    mise en page : on épingle donc les classes qui créent un conteneur de
 *    défilement entre la liste et la page.
 *
 * 2. Reste à vivre : la base de l'aperçu « après suppression » doit porter sur
 *    le mois recapé (`monthWindow`), pas sur le mois courant.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useRealExpenses', () => ({
  useRealExpenses: () => ({
    expenses: [],
    loading: false,
    isFetching: false,
    error: null,
    deleteExpense: vi.fn(),
    toggleApplied: vi.fn(),
    toggleCarryApplied: vi.fn(),
  }),
}))

vi.mock('@/hooks/useRealIncomes', () => ({
  useRealIncomes: () => ({
    incomes: [],
    loading: false,
    isFetching: false,
    error: null,
    deleteIncome: vi.fn(),
    toggleApplied: vi.fn(),
    toggleCarryApplied: vi.fn(),
  }),
}))

vi.mock('@/hooks/useIncomes', () => ({ useIncomes: () => ({ incomes: [] }) }))
vi.mock('@/hooks/useBudgets', () => ({ useBudgets: () => ({ budgets: [] }) }))
const useFinancialDataCalls: unknown[][] = []
vi.mock('@/hooks/useFinancialData', () => ({
  useFinancialData: (...args: unknown[]) => {
    useFinancialDataCalls.push(args)
    return { financialData: null }
  },
}))
vi.mock('@/hooks/useProgressData', () => ({ useProgressData: () => ({ expenseProgress: {} }) }))
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ profile: null }) }))
vi.mock('@/hooks/useGroupMembers', () => ({ useGroupMembers: () => ({ members: [] }) }))

import TransactionTabsComponent from '../TransactionTabsComponent'

const SCROLL_CONTAINER_CLASSES = ['overflow-hidden', 'overflow-auto', 'overflow-y-auto']

/** Classes des ancêtres du contenu de la liste, jusqu'à la racine du composant. */
function listAncestorClasses(root: HTMLElement): string[] {
  const out: string[] = []
  let el = screen.getByText('Aucune dépense').parentElement
  while (el && el !== root) {
    out.push(...el.classList)
    el = el.parentElement
  }
  return out
}

describe('TransactionTabsComponent — zone de défilement', () => {
  it('scrolls inside its own area by default (dashboards, height bounded by the parent)', () => {
    const { container } = render(<TransactionTabsComponent context="profile" />)

    const classes = listAncestorClasses(container)
    expect(classes).toContain('overflow-y-auto')
    expect(classes).toContain('overscroll-y-contain')
  })

  it('leaves no scroll container between the list and the page when scrollable=false', () => {
    const { container } = render(<TransactionTabsComponent context="profile" scrollable={false} />)

    const classes = listAncestorClasses(container)
    for (const cls of [...SCROLL_CONTAINER_CLASSES, 'overscroll-y-contain']) {
      expect(classes).not.toContain(cls)
    }
    // Rognage horizontal conservé, sans conteneur de défilement.
    expect(classes).toContain('overflow-x-clip')
  })
})

describe('TransactionTabsComponent — fenêtre du reste à vivre', () => {
  it('transmet monthWindow au calcul du RAV (récap)', () => {
    useFinancialDataCalls.length = 0
    render(<TransactionTabsComponent context="profile" monthWindow={{ month: 9, year: 2026 }} />)

    expect(useFinancialDataCalls[0]).toEqual(['profile', { month: 9, year: 2026 }])
  })

  it('sans monthWindow : mois courant (dashboards)', () => {
    useFinancialDataCalls.length = 0
    render(<TransactionTabsComponent context="profile" />)

    expect(useFinancialDataCalls[0]).toEqual(['profile', undefined])
  })
})
