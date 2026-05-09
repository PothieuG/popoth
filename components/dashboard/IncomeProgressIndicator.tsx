'use client'

import { cn } from '@/lib/utils'
import type { IncomeProgress } from '@/hooks/useIncomeProgress'

interface IncomeProgressIndicatorProps {
  progress: IncomeProgress
  className?: string
}

/**
 * Composant d'indicateur de progression pour les revenus
 * Affiche visuellement la progression d'un revenu avec :
 * - En haut : montant reçu/total sur toute la largeur
 * - En bas : pourcentage et nom du revenu alignés
 *
 * Codes couleur pour revenus estimés :
 * - si revenu estimé pas encore utilisé (0€ reçu) : gris
 * - si valeur du revenu estimé ou supérieur : vert
 * - si en dessous de 10% de la valeur estimé (90-100%) : jaune foncé
 * - si en dessous de cette valeur de 10% (<90%) : rouge
 */
export default function IncomeProgressIndicator({
  progress,
  className,
}: IncomeProgressIndicatorProps) {
  /**
   * Formate un montant en euros avec 2 décimales
   */
  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  /**
   * Détermine la couleur selon la logique des revenus
   * NOUVELLE LOGIQUE : gris si pas encore utilisé (0€ reçu)
   */
  const getIncomeTextColor = (): string => {
    const { receivedAmount, estimatedAmount } = progress

    if (receivedAmount === 0) {
      return 'text-gray-500' // Gris pour revenu estimé non encore utilisé
    } else if (receivedAmount >= estimatedAmount) {
      return 'text-green-600' // Vert pour valeur estimée ou supérieure
    } else if (receivedAmount >= estimatedAmount * 0.9) {
      return 'text-yellow-600' // Jaune foncé pour dans les 10% de la valeur estimée (90-100%)
    } else {
      return 'text-red-600' // Rouge pour en dessous de 90%
    }
  }

  const textColorClass = getIncomeTextColor()

  return (
    <div className={cn('flex w-full flex-col', className)}>
      {/* Montant reçu/total sur toute la largeur */}
      <div className="mb-2 flex w-full items-center text-base font-black leading-tight">
        <span className={cn('mr-1 font-black', textColorClass)}>
          {formatAmount(progress.receivedAmount).split(' ')[0]}
        </span>
        <span className="font-black text-gray-600">
          {formatAmount(progress.receivedAmount).split(' ')[1]} /{' '}
          {formatAmount(progress.estimatedAmount)}
        </span>
      </div>

      {/* Ligne du bas : pourcentage et nom du revenu */}
      <div className="flex w-full flex-1 items-stretch">
        {/* Pourcentage avec code couleur - prend toute la hauteur restante */}
        <div
          className={cn('mr-3 flex items-center text-lg font-bold leading-tight', textColorClass)}
        >
          {Math.round(progress.percentage)}%
        </div>

        {/* Nom du revenu - aligné à gauche */}
        <div className="flex flex-1 flex-col justify-center">
          <h5 className="text-left text-sm font-medium text-gray-900">{progress.incomeName}</h5>
        </div>
      </div>
    </div>
  )
}
