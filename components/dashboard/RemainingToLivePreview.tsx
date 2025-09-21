'use client'

import { useMemo } from 'react'
import { useFinancialData } from '@/hooks/useFinancialData'
import { calculateRemainingToLiveProfile, calculateRemainingToLiveGroup } from '@/lib/financial-calculations'
import { useProgressData } from '@/hooks/useProgressData'
import { useBudgets } from '@/hooks/useBudgets'
import { useIncomes } from '@/hooks/useIncomes'

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
 * Composant qui affiche un aperçu de l'impact d'une transaction
 * sur le reste à vivre avec code couleur
 */
export default function RemainingToLivePreview({
  amount,
  type,
  isExceptional,
  selectedId,
  context = 'profile'
}: RemainingToLivePreviewProps) {
  const { financialData, loading } = useFinancialData(context)
  const { expenseProgress, incomeProgress } = useProgressData(context)
  const { budgets } = useBudgets(context)
  const { incomes } = useIncomes(context)

  /**
   * Calcule le nouveau reste à vivre avec la transaction ajoutée
   */
  const { newRemainingToLive, change } = useMemo(() => {
    if (!financialData || loading || isNaN(amount) || amount <= 0) {
      return { newRemainingToLive: financialData?.remainingToLive || 0, change: 0 }
    }

    const currentRemainingToLive = financialData.remainingToLive

    // Pour les transactions exceptionnelles, l'impact est direct
    if (isExceptional) {
      const impact = type === 'expense' ? -amount : amount
      return {
        newRemainingToLive: currentRemainingToLive + impact,
        change: impact
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
            change: -additionalOverrun
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
            change: newDifference
          }
        } else {
          // Revenus supplémentaires : impact = changement différentiel
          const additionalChange = newDifference - currentDifference

          if (additionalChange !== 0) {
            return {
              newRemainingToLive: currentRemainingToLive + additionalChange,
              change: additionalChange
            }
          }
        }
      }

      // Si pas de bonus, pas d'impact (déjà estimé)
      return { newRemainingToLive: currentRemainingToLive, change: 0 }
    }

    // Fallback: pas d'impact
    return { newRemainingToLive: currentRemainingToLive, change: 0 }
  }, [financialData, loading, amount, type, isExceptional, selectedId, expenseProgress, incomeProgress, budgets, incomes])

  /**
   * Détermine la couleur selon la valeur
   */
  const getColorClass = (value: number) => {
    if (value > 0) return 'text-green-600'
    if (value < 0) return 'text-red-600'
    return 'text-gray-500'
  }

  /**
   * Formate le montant en euros
   */
  const formatEur = (value: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR'
    }).format(value)
  }

  if (loading || !financialData) {
    return (
      <div className="bg-gray-50 rounded-lg p-4 border">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-6 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    )
  }

  // Ne pas afficher si le montant est invalide
  if (isNaN(amount) || amount <= 0) {
    return null
  }

  return (
    <div className="bg-blue-50/50 rounded-lg p-4 border border-blue-200">
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">
          Impact sur le reste à vivre :
        </p>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Actuel :</span>
          <span className={`font-semibold ${getColorClass(financialData.remainingToLive)}`}>
            {formatEur(financialData.remainingToLive)}
          </span>
        </div>

        {change !== 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">
              {change > 0 ? 'Ajout :' : 'Déduction :'}
            </span>
            <span className={`font-semibold ${getColorClass(change)}`}>
              {change > 0 ? '+' : ''}{formatEur(change)}
            </span>
          </div>
        )}

        {/* Affichage spécial pour les déficits de revenus */}
        {!isExceptional && type === 'income' && selectedId && amount > 0 && (
          (() => {
            const progress = incomeProgress[selectedId]
            if (progress) {
              const newTotalReceived = (progress.receivedAmount || 0) + amount
              const totalDeficitOrBonus = newTotalReceived - progress.estimatedAmount
              if (totalDeficitOrBonus < 0) {
                return (
                  <div className="flex items-center justify-between border-t border-blue-200 pt-2">
                    <span className="text-xs text-gray-600">Déficit total :</span>
                    <span className="text-xs font-semibold text-red-600">
                      {formatEur(totalDeficitOrBonus)}
                    </span>
                  </div>
                )
              }
            }
            return null
          })()
        )}

        <div className="pt-2 border-t border-blue-200">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Nouveau :</span>
            <span className={`text-lg font-bold ${getColorClass(newRemainingToLive)}`}>
              {formatEur(newRemainingToLive)}
            </span>
          </div>
        </div>

        {isExceptional ? (
          <p className="text-xs text-blue-600 mt-2">
            {type === 'expense' ? 'Dépense' : 'Revenu'} exceptionnel - Impact direct sur le reste à vivre
          </p>
        ) : change !== 0 ? (
          <p className="text-xs text-amber-600 mt-2">
            {type === 'expense' ? 'Dépassement de budget' : change > 0 ? 'Bonus au-delà de l\'estimation' : 'Déficit par rapport à l\'estimation'}
          </p>
        ) : (
          <p className="text-xs text-gray-500 mt-2">
            {type === 'expense' ? 'Dans les limites du budget' : 'Dans les limites de l\'estimation'}
          </p>
        )}
      </div>
    </div>
  )
}