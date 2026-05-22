'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type ScenarioKey =
  | 'fresh'
  | 'happy-surplus'
  | 'deficit-light'
  | 'deficit-cascade'
  | 'with-group'
  | 'edge-empty-piggy'

interface ScenarioSummary {
  key: ScenarioKey
  label: string
  description: string
}

interface SeedResult {
  success: boolean
  message: string
  data: {
    success: boolean
    scenario: ScenarioKey
    summary: {
      profile_id: string
      group_id: string | null
      budgets_created: number
      expenses_created: number
      incomes_created: number
      real_incomes_created: number
      piggy_bank_set: number
      bank_balance_set: number
    }
    errors: string[]
  }
}

interface ResetResult {
  success: boolean
  message: string
  details: {
    context: 'profile' | 'group'
    month: number
    year: number
    recaps_deleted: number
    snapshots_deactivated: boolean
  }
}

type ApiResult = SeedResult | ResetResult | { error: string }

function isError(r: ApiResult): r is { error: string } {
  return 'error' in r
}

export default function DevRecapV2Client() {
  const router = useRouter()
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [loadingScenarios, setLoadingScenarios] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState<'profile' | 'group' | null>(null)
  const [result, setResult] = useState<ApiResult | null>(null)

  useEffect(() => {
    fetch('/api/debug/recap-v2/scenarios', { credentials: 'same-origin' })
      .then(async (response) => {
        if (response.status === 401) {
          throw new Error(
            'Session invalide — connecte-toi via /connexion puis reviens sur /dev/recap-v2',
          )
        }
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${response.status}`)
        }
        return response.json() as Promise<{ data: ScenarioSummary[] }>
      })
      .then((payload) => setScenarios(payload.data))
      .catch((err: unknown) => {
        setResult({ error: err instanceof Error ? err.message : 'Erreur chargement scénarios' })
      })
      .finally(() => setLoadingScenarios(false))
  }, [])

  async function handleApply(key: ScenarioKey) {
    setBusyKey(key)
    setResult(null)
    try {
      const response = await fetch('/api/debug/recap-v2/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ scenario: key }),
      })
      const body = (await response.json()) as ApiResult
      setResult(body)
    } catch (err: unknown) {
      setResult({ error: err instanceof Error ? err.message : 'Erreur réseau' })
    } finally {
      setBusyKey(null)
    }
  }

  async function handleReset(context: 'profile' | 'group') {
    setResetBusy(context)
    setResult(null)
    try {
      const response = await fetch('/api/debug/recap-v2/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ context }),
      })
      const body = (await response.json()) as ApiResult
      setResult(body)
    } catch (err: unknown) {
      setResult({ error: err instanceof Error ? err.message : 'Erreur réseau' })
    } finally {
      setResetBusy(null)
    }
  }

  function goToRecap(context: 'profile' | 'group') {
    router.push(`/monthly-recap?context=${context}`)
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100 p-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold tracking-wide text-amber-600 uppercase">
            Dev only — bloqué en prod
          </p>
          <h1 className="mt-1 text-xl font-bold text-gray-900">Recap V2 — testing</h1>
          <p className="mt-1 text-sm text-gray-600">
            Sélectionne un scénario pour seeder ta DB, puis va sur{' '}
            <Link href="/monthly-recap" className="text-blue-600 underline">
              /monthly-recap
            </Link>{' '}
            pour tester le flow V2. Le seed wipe tes finances avant d&apos;appliquer.
          </p>
        </header>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">
            Reset V2 — drop ligne du mois
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleReset('profile')}
              disabled={resetBusy !== null}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {resetBusy === 'profile' ? '…' : 'Reset profile'}
            </button>
            <button
              type="button"
              onClick={() => handleReset('group')}
              disabled={resetBusy !== null}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {resetBusy === 'group' ? '…' : 'Reset group'}
            </button>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Scénarios</h2>
          {loadingScenarios ? (
            <p className="text-sm text-gray-500">Chargement…</p>
          ) : scenarios.length === 0 ? (
            <p className="text-sm text-gray-500">Aucun scénario disponible.</p>
          ) : (
            <ul className="space-y-3">
              {scenarios.map((s) => (
                <li key={s.key} className="rounded-lg border border-gray-200 p-3">
                  <h3 className="text-sm font-semibold text-gray-900">{s.label}</h3>
                  <p className="mt-1 text-xs text-gray-600">{s.description}</p>
                  <button
                    type="button"
                    onClick={() => handleApply(s.key)}
                    disabled={busyKey !== null}
                    className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busyKey === s.key ? 'Application…' : 'Appliquer'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {result && (
          <section
            className={`rounded-2xl p-4 shadow-sm ${
              !isError(result) && result.success
                ? 'bg-emerald-50'
                : isError(result)
                  ? 'bg-red-50'
                  : 'bg-amber-50'
            }`}
          >
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Résultat</h2>
            <pre className="overflow-x-auto text-xs break-words whitespace-pre-wrap text-gray-800">
              {JSON.stringify(result, null, 2)}
            </pre>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => goToRecap('profile')}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Aller au récap (profile)
              </button>
              <button
                type="button"
                onClick={() => goToRecap('group')}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Aller au récap (group)
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
