import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateFinancialRefreshes } from '@/lib/query-client'

describe('invalidateFinancialRefreshes', () => {
  it('invalidates the 4 cross-domain financial keys in order', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    invalidateFinancialRefreshes(qc)

    expect(spy).toHaveBeenCalledTimes(4)
    expect(spy).toHaveBeenNthCalledWith(1, { queryKey: ['financial-summary'] })
    expect(spy).toHaveBeenNthCalledWith(2, { queryKey: ['progress-data'] })
    expect(spy).toHaveBeenNthCalledWith(3, { queryKey: ['budgets'] })
    expect(spy).toHaveBeenNthCalledWith(4, { queryKey: ['group-contributions'] })
  })
})
