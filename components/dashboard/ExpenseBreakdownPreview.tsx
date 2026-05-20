'use client'

import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'

interface ExpenseBreakdownPreviewProps {
  amount: number
  budgetId: string
  context?: 'profile' | 'group'
  expenseId?: string // Pour le mode edition: simule reverse+reapply
  /**
   * Sprint P4-P5-P6 / P5 toggle. When true, savings consumed BEFORE
   * budget in the preview breakdown. Default false → P4 strict.
   */
  useSavings?: boolean
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
  expenseId,
  useSavings = false,
}: ExpenseBreakdownPreviewProps) {
  const enabled = amount > 0 && !!budgetId

  const {
    data: breakdown = null,
    isLoading,
    error,
  } = useQuery<BreakdownData>({
    queryKey: ['expense-breakdown', amount, budgetId, context, expenseId ?? null, useSavings],
    enabled,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        amount: amount.toString(),
        budget_id: budgetId,
        context,
      })
      if (expenseId) {
        params.set('expense_id', expenseId)
      }
      if (useSavings) {
        params.set('use_savings', 'true')
      }

      const response = await fetch(`/api/finance/expenses/preview-breakdown?${params}`, {
        credentials: 'include',
        signal,
      })

      if (!response.ok) {
        throw new Error('Erreur lors du calcul du breakdown')
      }

      const data = await response.json()
      return data.breakdown as BreakdownData
    },
  })

  const formatCurrency = (value: number) => {
    return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
  }

  if (isLoading) {
    return (
      <Card className="border-blue-200 bg-blue-50 p-4">
        <div className="animate-pulse">
          <div className="mb-1.5 h-4 w-3/4 rounded bg-blue-200"></div>
          <div className="h-4 w-1/2 rounded bg-blue-200"></div>
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">
          {error instanceof Error ? error.message : 'Erreur inconnue'}
        </p>
      </Card>
    )
  }

  if (!breakdown) {
    return null
  }

  return (
    <Card className="border-blue-200 bg-linear-to-br from-blue-50 to-purple-50 p-4">
      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-blue-200 pb-2">
          <h4 className="font-semibold text-gray-900">Répartition de la dépense</h4>
          <span className="text-lg font-bold text-blue-600">
            {formatCurrency(breakdown.total_amount)}
          </span>
        </div>

        {/* Source Breakdown */}
        <div className="space-y-1.5">
          {breakdown.from_piggy_bank > 0 && (
            <div className="flex items-center justify-between rounded bg-white/60 p-2 text-sm">
              <div className="flex items-center space-x-1.5">
                <div className="h-2 w-2 rounded-full bg-purple-500"></div>
                <span className="text-gray-700">De la tirelire</span>
              </div>
              <span className="font-semibold text-purple-600">
                {formatCurrency(breakdown.from_piggy_bank)}
              </span>
            </div>
          )}

          {breakdown.from_budget_savings > 0 && (
            <div className="flex items-center justify-between rounded bg-white/60 p-2 text-sm">
              <div className="flex items-center space-x-1.5">
                <div className="h-2 w-2 rounded-full bg-green-500"></div>
                <span className="text-gray-700">Des économies du budget</span>
              </div>
              <span className="font-semibold text-green-600">
                {formatCurrency(breakdown.from_budget_savings)}
              </span>
            </div>
          )}

          {breakdown.from_budget > 0 && (
            <div className="flex items-center justify-between rounded bg-white/60 p-2 text-sm">
              <div className="flex items-center space-x-1.5">
                <div className="h-2 w-2 rounded-full bg-orange-500"></div>
                <span className="text-gray-700">Du budget principal</span>
              </div>
              <span className="font-semibold text-orange-600">
                {formatCurrency(breakdown.from_budget)}
              </span>
            </div>
          )}
        </div>

        {/* Detailed Impact Table */}
        <div className="border-t border-blue-200 pt-3">
          <h5 className="mb-1.5 text-xs font-medium text-gray-600">Impact détaillé :</h5>
          <div className="space-y-1.5">
            {/* Piggy Bank */}
            {breakdown.from_piggy_bank > 0 && (
              <div className="rounded bg-white/80 p-2 text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium text-gray-700">Tirelire</span>
                  <span className="text-purple-600">
                    {formatCurrency(breakdown.piggy_bank_before)} →{' '}
                    {formatCurrency(breakdown.piggy_bank_after)}
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
              <div className="rounded bg-white/80 p-2 text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium text-gray-700">
                    Économies ({breakdown.budget_name})
                  </span>
                  <span className="text-green-600">
                    {formatCurrency(breakdown.savings_before)} →{' '}
                    {formatCurrency(breakdown.savings_after)}
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
            <div className="rounded bg-white/80 p-2 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-gray-700">Budget ({breakdown.budget_name})</span>
                <span className={breakdown.from_budget > 0 ? 'text-orange-600' : 'text-gray-500'}>
                  {formatCurrency(breakdown.budget_spent_before)} →{' '}
                  {formatCurrency(breakdown.budget_spent_after)} /{' '}
                  {formatCurrency(breakdown.budget_estimated)}
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
        <div className="border-t border-blue-200 pt-2">
          <p className="text-center text-xs text-gray-600">
            {breakdown.from_piggy_bank > 0 && breakdown.from_budget === 0
              ? '✨ Cette dépense sera entièrement couverte par vos économies'
              : breakdown.from_budget > 0 &&
                  breakdown.budget_spent_after > breakdown.budget_estimated
                ? `⚠️ Attention : dépassement de ${formatCurrency(breakdown.budget_spent_after - breakdown.budget_estimated)}`
                : breakdown.from_budget > 0
                  ? `📊 Reste disponible : ${formatCurrency(breakdown.budget_estimated - breakdown.budget_spent_after)}`
                  : '✅ Budget non impacté'}
          </p>
        </div>
      </div>
    </Card>
  )
}
