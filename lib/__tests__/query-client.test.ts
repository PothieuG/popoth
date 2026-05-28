import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateFinancialRefreshes } from '@/lib/query-client'

describe('invalidateFinancialRefreshes', () => {
  it('invalidates the 10 cross-domain financial keys in order', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    invalidateFinancialRefreshes(qc)

    expect(spy).toHaveBeenCalledTimes(10)
    expect(spy).toHaveBeenNthCalledWith(1, { queryKey: ['financial-summary'] })
    expect(spy).toHaveBeenNthCalledWith(2, { queryKey: ['progress-data'] })
    expect(spy).toHaveBeenNthCalledWith(3, { queryKey: ['budgets'] })
    expect(spy).toHaveBeenNthCalledWith(4, { queryKey: ['group-contributions'] })
    expect(spy).toHaveBeenNthCalledWith(5, { queryKey: ['savings-data'] })
    // Feature Contribution-au-groupe (2026-05-28) : group budget changes
    // cascade via trigger DB to perso real_expenses + bank_balance.
    expect(spy).toHaveBeenNthCalledWith(6, { queryKey: ['real-expenses'] })
    // Sprint Salary-Auto + Contribution-Income-Mirror (2026-05-28) : salary
    // auto + group income mirror trigger ⇒ refetch incomes list.
    expect(spy).toHaveBeenNthCalledWith(7, { queryKey: ['real-incomes'] })
    expect(spy).toHaveBeenNthCalledWith(8, { queryKey: ['bank-balance'] })
    // Sprint Salary-Edit-Gating (2026-05-25) : planificateur vierge ⇒ salaire
    // éditable. Toute mutation planner doit refetch la décision serveur.
    expect(spy).toHaveBeenNthCalledWith(9, { queryKey: ['salary-editability'] })
    // Sprint Projets-Épargne 02 (Backend-Wiring) : la liste des projets doit
    // refetch quand un budget ou un income change (la marge dispo bouge).
    expect(spy).toHaveBeenNthCalledWith(10, { queryKey: ['projects'] })
  })
})
