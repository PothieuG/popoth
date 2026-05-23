'use client'

import type { RecapContext, RecapSummary } from '@/lib/recap'

export function BilanPositiveStep({
  context,
  summary,
}: {
  context: RecapContext
  summary: RecapSummary
}) {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Bilan positif</h1>
      <p className="text-sm text-gray-600">
        [TODO sprint 12] — contexte : {context} — surplus total : {summary.totalSurplus.toFixed(2)}{' '}
        €
      </p>
    </div>
  )
}
