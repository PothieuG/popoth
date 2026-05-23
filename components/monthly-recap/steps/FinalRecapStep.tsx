'use client'

import type { RecapContext, RecapSummary } from '@/lib/recap'

export function FinalRecapStep({
  context,
  summary,
}: {
  context: RecapContext
  summary: RecapSummary
}) {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Récapitulatif final</h1>
      <p className="text-sm text-gray-600">
        [TODO sprint 14] — contexte : {context} — solde : {summary.currentBalance.toFixed(2)} €
      </p>
    </div>
  )
}
