'use client'

import { Button } from '@/components/ui/button'
import { useSaveBudgetSnapshot } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import { computeProportionalBudgetSnapshot } from '@/lib/recap/calculations'
import type { BudgetSummary, RecapContext } from '@/lib/recap'

/**
 * État de la ligne dans la cascade séquentielle :
 *
 * - `locked`   : tirelire OU économies non encore épuisées. En attente.
 * - `active`   : tout est épuisé en amont ET déficit non comblé. Cliquable.
 * - `done`     : snapshot déjà persisté pendant ce recap. Récap + liste des
 *   nouvelles valeurs par budget (consommé / estimé).
 * - `unneeded` : déficit déjà comblé par la tirelire et/ou les économies.
 * - `empty`    : aucun budget n'existe (rien à équilibrer). Greyed, no button.
 */
type SnapshotLineState = 'locked' | 'active' | 'done' | 'unneeded' | 'empty'

interface RefloatBudgetSnapshotLineProps {
  context: RecapContext
  state: SnapshotLineState
  budgets: readonly BudgetSummary[]
  deficitRemaining: number
  snapshotData: Record<string, number> | null
  onError: (code: string) => void
  onSuccess: (message: string) => void
}

/**
 * Sprint 13 — BilanNegativeStep ligne 3. Équilibrage proportionnel : combien
 * retirer de chaque budget pour combler le déficit (3e et dernière étape).
 *
 * Theme **orange** (convention UI Popoth : budgets = orange, distinct de
 * la famille violet tirelire/économies).
 *
 * Layout active : liste 2-lignes par budget (nom + delta sur ligne 1,
 * before → after / max sur ligne 2) — évite la troncature sur mobile.
 */
export function RefloatBudgetSnapshotLine({
  context,
  state,
  budgets,
  deficitRemaining,
  snapshotData,
  onError,
  onSuccess,
}: RefloatBudgetSnapshotLineProps) {
  const mutation = useSaveBudgetSnapshot(context)

  if (state === 'locked') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Équilibrer avec les budgets</p>
        <p className="mt-1 text-xs text-gray-500">
          Disponible après avoir épuisé la tirelire et les économies.
        </p>
      </section>
    )
  }

  if (state === 'unneeded') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Équilibrer avec les budgets</p>
        <p className="mt-1 text-xs text-gray-500">Pas nécessaire — le déficit est déjà comblé.</p>
      </section>
    )
  }

  if (state === 'empty') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Équilibrer avec les budgets</p>
        <p className="mt-1 text-xs text-gray-500">Aucun budget à équilibrer.</p>
      </section>
    )
  }

  if (state === 'done') {
    const totalEquilibre = snapshotData ? Object.values(snapshotData).reduce((s, v) => s + v, 0) : 0
    const anyOvershoot = budgets.some((b) => {
      const share = snapshotData?.[b.budgetId] ?? 0
      return b.carryoverSpentAmount + share > b.estimatedAmount + 0.01
    })
    return (
      <section className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
        <p className="text-sm font-medium text-orange-900">Équilibrer avec les budgets</p>
        <p className="mt-2 text-xs text-gray-700">
          <span className="font-semibold tabular-nums">{formatEuro(totalEquilibre)}</span>{' '}
          équilibrés depuis les budgets (effectif à la finalisation du récap).
        </p>
        {anyOvershoot && <OvershootHint />}
        <p className="mt-3 text-xs text-gray-500">Nouvelles valeurs par budget :</p>
        <ul className="mt-1 space-y-1 text-xs text-gray-700">
          {budgets.map((b) => {
            const snapshotShare = snapshotData?.[b.budgetId] ?? 0
            const consumed = b.carryoverSpentAmount + snapshotShare
            const overshoot = consumed > b.estimatedAmount + 0.01
            return (
              <li key={b.budgetId} className="flex items-baseline justify-between gap-2">
                <span className="truncate">{b.budgetName}</span>
                <span className="flex shrink-0 items-baseline gap-1.5">
                  <span className="font-medium text-orange-800 tabular-nums">
                    {formatEuro(consumed)} / {formatEuro(b.estimatedAmount)}
                  </span>
                  {overshoot && <OvershootBadge percent={percentOf(consumed, b.estimatedAmount)} />}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  // active
  const previewAllocation = computeProportionalBudgetSnapshot(
    deficitRemaining,
    budgets.map((b) => ({ budgetId: b.budgetId, estimatedAmount: b.estimatedAmount })),
  )
  const previewByBudget = new Map(previewAllocation.perBudget.map((p) => [p.budgetId, p.amount]))
  const anyOvershootPreview = budgets.some((b) => {
    const debit = previewByBudget.get(b.budgetId) ?? 0
    return b.carryoverSpentAmount + debit > b.estimatedAmount + 0.01
  })
  // Sprint Carryover-Self-Healing UI (2026-05-26) — recap mid-flight pre-fix
  // peut avoir un snapshot existant qui n'a pas couvert (cap atteint).
  // Le serveur recompute from scratch et remplace ; la preview client suit
  // le même semantic (deficitRemaining = budgetTargetDeficit). On surface
  // le recompute explicitement pour éviter de surprendre l'user.
  const hasExistingSnapshot = snapshotData && Object.keys(snapshotData).length > 0

  const handleClick = async () => {
    try {
      const result = await mutation.mutateAsync()
      const totalEquilibre = Object.values(result.snapshot).reduce((s, v) => s + v, 0)
      onSuccess(`${formatEuro(totalEquilibre)} équilibrés depuis les budgets`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'unknown')
    }
  }

  return (
    <section className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
      <p className="text-sm font-medium text-orange-900">Équilibrer avec les budgets</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-700">
        On retire le déficit restant proportionnellement à chaque budget (en fonction de leur
        taille). Les budgets ne seront effectivement débités qu&apos;à la finalisation du récap.
      </p>
      {hasExistingSnapshot && (
        <p className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] leading-snug text-blue-900">
          Un précédent équilibrage existe et sera remplacé par cette nouvelle répartition.
        </p>
      )}
      {anyOvershootPreview && <OvershootHint />}
      <ul className="mt-3 space-y-2 text-xs text-gray-700">
        {budgets.map((b) => {
          const previewDebit = previewByBudget.get(b.budgetId) ?? 0
          const consumedBefore = b.carryoverSpentAmount
          const consumedAfter = consumedBefore + previewDebit
          const overshoot = consumedAfter > b.estimatedAmount + 0.01
          return (
            <li key={b.budgetId} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">{b.budgetName}</span>
                <span className="shrink-0 font-medium text-orange-700 tabular-nums">
                  +{formatEuro(previewDebit)}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 text-gray-500 tabular-nums">
                <span>{formatEuro(consumedBefore)}</span>
                <span aria-hidden="true" className="text-gray-400">
                  →
                </span>
                <span className="font-semibold text-orange-800">{formatEuro(consumedAfter)}</span>
                <span className="text-gray-400">/</span>
                <span>{formatEuro(b.estimatedAmount)}</span>
                {overshoot && (
                  <OvershootBadge percent={percentOf(consumedAfter, b.estimatedAmount)} />
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <Button
        type="button"
        variant="secondary"
        className="mt-3 w-full border border-orange-300 bg-orange-100 text-orange-900 hover:bg-orange-200"
        onClick={handleClick}
        disabled={mutation.isPending || budgets.length === 0}
      >
        {mutation.isPending ? 'Chargement…' : 'Équilibrer'}
      </Button>
    </section>
  )
}

/**
 * Sprint Carryover-Self-Healing UI (2026-05-26) — affiché quand un budget va
 * démarrer le mois suivant à plus de 100% (carryover + snapshot > estimated).
 * `percent` est arrondi à l'entier le plus proche. Non-cliquable.
 */
function OvershootBadge({ percent }: { percent: number }) {
  return (
    <span
      role="img"
      aria-label={`Budget surchargé à ${percent} pour cent`}
      className="inline-flex shrink-0 items-center rounded-full border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800 tabular-nums"
    >
      ⚠ {percent}%
    </span>
  )
}

/**
 * Sprint Carryover-Self-Healing UI (2026-05-26) — hint section-level placé
 * sous l'intro, affiché uniquement quand un ou plusieurs budgets vont
 * démarrer surchargés. Explique la mécanique self-healing en 1 phrase.
 */
function OvershootHint() {
  return (
    <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-900">
      Certains budgets démarreront le mois prochain au-dessus de 100%. La dette se résorbera
      d&apos;elle-même les mois suivants tant que tu sous-consommes ces budgets.
    </p>
  )
}

function percentOf(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}
