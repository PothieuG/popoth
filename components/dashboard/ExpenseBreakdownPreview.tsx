'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'

interface ExpenseBreakdownPreviewProps {
  amount: number
  budgetId: string
  context?: 'profile' | 'group'
  expenseId?: string // Pour le mode edition: simule reverse+reapply
}

interface BreakdownData {
  total_amount: number
  from_piggy_bank: number
  from_budget_savings: number
  from_budget: number
  piggy_bank_before: number
  piggy_bank_after: number
  savings_before: number
  savings_after: number
  budget_spent_before: number
  budget_spent_after: number
  budget_estimated: number
  budget_name: string
}

/**
 * Component that displays a detailed breakdown of how an expense will be allocated
 * across piggy bank → savings → budget
 */
export default function ExpenseBreakdownPreview({
  amount,
  budgetId,
  context = 'profile',
  expenseId
}: ExpenseBreakdownPreviewProps) {
  const [breakdown, setBreakdown] = useState<BreakdownData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!amount || amount <= 0 || !budgetId) {
      setBreakdown(null)
      return
    }

    const fetchBreakdown = async () => {
      try {
        setLoading(true)
        setError(null)

        const params = new URLSearchParams({
          amount: amount.toString(),
          budget_id: budgetId,
          context
        })
        if (expenseId) {
          params.set('expense_id', expenseId)
        }

        const response = await fetch(`/api/finances/expenses/preview-breakdown?${params}`, {
          credentials: 'include'
        })

        if (!response.ok) {
          throw new Error('Erreur lors du calcul du breakdown')
        }

        const data = await response.json()
        setBreakdown(data.breakdown)
      } catch (err) {
        console.error('Error fetching breakdown:', err)
        setError(err instanceof Error ? err.message : 'Erreur inconnue')
      } finally {
        setLoading(false)
      }
    }

    fetchBreakdown()
  }, [amount, budgetId, context, expenseId])

  const formatCurrency = (value: number) => {
    return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
  }

  if (loading) {
    return (
      <Card className="p-4 bg-blue-50 border-blue-200">
        <div className="animate-pulse">
          <div className="h-4 bg-blue-200 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-blue-200 rounded w-1/2"></div>
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="p-4 bg-red-50 border-red-200">
        <p className="text-sm text-red-600">{error}</p>
      </Card>
    )
  }

  if (!breakdown) {
    return null
  }

  const hasMultipleSources =
    breakdown.from_piggy_bank > 0 &&
    (breakdown.from_budget_savings > 0 || breakdown.from_budget > 0) ||
    breakdown.from_budget_savings > 0 && breakdown.from_budget > 0

  return (
    <Card className="p-4 bg-gradient-to-br from-blue-50 to-purple-50 border-blue-200">
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-blue-200">
          <h4 className="font-semibold text-gray-900">Répartition de la dépense</h4>
          <span className="text-lg font-bold text-blue-600">
            {formatCurrency(breakdown.total_amount)}
          </span>
        </div>

        {/* Source Breakdown */}
        <div className="space-y-2">
          {breakdown.from_piggy_bank > 0 && (
            <div className="flex items-center justify-between text-sm bg-white/60 p-2 rounded">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                <span className="text-gray-700">De la tirelire</span>
              </div>
              <span className="font-semibold text-purple-600">
                {formatCurrency(breakdown.from_piggy_bank)}
              </span>
            </div>
          )}

          {breakdown.from_budget_savings > 0 && (
            <div className="flex items-center justify-between text-sm bg-white/60 p-2 rounded">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <span className="text-gray-700">Des économies du budget</span>
              </div>
              <span className="font-semibold text-green-600">
                {formatCurrency(breakdown.from_budget_savings)}
              </span>
            </div>
          )}

          {breakdown.from_budget > 0 && (
            <div className="flex items-center justify-between text-sm bg-white/60 p-2 rounded">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                <span className="text-gray-700">Du budget principal</span>
              </div>
              <span className="font-semibold text-orange-600">
                {formatCurrency(breakdown.from_budget)}
              </span>
            </div>
          )}
        </div>

        {/* Detailed Impact Table */}
        <div className="pt-3 border-t border-blue-200">
          <h5 className="text-xs font-medium text-gray-600 mb-2">Impact détaillé :</h5>
          <div className="space-y-2">
            {/* Piggy Bank */}
            {breakdown.from_piggy_bank > 0 && (
              <div className="bg-white/80 p-2 rounded text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-700">Tirelire</span>
                  <span className="text-purple-600">
                    {formatCurrency(breakdown.piggy_bank_before)} → {formatCurrency(breakdown.piggy_bank_after)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-gray-500">
                  <span>Variation</span>
                  <span className="font-medium text-red-600">
                    -{formatCurrency(breakdown.from_piggy_bank)}
                  </span>
                </div>
              </div>
            )}

            {/* Budget Savings */}
            {breakdown.from_budget_savings > 0 && (
              <div className="bg-white/80 p-2 rounded text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-700">Économies ({breakdown.budget_name})</span>
                  <span className="text-green-600">
                    {formatCurrency(breakdown.savings_before)} → {formatCurrency(breakdown.savings_after)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-gray-500">
                  <span>Variation</span>
                  <span className="font-medium text-red-600">
                    -{formatCurrency(breakdown.from_budget_savings)}
                  </span>
                </div>
              </div>
            )}

            {/* Budget Main */}
            <div className="bg-white/80 p-2 rounded text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-gray-700">Budget ({breakdown.budget_name})</span>
                <span className={breakdown.from_budget > 0 ? 'text-orange-600' : 'text-gray-500'}>
                  {formatCurrency(breakdown.budget_spent_before)} → {formatCurrency(breakdown.budget_spent_after)} / {formatCurrency(breakdown.budget_estimated)}
                </span>
              </div>
              {breakdown.from_budget > 0 && (
                <div className="flex items-center justify-between text-gray-500">
                  <span>Variation</span>
                  <span className="font-medium text-red-600">
                    +{formatCurrency(breakdown.from_budget)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Summary Message */}
        <div className="pt-2 border-t border-blue-200">
          <p className="text-xs text-gray-600 text-center">
            {breakdown.from_piggy_bank > 0 && breakdown.from_budget === 0 ? (
              '✨ Cette dépense sera entièrement couverte par vos économies'
            ) : breakdown.from_budget > 0 && breakdown.budget_spent_after > breakdown.budget_estimated ? (
              `⚠️ Attention : dépassement de ${formatCurrency(breakdown.budget_spent_after - breakdown.budget_estimated)}`
            ) : breakdown.from_budget > 0 ? (
              `📊 Reste disponible : ${formatCurrency(breakdown.budget_estimated - breakdown.budget_spent_after)}`
            ) : (
              '✅ Budget non impacté'
            )}
          </p>
        </div>
      </div>
    </Card>
  )
}
