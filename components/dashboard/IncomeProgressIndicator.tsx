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
 * - si valeur du revenu estimé ou supérieur : vert
 * - si en dessous de 10% de la valeur estimé (90-100%) : jaune foncé
 * - si en dessous de cette valeur de 10% (<90%) : rouge
 */
export default function IncomeProgressIndicator({
  progress,
  className
}: IncomeProgressIndicatorProps) {

  /**
   * Formate un montant en euros avec 2 décimales
   */
  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2
    }).format(amount)
  }

  /**
   * Détermine la couleur selon la logique des revenus
   */
  const getIncomeTextColor = (): string => {
    const { receivedAmount, estimatedAmount } = progress

    if (receivedAmount >= estimatedAmount) {
      return 'text-green-600' // Vert pour valeur estimée ou supérieure
    } else if (receivedAmount >= (estimatedAmount * 0.9)) {
      return 'text-yellow-600' // Jaune foncé pour dans les 10% de la valeur estimée (90-100%)
    } else {
      return 'text-red-600' // Rouge pour en dessous de 90%
    }
  }

  const textColorClass = getIncomeTextColor()

  return (
    <div className={cn('flex flex-col w-full', className)}>
      {/* Montant reçu/total sur toute la largeur */}
      <div className="text-base font-black leading-tight flex items-center mb-2 w-full">
        <span className={cn(
          'font-black mr-1',
          textColorClass
        )}>
          {formatAmount(progress.receivedAmount).split(' ')[0]}
        </span>
        <span className="text-gray-600 font-black">
          {formatAmount(progress.receivedAmount).split(' ')[1]} / {formatAmount(progress.estimatedAmount)}
        </span>
      </div>

      {/* Ligne du bas : pourcentage et nom du revenu */}
      <div className="flex items-stretch w-full flex-1">
        {/* Pourcentage avec code couleur - prend toute la hauteur restante */}
        <div className={cn(
          'text-lg font-bold leading-tight flex items-center mr-3',
          textColorClass
        )}>
          {Math.round(progress.percentage)}%
        </div>

        {/* Nom du revenu - aligné à gauche */}
        <div className="flex-1 flex flex-col justify-center">
          <h5 className="font-medium text-gray-900 text-sm text-left">{progress.incomeName}</h5>
        </div>
      </div>
    </div>
  )
}