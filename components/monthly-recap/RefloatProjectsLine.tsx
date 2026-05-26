'use client'

import { Button } from '@/components/ui/button'
import { useRefloatFromProjects } from '@/hooks/useMonthlyRecap'
import type { SavingsProjectMeta } from '@/lib/finance/types'
import { formatEuro } from '@/lib/format-currency'
import { computeProportionalProjectsRefloat } from '@/lib/recap/calculations'
import type { RecapContext } from '@/lib/recap'

/**
 * État de la ligne dans la cascade séquentielle :
 *
 * - `locked`   : tirelire OU économies non encore épuisées. En attente.
 * - `active`   : tirelire + économies épuisées en amont ET projets disponibles
 *   ET déficit non comblé. Cliquable.
 * - `done`     : projets déjà refloués pendant ce recap. Récap + liste des
 *   débits virtuels par projet.
 * - `empty`    : aucun projet actif disponible dès le départ.
 * - `unneeded` : déficit déjà comblé par la tirelire et/ou les économies.
 */
type ProjectsLineState = 'locked' | 'active' | 'done' | 'empty' | 'unneeded'

interface RefloatProjectsLineProps {
  context: RecapContext
  state: ProjectsLineState
  projects: readonly SavingsProjectMeta[]
  deficitRemaining: number
  projectSnapshotData: Record<string, number> | null
  onError: (code: string) => void
  onSuccess: (message: string) => void
}

/**
 * Sprint Projets-Épargne 09 — BilanNegativeStep ligne 3 (étape intermédiaire
 * entre `RefloatSavingsLine` et `RefloatBudgetSnapshotLine`). Pour chaque
 * projet d'épargne actif, on "renonce" virtuellement à la mensualité du mois
 * pour combler le déficit — proportionnellement à la `monthly_allocation`
 * de chaque projet, capped au déficit restant.
 *
 * Theme **violet** (convention UI Popoth : projets = économies = famille
 * violet, comme `RefloatSavingsLine`). Distinct du orange réservé aux
 * budgets snapshot.
 *
 * Layout active : liste 2-lignes par projet (nom + delta sur ligne 1,
 * mensualité before → after sur ligne 2). Mode passthrough — aucune mutation
 * réelle sur `savings_projects` ici, application différée à finalize
 * (sprint 10) via `apply_recap_projects_snapshot`.
 */
export function RefloatProjectsLine({
  context,
  state,
  projects,
  deficitRemaining,
  projectSnapshotData,
  onError,
  onSuccess,
}: RefloatProjectsLineProps) {
  const mutation = useRefloatFromProjects(context)

  if (state === 'locked') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Renflouer par les projets</p>
        <p className="mt-1 text-xs text-gray-500">
          Disponible après avoir transféré la tirelire et les économies.
        </p>
      </section>
    )
  }

  if (state === 'empty') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Renflouer par les projets</p>
        <p className="mt-1 text-xs text-gray-500">Aucun projet à utiliser.</p>
      </section>
    )
  }

  if (state === 'unneeded') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Renflouer par les projets</p>
        <p className="mt-1 text-xs text-gray-500">Pas nécessaire — le déficit est déjà comblé.</p>
      </section>
    )
  }

  if (state === 'done') {
    const totalRefloated = projectSnapshotData
      ? Object.values(projectSnapshotData).reduce((s, v) => s + v, 0)
      : 0
    return (
      <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
        <p className="text-sm font-medium text-violet-900">Renflouer par les projets</p>
        <p className="mt-2 text-xs text-gray-700">
          <span className="font-semibold tabular-nums">{formatEuro(totalRefloated)}</span> de
          mensualités projets utilisés pour combler le déficit (effectif à la finalisation du
          récap).
        </p>
        <p className="mt-3 text-xs text-gray-500">Mensualités ce mois-ci :</p>
        <ul className="mt-1 space-y-1 text-xs text-gray-700">
          {projects.map((p) => {
            const debit = projectSnapshotData?.[p.id] ?? 0
            const remaining = Math.max(0, p.monthlyAllocation - debit)
            return (
              <li key={p.id} className="flex items-baseline justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 font-medium text-violet-800 tabular-nums">
                  {formatEuro(remaining)} / {formatEuro(p.monthlyAllocation)}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  // active — filter to projects with a non-zero monthly allocation
  const projectsByPool = projects.filter((p) => p.monthlyAllocation > 0)
  const allocation = computeProportionalProjectsRefloat(
    deficitRemaining,
    projectsByPool.map((p) => ({ projectId: p.id, monthlyAllocation: p.monthlyAllocation })),
  )
  const perProjectDebit = new Map(allocation.perBudget.map((p) => [p.budgetId, p.amount]))
  const totalPreview = allocation.totalAllocated

  const handleClick = async () => {
    try {
      const result = await mutation.mutateAsync()
      const total = Object.values(result.allocation).reduce((s, v) => s + v, 0)
      onSuccess(`${formatEuro(total)} de mensualités projets utilisés`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'unknown')
    }
  }

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
      <p className="text-sm font-medium text-violet-900">Renflouer par les projets</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-700">
        On utilise la mensualité de chaque projet d&apos;épargne, proportionnellement à sa taille,
        pour combler le déficit. Les projets ne seront effectivement débités qu&apos;à la
        finalisation du récap.
      </p>
      <ul className="mt-3 space-y-2 text-xs text-gray-700">
        {projectsByPool.map((p) => {
          const debit = perProjectDebit.get(p.id) ?? 0
          const after = Math.max(0, p.monthlyAllocation - debit)
          return (
            <li key={p.id} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 font-medium text-violet-700 tabular-nums">
                  −{formatEuro(debit)}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 text-gray-500 tabular-nums">
                <span>{formatEuro(p.monthlyAllocation)}</span>
                <span aria-hidden="true" className="text-gray-400">
                  →
                </span>
                <span className="font-semibold text-violet-800">{formatEuro(after)}</span>
              </div>
            </li>
          )
        })}
      </ul>
      <Button
        type="button"
        variant="secondary"
        className="mt-3 w-full border border-violet-300 bg-violet-100 text-violet-900 hover:bg-violet-200"
        onClick={handleClick}
        disabled={mutation.isPending || projectsByPool.length === 0}
      >
        {mutation.isPending
          ? 'Chargement…'
          : `Utiliser ${formatEuro(totalPreview)} depuis les projets`}
      </Button>
    </section>
  )
}
