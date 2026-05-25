'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useAdvanceStep, useStartRecap } from '@/hooks/useMonthlyRecap'
import type { RecapContext } from '@/lib/recap'

const ERROR_COPY: Record<string, string> = {
  locked_by_other: 'Un autre membre est déjà en train de faire le récap. Réessaie plus tard.',
  already_completed: 'Le récap de ce mois est déjà terminé. Redirection…',
  no_active_recap: 'Impossible de poursuivre — relance la page.',
  invalid_transition: 'Cette étape ne peut pas être franchie. Recharge la page.',
  stale_step: "L'état du récap a changé. Rafraîchis pour reprendre.",
}

function pickErrorCopy(code: string): string {
  return ERROR_COPY[code] ?? 'Une erreur est survenue. Réessaie dans un instant.'
}

export function WelcomeStep({ context }: { context: RecapContext }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const startMutation = useStartRecap(context)
  const advanceMutation = useAdvanceStep(context)

  const isPending = startMutation.isPending || advanceMutation.isPending

  const handleStart = async () => {
    setError(null)
    try {
      // POST /start is idempotent server-side (RPC returns 'resumed' when a
      // row already exists for this initiator). Re-clicks during the same
      // session are safe — even mid-wizard refresh lands here at step='welcome'.
      await startMutation.mutateAsync()
      // Sprint Complete-Month-Step (2026-05-29) — advance vers la nouvelle
      // étape 2 "Compléter le mois" plutôt que directement vers summary.
      // L'utilisateur peut y rattraper d'éventuelles transactions oubliées
      // du mois recapé avant que le bilan soit affiché.
      await advanceMutation.mutateAsync({ fromStep: 'welcome', toStep: 'complete_month' })
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      setError(pickErrorCopy(code))
      if (code === 'already_completed') {
        const target = context === 'group' ? '/group-dashboard' : '/dashboard'
        router.replace(target)
      }
    }
  }

  return (
    <div className="space-y-6 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Bienvenue</h1>
      <div className="space-y-2 text-sm text-gray-700">
        <p>Bienvenue dans le récap mensuel du mois écoulé.</p>
        <p>
          Tu vas pouvoir faire le point sur tes budgets, gérer surplus et déficits, puis finaliser
          le mois avant de retourner au dashboard.
        </p>
      </div>
      <Button onClick={handleStart} disabled={isPending} className="w-full">
        {isPending ? 'Démarrage…' : 'Commencer'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
