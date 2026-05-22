'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function MonthlyRecapLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-blue-50 to-indigo-100 p-4">
      <p className="text-gray-600">Chargement…</p>
    </div>
  )
}

export default function MonthlyRecapPage() {
  return (
    <Suspense fallback={<MonthlyRecapLoadingFallback />}>
      <MonthlyRecapPageContent />
    </Suspense>
  )
}

function MonthlyRecapPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const context: 'profile' | 'group' = searchParams.get('context') === 'group' ? 'group' : 'profile'

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClose() {
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch('/api/monthly-recap/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Erreur lors de la clôture du mois')
        setSubmitting(false)
        return
      }
      router.replace(context === 'group' ? '/group-dashboard' : '/dashboard')
    } catch {
      setError('Erreur réseau — réessaie dans un instant')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-linear-to-br from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg">
        <h1 className="mb-1 text-center text-xl font-semibold text-gray-900">
          Récapitulatif mensuel
        </h1>
        <p className="mb-4 text-center text-sm text-gray-500">
          {context === 'group' ? 'Groupe' : 'Personnel'}
        </p>
        <p className="mb-6 text-sm leading-relaxed text-gray-700">
          Le récap V2 est en cours de construction. Pour ne pas bloquer ton accès à l&apos;app, tu
          peux clôturer ce mois sans flow détaillé. La nouvelle version arrivera dans les prochains
          sprints.
        </p>
        <button
          type="button"
          onClick={handleClose}
          disabled={submitting}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Clôture en cours…' : 'Clôturer ce mois'}
        </button>
        {error ? (
          <p role="alert" className="mt-4 text-center text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
