'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useFinancialData } from '@/hooks/useFinancialData'
import { useProgressData } from '@/hooks/useProgressData'

interface ExpenseBreakdownPreviewProps {
  amount: number
  budgetId: string
  context?: 'profile' | 'group'
  expenseId?: string // Pour le mode edition: simule reverse+reapply côté route
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

const formatAmount = (value: number): string =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(value)

/**
 * Compact formatter — omits the trailing ",00" when amount is whole-euro
 * to keep recap lines compact on mobile (matches the delete-confirmation
 * pattern in TransactionListItem).
 */
const formatAmountCompact = (value: number): string => {
  const formatted = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
  if (Math.round(value) === value) {
    return formatted.replace(/[,.]\d{2}(\s*€)/, '$1')
  }
  return formatted
}

/**
 * Impact lines (debits / credits) : explicit sign prefix. Positive value
 * (= un crédit / refund, rare mais possible en mode édition où l'API
 * recalcule des montants différents) → green avec "+" explicite. Négatif
 * → rouge avec "-" natif d'Intl. Zéro → gris.
 */
const signedAmountForImpact = (value: number): { text: string; color: string } => {
  if (value > 0) {
    return { text: `+${formatAmount(value)}`, color: 'text-green-600' }
  }
  if (value < 0) {
    return { text: formatAmount(value), color: 'text-red-600' }
  }
  return { text: formatAmount(0), color: 'text-gray-600' }
}

type EntityType = 'budget' | 'savings' | 'piggy' | 'rav'

const ENTITY_LABEL: Record<EntityType, { word: string; color: string }> = {
  budget: { word: 'Budget', color: 'text-orange-600' },
  savings: { word: 'Économies', color: 'text-violet-600' },
  piggy: { word: 'Tirelire', color: 'text-pink-600' },
  rav: { word: 'Reste à vivre', color: 'text-blue-600' },
}

/**
 * Aperçu de l'impact d'une dépense budgétée : lignes de sources débitées
 * en haut (« posé »), puis recap des soldes après opération en bas. Code
 * couleur par entité (label) — Sprint 2026-05-21 specs UX user :
 *   - Labels : Budget=orange, Économies=violet, Tirelire=pink, RAV=bleu
 *   - Noms des budgets en gras (à l'intérieur des « »)
 *   - Impact : montants positifs vert avec "+", négatifs rouge avec "-"
 *   - Recap : tous les chiffres en NOIR (pas de couleur sur les valeurs
 *     de la section "après opération" — couleur réservée à l'impact)
 *
 * Le composant se branche sur `useFinancialData(context)` +
 * `useProgressData(context)` pour calculer le nouveau RAV depuis le
 * delta de déficit budgétaire. En mode ADD comme en mode EDIT (où le
 * parent gate l'affichage sur un changement de montant — pas de fetch
 * inutile quand l'utilisateur ouvre la modal sans rien modifier).
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
  const { expenseProgress } = useProgressData(context)

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

  // RAV impact via budget overflow delta. En mode EDIT, la route route
  // preview-breakdown (post-fix Sprint 2026-05-21) garde le budget pool
  // un-reverted donc `budget_spent_before` représente le total actuel
  // (avec la dépense existante). expenseProgress.spentAmount renvoie la
  // même chose (les hooks lisent la même table). Les deux sont équivalents
  // en mode EDIT — on prend la valeur API qui ne dépend pas du cache
  // expenseProgress (fallback safer).
  const currentBudgetSpent = expenseProgress[budgetId]?.spentAmount ?? breakdown.budget_spent_before
  const currentOverflow = Math.max(0, currentBudgetSpent - breakdown.budget_estimated)
  const newOverflow = Math.max(0, breakdown.budget_spent_after - breakdown.budget_estimated)
  const ravDelta = newOverflow - currentOverflow
  const currentRav = financialData?.remainingToLive ?? null
  const newRav = currentRav != null ? currentRav - ravDelta : null

  const piggyDebit = breakdown.from_piggy_bank
  const savingsDebit = breakdown.from_budget_savings
  const budgetDebit = breakdown.from_budget
  const budgetName = breakdown.budget_name

  const showPiggy = piggyDebit > 0
  const showSavings = savingsDebit > 0
  const showBudgetDebit = budgetDebit > 0
  const showRavRecap = ravDelta !== 0 && newRav != null

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Impact de la dépense :</p>

        {/* Sources débitées (« posé ») */}
        <div className="space-y-1">
          {showPiggy && <ImpactRow label={<EntityLabel type="piggy" />} amount={-piggyDebit} />}
          {showSavings && (
            <ImpactRow
              label={<EntityLabel type="savings" budgetName={budgetName} />}
              amount={-savingsDebit}
            />
          )}
          {showBudgetDebit && (
            <ImpactRow
              label={<EntityLabel type="budget" budgetName={budgetName} />}
              amount={-budgetDebit}
            />
          )}
        </div>

        {/* Divider + Après opération */}
        <div className="flex items-center gap-2 pt-1">
          <div className="h-px flex-1 bg-blue-200" />
          <span className="text-xs font-medium tracking-wide text-gray-500 uppercase">
            Après opération
          </span>
          <div className="h-px flex-1 bg-blue-200" />
        </div>

        {/* Recap "après" — chiffres TOUS en noir (no green/red), labels gardent
            leur couleur d'entité. Tirelire/Économies seulement si touchées,
            Budget destination toujours affiché, RAV seulement si overflow change. */}
        <div className="space-y-1">
          {showPiggy && (
            <BalanceRow label={<EntityLabel type="piggy" />} amount={breakdown.piggy_bank_after} />
          )}
          {showSavings && (
            <BalanceRow label={<EntityLabel type="savings" />} amount={breakdown.savings_after} />
          )}
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

function EntityLabel({ type, budgetName }: { type: EntityType; budgetName?: string }) {
  const { word, color } = ENTITY_LABEL[type]
  return (
    <span className="min-w-0 flex-1 truncate text-gray-700">
      <span className={cn('font-medium', color)}>{word}</span>
      {budgetName ? (
        <>
          {' « '}
          <span className="font-bold">{budgetName}</span>
          {' »'}
        </>
      ) : null}
    </span>
  )
}

function ImpactRow({ label, amount }: { label: ReactNode; amount: number }) {
  const { text, color } = signedAmountForImpact(amount)
  return (
    <div className="flex items-baseline gap-2 text-sm">
      {label}
      <span className={cn('shrink-0 font-semibold', color)}>{text}</span>
    </div>
  )
}

/**
 * Recap balance row — chiffres en noir (gray-900), sans préfixe de signe.
 * Per UX spec Sprint 2026-05-21 : pas de couleur dans la section "Après
 * opération". Couleur réservée aux montants impact.
 */
function BalanceRow({ label, amount }: { label: ReactNode; amount: number }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      {label}
      <span className="shrink-0 font-semibold text-gray-900">{formatAmountCompact(amount)}</span>
    </div>
  )
}

/**
 * Budget recap row — format `dépensé/estimé` (matches planner convention).
 * Chiffres en noir (gray-900) même en cas d'overflow — l'utilisateur voit
 * directement `250€/200€` ce qui communique le dépassement sans nécessiter
 * de couleur.
 */
function BudgetRecapRow({
  budgetName,
  spent,
  estimated,
}: {
  budgetName: string
  spent: number
  estimated: number
}) {
  const text = `${formatAmountCompact(spent)}/${formatAmountCompact(estimated)}`
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <EntityLabel type="budget" budgetName={budgetName} />
      <span className="shrink-0 font-semibold text-gray-900">{text}</span>
    </div>
  )
}
