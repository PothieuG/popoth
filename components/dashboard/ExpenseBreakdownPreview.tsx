'use client'

import { useQuery } from '@tanstack/react-query'
import { useFinancialData } from '@/hooks/useFinancialData'
import {
  BalanceRow,
  BudgetRecapRow,
  EntityLabel,
  ImpactRow,
} from '@/components/dashboard/recap-rows'

interface ExpenseBreakdownPreviewProps {
  amount: number
  budgetId: string
  context?: 'profile' | 'group'
  expenseId?: string // Pour le mode edition: simule reverse+reapply côté route
  /**
   * Sprint P4-P5-P6 / P5 toggle. When true, savings consumed BEFORE
   * budget in the preview breakdown. Default false → P4 strict.
   *
   * Note 2026-05-21 : `AddTransactionModal` passe désormais `true` par
   * défaut (toggle UI retiré). Le paramètre reste exposé pour
   * compatibilité ascendante avec d'éventuels consumers futurs (Phase 2
   * cross-budget cascade) qui voudraient opt-out.
   */
  useSavings?: boolean
}

interface CrossBudgetDebitPreviewUi {
  budget_id: string
  budget_name: string
  amount: number
  available_before: number
  available_after: number
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
  cross_budget_debits: CrossBudgetDebitPreviewUi[]
}

/**
 * Aperçu de l'impact d'une dépense budgétée — section haute « Impact de la
 * dépense » (sources débitées + RAV impact si overflow) et section basse
 * « Après opération » (soldes finaux des entités touchées).
 *
 * Sprint 2026-05-21 / Impact-Lines-Refactor :
 *   - Section Impact : nouvelle ligne **Reste à vivre** (delta-based, ±) +
 *     ligne **Budget** devient delta-based (-X red si pool plus chargé,
 *     +X green si pool refundé). Lignes Économies/Tirelire restent
 *     absolue (= `-new.from_X` red, conformément aux exemples user).
 *   - Section Après : recap des soldes finaux en noir (text-gray-900),
 *     labels colorés par entité.
 *
 * Le composant se branche sur `useFinancialData(context)` +
 * `useProgressData(context)` pour calculer le delta RAV depuis le delta
 * de déficit budgétaire (ADD comme EDIT).
 */
export default function ExpenseBreakdownPreview({
  amount,
  budgetId,
  context = 'profile',
  expenseId,
  useSavings = false,
}: ExpenseBreakdownPreviewProps) {
  const enabled = amount > 0 && !!budgetId
  const { financialData } = useFinancialData(context)

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

  if (isLoading) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-3/4 rounded bg-blue-100"></div>
          <div className="h-4 w-1/2 rounded bg-blue-100"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">
          {error instanceof Error ? error.message : 'Erreur inconnue'}
        </p>
      </div>
    )
  }

  if (!breakdown) {
    return null
  }

  // currentBudgetSpent = fresh DB read via la route preview-breakdown. On
  // utilise `breakdown.budget_spent_before` exclusivement (drop dépendance
  // useProgressData qui peut être stale entre 2 ouvertures rapides du modal :
  // `?? fallback` ne tire pas sur `0`, donc un cache stale à 0 cassait le
  // delta et affichait une ligne Budget fantôme dans Impact).
  const currentBudgetSpent = breakdown.budget_spent_before
  const currentOverflow = Math.max(0, currentBudgetSpent - breakdown.budget_estimated)
  const newOverflow = Math.max(0, breakdown.budget_spent_after - breakdown.budget_estimated)
  const ravDelta = newOverflow - currentOverflow

  // Budget pool usage delta (Sprint 2026-05-21 / Impact-Lines-Refactor) :
  // l'IMPACT ligne Budget reflète maintenant le delta dans la portion du
  // pool budgétaire utilisée (capped à estimated), pas le `new.from_budget`
  // absolu. Quand l'utilisateur réduit une dépense qui débordait, on voit
  // le refund vers le pool (+X green) plutôt qu'un simple "-X red" sur la
  // nouvelle valeur.
  const existingBudgetPoolUsage = Math.min(currentBudgetSpent, breakdown.budget_estimated)
  const newBudgetPoolUsage = Math.min(breakdown.budget_spent_after, breakdown.budget_estimated)
  const budgetPoolDelta = newBudgetPoolUsage - existingBudgetPoolUsage

  const currentRav = financialData?.remainingToLive ?? null
  const newRav = currentRav != null ? currentRav - ravDelta : null

  const piggyDebit = breakdown.from_piggy_bank
  const savingsDebit = breakdown.from_budget_savings
  const budgetName = breakdown.budget_name
  const crossBudgetDebits = breakdown.cross_budget_debits ?? []

  const showPiggyImpact = piggyDebit > 0
  const showSavingsImpact = savingsDebit > 0
  const showBudgetImpact = budgetPoolDelta !== 0
  const showRavImpact = ravDelta !== 0

  const showPiggyRecap = piggyDebit > 0
  const showSavingsRecap = savingsDebit > 0
  const showRavRecap = ravDelta !== 0 && newRav != null

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Impact de la dépense :</p>

        {/* Sources débitées + impact RAV (« posé »).
            Sign convention: amount > 0 = green refund (+X), amount < 0 = red debit (-X). */}
        <div className="space-y-1">
          {showPiggyImpact && (
            <ImpactRow label={<EntityLabel type="piggy" />} amount={-piggyDebit} />
          )}
          {showSavingsImpact && (
            <ImpactRow
              label={<EntityLabel type="savings" budgetName={budgetName} />}
              amount={-savingsDebit}
            />
          )}
          {crossBudgetDebits.map((d) => (
            <ImpactRow
              key={d.budget_id}
              label={<EntityLabel type="savings" budgetName={d.budget_name} />}
              amount={-d.amount}
            />
          ))}
          {showBudgetImpact && (
            <ImpactRow
              label={<EntityLabel type="budget" budgetName={budgetName} />}
              amount={-budgetPoolDelta}
            />
          )}
          {showRavImpact && <ImpactRow label={<EntityLabel type="rav" />} amount={-ravDelta} />}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <div className="h-px flex-1 bg-blue-200" />
          <span className="text-xs font-medium tracking-wide text-gray-500 uppercase">
            Après opération
          </span>
          <div className="h-px flex-1 bg-blue-200" />
        </div>

        <div className="space-y-1">
          {showPiggyRecap && (
            <BalanceRow label={<EntityLabel type="piggy" />} amount={breakdown.piggy_bank_after} />
          )}
          {showSavingsRecap && (
            <BalanceRow
              label={<EntityLabel type="savings" budgetName={budgetName} />}
              amount={breakdown.savings_after}
            />
          )}
          {crossBudgetDebits.map((d) => (
            <BalanceRow
              key={d.budget_id}
              label={<EntityLabel type="savings" budgetName={d.budget_name} />}
              amount={d.available_after}
            />
          ))}
          <BudgetRecapRow
            budgetName={budgetName}
            spent={breakdown.budget_spent_after}
            estimated={breakdown.budget_estimated}
          />
          {showRavRecap && newRav != null && (
            <BalanceRow label={<EntityLabel type="rav" />} amount={newRav} />
          )}
        </div>
      </div>
    </div>
  )
}
