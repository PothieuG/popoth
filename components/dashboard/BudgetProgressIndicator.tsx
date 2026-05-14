'use client'

import { cn } from '@/lib/utils'
import type { BudgetProgress } from '@/hooks/useBudgetProgress'

interface BudgetProgressIndicatorProps {
  progress: BudgetProgress
  className?: string
}

/**
 * Composant d'indicateur de progression pour les budgets
 * Affiche visuellement la progression d'un budget avec :
 * - En haut : montant dépensé/total sur toute la largeur
 * - En bas : pourcentage, nom du budget, et économies alignés
 *
 * Codes couleur pour budgets estimés :
 * - si 0€ : gris
 * - si de 0 à la valeur du budget estimé : jaune foncé
 * - si valeur du budget estimé : bleu
 * - si au-dessus du budget estimé : rouge
 */
export default function BudgetProgressIndicator({
  progress,
  className,
}: BudgetProgressIndicatorProps) {
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
   * Détermine la couleur selon la logique des budgets
   */
  const getBudgetTextColor = (): string => {
    const { spentAmount, estimatedAmount } = progress

    if (spentAmount === 0) {
      return 'text-gray-500' // Gris pour 0€
    } else if (spentAmount > 0 && spentAmount < estimatedAmount) {
      return 'text-yellow-600' // Jaune foncé pour entre 0 et budget estimé
    } else if (spentAmount === estimatedAmount) {
      return 'text-blue-600' // Bleu pour valeur exacte du budget estimé
    } else {
      return 'text-red-600' // Rouge pour au-dessus du budget estimé
    }
  }

  const textColorClass = getBudgetTextColor()

  return (
    <div className={cn('flex w-full flex-col', className)}>
      {/* Montant dépensé/total sur toute la largeur */}
      <div className="mb-2 flex w-full items-center text-base leading-tight font-black">
        <span className={cn('mr-1 font-black', textColorClass)}>
          {formatAmount(progress.spentAmount).split(' ')[0]}
        </span>
        <span className="font-black text-gray-600">
          {formatAmount(progress.spentAmount).split(' ')[1]} /{' '}
          {formatAmount(progress.estimatedAmount)}
        </span>
      </div>

      {/* Ligne du bas : pourcentage et budget/eco avec espace */}
      <div className="flex w-full flex-1 items-stretch">
        {/* Pourcentage avec code couleur - prend toute la hauteur restante */}
        <div
          className={cn('mr-3 flex items-center text-lg leading-tight font-bold', textColorClass)}
        >
          {Math.round(progress.percentage)}%
        </div>

        {/* Nom du budget et économies - alignés à gauche */}
        <div className="flex flex-1 flex-col justify-center">
          <h5 className="text-left text-sm font-medium text-gray-900">{progress.budgetName}</h5>
          <div className="text-left text-xs font-medium text-purple-600">
            Economies:{' '}
            <span className="font-bold text-purple-800">{formatAmount(progress.savings)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
