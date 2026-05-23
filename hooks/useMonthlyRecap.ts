'use client'

import { useQuery } from '@tanstack/react-query'

import type { RecapContext, RecapStatusKind, RecapSummary } from '@/lib/recap'

export interface MonthlyRecapStatusResponse {
  status: RecapStatusKind
  summary: RecapSummary | null
}

export function useMonthlyRecap(context: RecapContext) {
  return useQuery<MonthlyRecapStatusResponse>({
    queryKey: ['monthly-recap', 'status', context],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/monthly-recap/status?context=${context}`, { signal })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'fetch_status_failed')
      }
      const json = (await res.json()) as { data: MonthlyRecapStatusResponse }
      return json.data
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}
