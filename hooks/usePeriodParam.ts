'use client'

import { useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import type { Period } from '@/lib/finance/period'

const VALID_PERIODS = new Set<Period>(['month', 'week', 'day'])

function parsePeriod(raw: string | null): Period {
  if (raw && (VALID_PERIODS as Set<string>).has(raw)) return raw as Period
  return 'month'
}

/**
 * Hook for reading + updating the `?period=` URL search param.
 *
 * Sprint P1 — switch hebdo/quotidien. The selected period is persisted in
 * the URL (shareable link) and consumed by all surfaces that filter by
 * period (TransactionTabsComponent listing, useExpenseProgress, etc.).
 *
 * Default is `'month'` (= no filter, "since last recap" semantics). When
 * the user picks `'month'` the param is removed from the URL to keep
 * default links clean.
 *
 * Uses `router.replace` (not push) so the period toggle doesn't pile up
 * history entries.
 */
export function usePeriodParam(): { period: Period; setPeriod: (next: Period) => void } {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const period = parsePeriod(searchParams.get('period'))

  const setPeriod = useCallback(
    (next: Period) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === 'month') {
        params.delete('period')
      } else {
        params.set('period', next)
      }
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname)
    },
    [searchParams, router, pathname],
  )

  return { period, setPeriod }
}
