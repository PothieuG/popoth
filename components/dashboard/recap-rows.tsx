'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Primitives partagées entre `<ExpenseBreakdownPreview>` (aperçu impact/recap
 * d'une dépense en cours d'ajout/édition) et `<TransactionListItem>` (modal
 * de confirmation suppression — affiche le "Après opération" tel quel,
 * Sprint 2026-05-21 / Recap-Reuse-Delete-Confirmation).
 *
 * Code couleur par entité (UX user spec) :
 *   - Budget         → orange-600 (label) + bold sur le nom entre « »
 *   - Économies      → violet-600
 *   - Tirelire       → pink-600
 *   - Reste à vivre  → blue-600
 *
 * Format des montants :
 *   - **Impact** (delta du recap) : `signedAmountForImpact` — positif vert
 *     avec préfixe "+", négatif rouge avec "-" natif Intl, zéro gris.
 *   - **Balance** (état post-opération, section "Après") : `formatAmountCompact`
 *     en noir (text-gray-900) — pas de code couleur par signe, conformément à
 *     l'UX user "couleurs sur les chiffres réservées à la section Impact".
 */

export type EntityType = 'budget' | 'savings' | 'piggy' | 'rav'

const ENTITY_LABEL: Record<EntityType, { word: string; color: string }> = {
  budget: { word: 'Budget', color: 'text-orange-600' },
  savings: { word: 'Économies', color: 'text-violet-600' },
  piggy: { word: 'Tirelire', color: 'text-pink-600' },
  rav: { word: 'Reste à vivre', color: 'text-blue-600' },
}

/**
 * Standard fr-FR currency format with cents. Used for impact debit lines so
 * the sign is unambiguous (e.g. `-25,00 €`).
 */
export const formatAmount = (value: number): string =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(value)

/**
 * Compact formatter — omits the trailing ",00" when amount is whole-euro to
 * keep recap lines compact on mobile (matches the delete-confirmation pattern
 * historiquement utilisé dans TransactionListItem).
 */
export const formatAmountCompact = (value: number): string => {
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
 * Impact amount formatter (debits / credits) : explicit sign prefix.
 * Positive value (= un crédit / refund) → green avec "+" explicite. Négatif
 * → rouge avec "-" natif d'Intl. Zéro → gris.
 */
export const signedAmountForImpact = (value: number): { text: string; color: string } => {
  if (value > 0) {
    return { text: `+${formatAmount(value)}`, color: 'text-green-600' }
  }
  if (value < 0) {
    return { text: formatAmount(value), color: 'text-red-600' }
  }
  return { text: formatAmount(0), color: 'text-gray-600' }
}

/**
 * Label coloré pour une entité financière (Budget/Économies/Tirelire/RAV).
 * Le nom du budget (si fourni) est rendu en **gras** entre les « ».
 */
export function EntityLabel({ type, budgetName }: { type: EntityType; budgetName?: string }) {
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

/**
 * Ligne IMPACT — affiche un montant signé avec préfixe +/- coloré.
 * Le label peut inclure le nom du budget en gras via `EntityLabel`.
 */
export function ImpactRow({ label, amount }: { label: ReactNode; amount: number }) {
  const { text, color } = signedAmountForImpact(amount)
  return (
    <div className="flex items-baseline gap-2 text-sm">
      {label}
      <span className={cn('shrink-0 font-semibold', color)}>{text}</span>
    </div>
  )
}

/**
 * Ligne BALANCE — état post-opération d'une entité (Tirelire/Économies/RAV).
 * Chiffres en noir (text-gray-900), sans préfixe de signe, format compact
 * (strip `,00` pour whole-euros).
 */
export function BalanceRow({ label, amount }: { label: ReactNode; amount: number }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      {label}
      <span className="shrink-0 font-semibold text-gray-900">{formatAmountCompact(amount)}</span>
    </div>
  )
}

/**
 * Ligne BUDGET RECAP — format `dépensé/estimé` (matches planner convention).
 * Chiffres en noir même en cas d'overflow — le ratio `250€/200€` communique
 * directement le dépassement sans nécessiter de couleur.
 */
export function BudgetRecapRow({
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

/**
 * Encart "Après opération" complet — bordure bleu clair, divider centré, et
 * stack vertical de lignes. Réutilisé par `<ExpenseBreakdownPreview>` (en
 * combinaison avec la section Impact au-dessus) et par la modal de
 * confirmation suppression (panel autonome).
 *
 * Sprint 2026-05-21 / Recap-Reuse-Delete-Confirmation : extraction pour
 * partage entre preview-impact et delete-confirmation.
 */
export function AfterOperationPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-blue-200" />
          <span className="text-xs font-medium tracking-wide text-gray-500 uppercase">
            Après opération
          </span>
          <div className="h-px flex-1 bg-blue-200" />
        </div>
        <div className="space-y-1">{children}</div>
      </div>
    </div>
  )
}
