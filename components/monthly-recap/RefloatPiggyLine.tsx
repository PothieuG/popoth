'use client'

import { Button } from '@/components/ui/button'
import { useRefloatFromPiggy } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import type { RecapContext } from '@/lib/recap'

/**
 * État de la ligne dans la cascade séquentielle :
 *
 * - `active`   : tirelire non vide ET déficit non comblé. Bouton "Renflouer X€".
 * - `done`     : tirelire utilisée pendant ce recap. Récap "X utilisée, Y reste".
 * - `empty`    : tirelire vide depuis le départ (jamais touchée). Carte greyed.
 * - `unneeded` : tirelire a de l'argent mais le déficit est déjà couvert par
 *   autre chose (cas rare puisque la tirelire est toujours la 1re étape).
 */
type PiggyLineState = 'active' | 'done' | 'empty' | 'unneeded'

interface RefloatPiggyLineProps {
  context: RecapContext
  state: PiggyLineState
  piggyAmount: number
  deficitRemaining: number
  refloatedFromPiggy: number
  onError: (code: string) => void
  onSuccess: (message: string) => void
}

/**
 * Sprint 13 — BilanNegativeStep ligne 1. Renflouement depuis la tirelire.
 *
 * Theme **violet** (convention UI Popoth : tirelire = violet).
 *
 * Le done state utilise la même couleur violet (cohérence visuelle de la
 * famille tirelire/économies) ; les états inactifs (empty/unneeded) sont
 * en `bg-white` pour bien contraster avec le fond bleu de la page wizard.
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
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Tirelire</p>
        <p className="mt-1 text-sm text-gray-500">Pas d&apos;argent dans la tirelire.</p>
      </section>
    )
  }

  if (state === 'unneeded') {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-700">Tirelire</p>
        <p className="mt-1 text-sm text-gray-500">Pas nécessaire — le déficit est déjà comblé.</p>
      </section>
    )
  }

  if (state === 'done') {
    return (
      <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
        <p className="text-sm font-medium text-violet-900">Tirelire</p>
        <p className="mt-2 text-xs text-gray-700">
          <span className="font-semibold tabular-nums">{formatEuro(refloatedFromPiggy)}</span> de la
          tirelire utilisée pour combler le déficit.
        </p>
        <p className="mt-1 text-xs text-gray-700">
          Il reste{' '}
          <span className="font-semibold text-violet-800 tabular-nums">
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
    <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
      <p className="text-sm font-medium text-violet-900">Tirelire</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-700">
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
