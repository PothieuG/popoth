'use client'

import type { RecapContext, RecapSummary } from '@/lib/recap'

export function SummaryStep({
  context,
  summary,
}: {
  context: RecapContext
  summary: RecapSummary
}) {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Récap général</h1>
      <p className="text-sm text-gray-600">
        [TODO sprint 11] — contexte : {context} — bilan : {summary.bilan.toFixed(2)} €
      </p>
    </div>
  )
}
