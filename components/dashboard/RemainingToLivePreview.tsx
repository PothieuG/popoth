'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { useFinancialData } from '@/hooks/useFinancialData'
import { useProgressData } from '@/hooks/useProgressData'
import { BalanceRow, EntityLabel, ImpactRow } from '@/components/dashboard/recap-rows'

interface RemainingToLivePreviewProps {
  /**
   * Montant de la transaction en cours de saisie
   */
  amount: number

  /**
   * Type de transaction
   */
  type: 'expense' | 'income'

  /**
   * Si la transaction est exceptionnelle
   */
  isExceptional: boolean

  /**
   * ID du budget/revenu sélectionné (si pas exceptionnel)
   */
  selectedId?: string

  /**
   * Contexte (profile ou group)
   */
  context?: 'profile' | 'group'
}

/**
 * Aperçu de l'impact d'une transaction (exceptionnelle ou revenu régulier)
 * sur le reste à vivre. Sprint 2026-05-22 / Recap-Compact-And-Uniform :
 * refondue pour utiliser les primitives `recap-rows` partagées avec
 * `<ExpenseBreakdownPreview>` — même panel bleu, même header + divider
 * "Après opération", même format de lignes (label coloré par entité +
 * montant signé green/red en impact, balance noire en recap).
 */
export default function RemainingToLivePreview({
  amount,
  type,
  isExceptional,
  selectedId,
  context = 'profile',
}: RemainingToLivePreviewProps) {
  const { financialData, loading, isFetching } = useFinancialData(context)
  const { expenseProgress, incomeProgress } = useProgressData(context)

  /**
   * Calcule le nouveau reste à vivre avec la transaction ajoutée
   */
  const { newRemainingToLive, change } = (() => {
    if (!financialData || loading || isNaN(amount) || amount <= 0) {
      return { newRemainingToLive: financialData?.remainingToLive || 0, change: 0 }
    }

    const currentRemainingToLive = financialData.remainingToLive

    // Pour les transactions exceptionnelles, l'impact est direct
    if (isExceptional) {
      const impact = type === 'expense' ? -amount : amount
      return {
        newRemainingToLive: currentRemainingToLive + impact,
        change: impact,
      }
    }

    // Pour les transactions budgétées/estimées, calculer l'impact réel
    if (type === 'expense' && selectedId) {
      // Vérifier si c'est un dépassement de budget
      const progress = expenseProgress[selectedId]

      if (progress) {
        const currentSpent = progress.spentAmount
        const newTotalSpent = currentSpent + amount
        const budgetAmount = progress.estimatedAmount

        // Si le nouveau total dépasse le budget, l'excès impacte le reste à vivre
        if (newTotalSpent > budgetAmount) {
          const previousOverrun = Math.max(0, currentSpent - budgetAmount)
          const newOverrun = newTotalSpent - budgetAmount
          const additionalOverrun = newOverrun - previousOverrun

          return {
            newRemainingToLive: currentRemainingToLive - additionalOverrun,
            change: -additionalOverrun,
          }
        }
      }

      // Si pas de dépassement, pas d'impact (déjà budgété)
      return { newRemainingToLive: currentRemainingToLive, change: 0 }
    } else if (type === 'income' && selectedId) {
      // Pour les revenus, vérifier si c'est un bonus
      const progress = incomeProgress[selectedId]

      if (progress) {
        const currentReceived = progress.receivedAmount
        const newTotalReceived = currentReceived + amount
        const estimatedAmount = progress.estimatedAmount

        // Calculer l'impact de cette transaction par rapport à l'estimation
        const currentDifference = currentReceived - estimatedAmount
        const newDifference = newTotalReceived - estimatedAmount

        // Si aucun revenu n'a encore été reçu (currentReceived = 0),
        // l'impact est la différence totale par rapport à l'estimation (newDifference)
        // Sinon, c'est le changement différentiel normal

        if (currentReceived === 0) {
          // Premier revenu pour cette estimation : impact = différence totale vs estimation
          return {
            newRemainingToLive: currentRemainingToLive + newDifference,
            change: newDifference,
          }
        } else {
          // Revenus supplémentaires : impact = changement différentiel
          const additionalChange = newDifference - currentDifference

          if (additionalChange !== 0) {
            return {
              newRemainingToLive: currentRemainingToLive + additionalChange,
              change: additionalChange,
            }
          }
        }
      }

      // Si pas de bonus, pas d'impact (déjà estimé)
      return { newRemainingToLive: currentRemainingToLive, change: 0 }
    }

    // Fallback: pas d'impact
    return { newRemainingToLive: currentRemainingToLive, change: 0 }
  })()

  if (loading || isFetching || !financialData) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      </div>
    )
  }

  // Ne pas afficher si le montant est invalide
  if (isNaN(amount) || amount <= 0) {
    return null
  }

  // Caption explicative selon le cas
  const captionText = isExceptional
    ? `${type === 'expense' ? 'Dépense' : 'Revenu'} exceptionnel — impact direct sur le reste à vivre.`
    : change !== 0
      ? type === 'expense'
        ? 'Dépassement de budget.'
        : change > 0
          ? "Bonus au-delà de l'estimation."
          : "Déficit par rapport à l'estimation."
      : type === 'expense'
        ? 'Dans les limites du budget — pas d’impact sur le reste à vivre.'
        : "Dans les limites de l'estimation — pas d'impact sur le reste à vivre."

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Impact sur le reste à vivre :</p>

        {/* Impact section — affiché seulement si delta != 0 */}
        {change !== 0 && (
          <div className="space-y-1">
            <ImpactRow label={<EntityLabel type="rav" />} amount={change} />
          </div>
        )}

        {/* Divider + Après opération */}
        <div className="flex items-center gap-2 pt-1">
          <div className="h-px flex-1 bg-blue-200" />
          <span className="text-xs font-medium tracking-wide text-gray-500 uppercase">
            Après opération
          </span>
          <div className="h-px flex-1 bg-blue-200" />
        </div>

        {/* Recap section — RAV après opération en noir */}
        <div className="space-y-1">
          <BalanceRow label={<EntityLabel type="rav" />} amount={newRemainingToLive} />
        </div>

        {/* Caption explicative */}
        <p className="text-xs text-gray-500">{captionText}</p>
      </div>
    </div>
  )
}
