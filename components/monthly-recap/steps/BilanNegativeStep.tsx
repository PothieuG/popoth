'use client'

import type { RecapContext, RecapSummary } from '@/lib/recap'

export function BilanNegativeStep({
  context,
  summary,
}: {
  context: RecapContext
  summary: RecapSummary
}) {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Bilan négatif</h1>
      <p className="text-sm text-gray-600">
        [TODO sprint 13] — contexte : {context} — déficit : {Math.abs(summary.bilan).toFixed(2)} €
      </p>
    </div>
  )
}
