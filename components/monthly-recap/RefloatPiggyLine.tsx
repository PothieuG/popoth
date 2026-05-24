'use client'

import { Button } from '@/components/ui/button'
import { useRefloatFromPiggy } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import type { RecapContext } from '@/lib/recap'

interface RefloatPiggyLineProps {
  context: RecapContext
  piggyAmount: number
  deficitRemaining: number
  onError: (code: string) => void
}

/**
 * Sprint 13 — BilanNegativeStep ligne 1 (cf. spec §4.B). Renflouement
 * depuis la tirelire d'un montant clamp = `min(piggyAmount, deficitRemaining)`.
 *
 * - Si `piggyAmount === 0` : section grise indicative *"Pas d'argent dans la
 *   tirelire."* Aucun bouton.
 * - Sinon : carte rouge avec "Disponible : X€" + "À utiliser : Y€" + bouton
 *   *"Renflouer Y€"*. Le clic POST `/refloat-from-piggy` avec l'amount Y.
 *   Le cache se met à jour via `setQueryData` côté hook (fast path, pas de
 *   re-fetch).
 *
 * L'orchestrateur affiche d'éventuelles erreurs au niveau du step
 * (via `onError(code)`) plutôt que par ligne — un seul `role="alert"` global.
 */
export function RefloatPiggyLine({
  context,
  piggyAmount,
  deficitRemaining,
  onError,
}: RefloatPiggyLineProps) {
  const mutation = useRefloatFromPiggy(context)

  if (piggyAmount <= 0) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">Tirelire</p>
        <p className="mt-1 text-sm text-gray-500">Pas d&apos;argent dans la tirelire.</p>
      </section>
    )
  }

  const useAmount = Math.min(piggyAmount, deficitRemaining)

  const handleClick = async () => {
    try {
      await mutation.mutateAsync({ amount: useAmount })
    } catch (e) {
      onError(e instanceof Error ? e.message : 'unknown')
    }
  }

  return (
    <section className="rounded-2xl border border-red-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium text-gray-900">Tirelire</p>
      <dl className="space-y-1 text-xs text-gray-600">
        <div className="flex justify-between">
          <dt>Disponible</dt>
          <dd className="tabular-nums">{formatEuro(piggyAmount)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>À utiliser</dt>
          <dd className="font-semibold text-red-700 tabular-nums">{formatEuro(useAmount)}</dd>
        </div>
      </dl>
      <Button
        type="button"
        className="mt-3 w-full"
        onClick={handleClick}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? 'Chargement…' : `Renflouer ${formatEuro(useAmount)}`}
      </Button>
    </section>
  )
}
