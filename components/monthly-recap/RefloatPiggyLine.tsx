'use client'

import { Button } from '@/components/ui/button'
import { useRefloatFromPiggy } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import type { RecapContext } from '@/lib/recap'

/**
 * État de la ligne dans la cascade séquentielle :
 *
 * - `active` : la ligne attend une action de l'utilisateur (tirelire non
 *   vide ET déficit non comblé). Bouton "Renflouer X€" cliquable.
 * - `done`   : la ligne a déjà été utilisée pendant ce recap (refloatedFromPiggy > 0
 *   ET tirelire vidée maintenant). Carte greyed avec récap "X€ transférés".
 * - `empty`  : la tirelire est vide depuis le départ — aucune action n'a
 *   été faite et il n'y a rien à faire. Carte greyed avec "Pas d'argent".
 *
 * Pas de variante `locked` ici : la tirelire est toujours la 1re ligne
 * de la cascade, jamais bloquée par une autre.
 */
type PiggyLineState = 'active' | 'done' | 'empty'

interface RefloatPiggyLineProps {
  context: RecapContext
  state: PiggyLineState
  piggyAmount: number
  deficitRemaining: number
  /** Cumulative amount already pulled from the piggy during this recap.
   *  Used to label the `done` state ("XX€ déjà transférés vers le déficit"). */
  refloatedFromPiggy: number
  onError: (code: string) => void
  onSuccess: (message: string) => void
}

/**
 * Sprint 13 — BilanNegativeStep ligne 1 (cf. spec §4.B). Renflouement
 * depuis la tirelire (1re étape de la cascade séquentielle).
 *
 * Theme **violet** (cf. convention UI Popoth : tirelire = violet, même
 * code couleur que `BilanPositiveStep` + `SurplusSelectionDrawer`).
 *
 * 3 états visuels (cf. `PiggyLineState` ci-dessus). Sur succès de la
 * mutation, le compteur déficit recalcule automatiquement via
 * `setQueryData` côté hook → la carte rerend en `done` si la tirelire est
 * vidée. La snackbar de feedback est gérée au niveau orchestrateur
 * (`BilanNegativeStep`) via le callback `onSuccess`.
 */
export function RefloatPiggyLine({
  context,
  state,
  piggyAmount,
  deficitRemaining,
  refloatedFromPiggy,
  onError,
  onSuccess,
}: RefloatPiggyLineProps) {
  const mutation = useRefloatFromPiggy(context)

  if (state === 'empty') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">Tirelire</p>
        <p className="mt-1 text-sm text-gray-500">Pas d&apos;argent dans la tirelire.</p>
      </section>
    )
  }

  if (state === 'done') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">Tirelire</p>
        <p className="mt-1 text-xs text-gray-600">
          {formatEuro(refloatedFromPiggy)} de la tirelire utilisée pour combler le déficit.
        </p>
        <p className="mt-1 text-xs text-gray-600">
          Il reste{' '}
          <span className="font-semibold text-gray-900 tabular-nums">
            {formatEuro(piggyAmount)}
          </span>{' '}
          dans la tirelire.
        </p>
      </section>
    )
  }

  // active
  const useAmount = Math.min(piggyAmount, deficitRemaining)

  const handleClick = async () => {
    try {
      await mutation.mutateAsync({ amount: useAmount })
      onSuccess(`${formatEuro(useAmount)} transférés depuis la tirelire`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'unknown')
    }
  }

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
      <p className="text-sm font-medium text-violet-900">Tirelire</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-600">
        On utilise la tirelire en priorité pour combler le déficit. Le montant transféré sortira
        immédiatement de la tirelire.
      </p>
      <dl className="mt-3 space-y-1 text-xs text-gray-700">
        <div className="flex justify-between">
          <dt>Disponible</dt>
          <dd className="tabular-nums">{formatEuro(piggyAmount)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>À transférer</dt>
          <dd className="font-semibold text-violet-800 tabular-nums">{formatEuro(useAmount)}</dd>
        </div>
      </dl>
      <Button
        type="button"
        variant="secondary"
        className="mt-3 w-full border border-violet-300 bg-violet-100 text-violet-900 hover:bg-violet-200"
        onClick={handleClick}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? 'Chargement…' : `Renflouer ${formatEuro(useAmount)}`}
      </Button>
    </section>
  )
}
