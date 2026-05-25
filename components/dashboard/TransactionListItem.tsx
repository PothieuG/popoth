'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import type { RealExpense, ToggleAppliedOutcome } from '@/hooks/useRealExpenses'
import type { RealIncome } from '@/hooks/useRealIncomes'
import type { ProfileData } from '@/app/api/profile/route'
import { useLongPress } from '@/hooks/useLongPress'
import DropdownMenu from '@/components/ui/DropdownMenu'
import ConfirmationDialog from '@/components/ui/ConfirmationDialog'
import UserAvatar from '@/components/ui/UserAvatar'

const LONG_PRESS_DELAY_MS = 800

/**
 * Sprint Group-Transaction-Creator-Avatar (2026-05-22) : pour le contexte
 * groupe, l'avatar de chaque ligne reflète le créateur réel de la transaction
 * (via `transaction.created_by` injecté par le JOIN profiles côté API), pas
 * l'utilisateur connecté. On reconstitue un `ProfileData` partiel à partir
 * des 3 champs lus par `<UserAvatar>` (first_name/last_name/avatar_url) +
 * defaults inertes pour le reste de la shape — UserAvatar n'utilise que ces
 * 3 champs. Pour les lignes legacy sans created_by (avant la migration), on
 * retourne `null` → UserAvatar affiche son placeholder natif `??`.
 */
function toCreatorProfile(
  createdBy: NonNullable<RealExpense['created_by'] | RealIncome['created_by']> | null | undefined,
): ProfileData | null {
  if (!createdBy) return null
  return {
    id: createdBy.id,
    first_name: createdBy.first_name ?? '',
    last_name: createdBy.last_name ?? '',
    salary: 0,
    group_id: null,
    group_name: null,
    avatar_url: createdBy.avatar_url,
    created_at: null,
    updated_at: null,
  }
}
import {
  AfterOperationPanel,
  BalanceRow,
  BudgetRecapRow,
  EntityLabel,
} from '@/components/dashboard/recap-rows'

type Transaction = RealExpense | RealIncome

interface TransactionListItemProps {
  transaction: Transaction
  type: 'expense' | 'income'
  onEdit: (transaction: Transaction) => void
  onDelete: (transactionId: string) => Promise<boolean>
  /**
   * Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23). Le parent
   * (TransactionTabsComponent) câble `useRealExpenses().toggleApplied`
   * ou `useRealIncomes().toggleApplied`. Déclenché par long-press 800ms
   * sur la carte OU entrée dédiée du dropdown menu (alternative clavier).
   */
  onToggleApplied: (transactionId: string, apply: boolean) => Promise<ToggleAppliedOutcome>
  /**
   * Sprint 15 Monthly Recap V3 (2026-05-27). Toggle bidirectionnel pour les
   * transactions carry-over (issues du recap du mois précédent). Le parent
   * câble `useRealExpenses().toggleCarryApplied` ou
   * `useRealIncomes().toggleCarryApplied`. Routing client-side : la carte
   * appelle `onToggleCarryApplied` si `transaction.carried_from_recap_id`
   * est non-null (la mémoire persiste même après une première validation),
   * sinon `onToggleApplied` (chemin classique).
   *
   * Optional pour compat avec les tests RTL legacy qui n'exercent pas le
   * chemin carry-over. En prod, TransactionTabsComponent câble toujours la
   * prop ; en absence, un long-press sur carry-over no-op (warn logger).
   */
  onToggleCarryApplied?: (transactionId: string, validate: boolean) => Promise<ToggleAppliedOutcome>
  context?: 'profile' | 'group'
  /**
   * Pour un revenu régulier (estimated_income_id set + !is_exceptional), le
   * parent fournit le cumul des montants réels pour la même source + le
   * montant estimé de la source, afin que la modal de confirmation affiche
   * un delta RAV précis. Null/undefined pour les dépenses et revenus
   * exceptionnels (pas nécessaire dans ces branches).
   */
  incomeSourceContext?: { cumulRealAmount: number; estimatedAmount: number } | null
  /**
   * Reste à vivre courant — sert à afficher le solde post-suppression dans
   * la modal de confirmation. Null/undefined si non disponible (loading).
   */
  currentRemainingToLive?: number | null
  /**
   * Snapshot du budget destination — sert à afficher le solde post-suppression
   * et à calculer la portion RAV recréditée (déficit budgétaire absorbé).
   * Tous les montants sont au moment du décision (incluent cette dépense).
   * Null/undefined pour les revenus, dépenses exceptionnelles, ou budget supprimé.
   */
  budgetSnapshot?: {
    cumulatedSavings: number
    estimatedAmount: number
    spentAmount: number
  } | null
  /**
   * Montant actuel de la tirelire — sert à afficher le solde post-suppression
   * sur la ligne tirelire. Null/undefined si non disponible.
   */
  piggyBankAmount?: number | null
  className?: string
}

/**
 * Component for displaying individual transaction in the list
 * Shows transaction details with edit/delete actions via dropdown menu
 */
export default function TransactionListItem({
  transaction,
  type,
  onEdit,
  onDelete,
  onToggleApplied,
  onToggleCarryApplied,
  context = 'profile',
  incomeSourceContext = null,
  currentRemainingToLive = null,
  budgetSnapshot = null,
  piggyBankAmount = null,
  className,
}: TransactionListItemProps) {
  const creatorProfile = toCreatorProfile(transaction.created_by)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPressing, setIsPressing] = useState(false)
  const [isToggling, setIsToggling] = useState(false)
  const progressBarRef = useRef<HTMLSpanElement | null>(null)

  /**
   * Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23). NULL → bg
   * blanc (non appliquée) ; ISO string → bg rouge léger (dépense) ou vert
   * léger (revenu). Détermine aussi le label dynamique du dropdown.
   */
  const isApplied = transaction.applied_to_balance_at != null

  /**
   * Sprint 15 Monthly Recap V3 (2026-05-27).
   *   - hasCarryOverContext : la transaction a été reportée d'un recap au
   *     moins une fois (la mémoire persiste même après validation, ce qui
   *     permet le retour arrière bidirectionnel cf. spec §5.3).
   *   - isCurrentlyCarried : état courant carry-over (badge visible, non
   *     comptée dans le solde, dropdown adapté).
   */
  const hasCarryOverContext = transaction.carried_from_recap_id != null
  const isCurrentlyCarried = transaction.is_carried_over === true

  /**
   * Feature "Contribution au groupe" (2026-05-28). Row auto-managée par
   * trigger DB (cf. sync_contribution_real_expense). Dérive l'état UI :
   *   - isContributionRow : on rend en mode read-only (catégorie grise,
   *     pas de bouton Modifier/Supprimer).
   *   - needsInitialValidation : jamais validée → warning "première
   *     validation requise".
   *   - hasDrift : validée à un montant différent du courant (le trigger
   *     a réécrit `amount` mais `last_applied_amount` reste figé) →
   *     warning "désynchronisée, revalider".
   *   - driftDelta : new amount - last_applied_amount (positif = augmentation,
   *     négatif = diminution).
   */
  const isContributionRow =
    type === 'expense' && (transaction as RealExpense).contribution_id != null
  const contribLastApplied =
    type === 'expense' ? ((transaction as RealExpense).last_applied_amount ?? null) : null
  const needsInitialValidation = isContributionRow && !isApplied && contribLastApplied == null
  const hasDrift =
    isContributionRow &&
    isApplied &&
    contribLastApplied != null &&
    contribLastApplied !== transaction.amount
  const driftDelta =
    hasDrift && contribLastApplied != null ? transaction.amount - contribLastApplied : 0

  const runToggle = async () => {
    if (isToggling) return
    setIsToggling(true)
    try {
      if (hasCarryOverContext) {
        if (!onToggleCarryApplied) {
          logger.warn(
            '[TransactionListItem] onToggleCarryApplied not wired for carry-over transaction',
            { id: transaction.id },
          )
          return
        }
        // Bidirectional flip: validate=true si actuellement carried, false sinon.
        await onToggleCarryApplied(transaction.id, !isApplied)
      } else {
        await onToggleApplied(transaction.id, !isApplied)
      }
    } finally {
      setIsToggling(false)
    }
  }

  const longPress = useLongPress(runToggle, {
    delayMs: LONG_PRESS_DELAY_MS,
    onStart: () => {
      setIsPressing(true)
      // Feedback haptique 50ms — non bloquant, silently no-op sur desktop /
      // navigateurs sans Vibration API (Safari iOS notamment).
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(50)
      }
    },
    onCancel: () => {
      setIsPressing(false)
    },
  })

  // Anime le progress fill de scaleX(0) → scaleX(1) en LONG_PRESS_DELAY_MS via
  // mutation DOM directe (pas de setState dans l'effet : la barre démarre en
  // scaleX(0) au mount, on bascule à scaleX(1) à la frame suivante pour
  // amorcer la transition CSS). Quand isPressing redevient false, le `<span>`
  // est démonté (conditional render) → pas besoin de reset state.
  useLayoutEffect(() => {
    if (!isPressing) return
    const node = progressBarRef.current
    if (!node) return
    const raf = requestAnimationFrame(() => {
      node.style.transform = 'scaleX(1)'
    })
    const timer = setTimeout(() => setIsPressing(false), LONG_PRESS_DELAY_MS)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [isPressing])

  /**
   * Format amount with euro symbol
   */
  const formatAmount = (amount: number): string => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  /**
   * Format creation date with time for display
   */
  const formatDateWithTime = (dateString: string): string => {
    return new Date(dateString).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  /**
   * Get transaction category name (budget or income name, or "Exceptionnel")
   *
   * Feature "Contribution au groupe" (2026-05-28) — les rows contribution
   * affichent "Contribution groupe" en catégorie (au lieu d'"Exceptionnel"
   * malgré is_exceptional=true côté DB). Le nom du groupe est déjà dans la
   * description, on garde la catégorie courte et générique pour la lisibilité.
   */
  const getCategoryName = (): string => {
    if (isContributionRow) {
      return 'Contribution groupe'
    }

    if (transaction.is_exceptional) {
      return 'Exceptionnel'
    }

    if (type === 'expense') {
      return (transaction as RealExpense).estimated_budget?.name || 'Budget supprimé'
    } else {
      return (transaction as RealIncome).estimated_income?.name || 'Revenu supprimé'
    }
  }

  /**
   * Get color for category text based on transaction type.
   * Sprint 2026-05-22 / Transaction-Line-Color-Refresh : la couleur de la
   * catégorie discrimine la nature de la transaction. Blue-700 pour les
   * transactions normales (budget ou source de revenu). Yellow-700 (gold
   * doux, pas flashy) pour les exceptionnelles — réutilise la teinte
   * "warning text" déjà installée dans le panel "Contribution non calculée"
   * pour rester dans la charte. La description reste en `text-gray-900`
   * comme ancre primaire (lisibilité mobile, hiérarchie visuelle).
   */
  const getCategoryTextColor = (): string => {
    // Feature "Contribution au groupe" (2026-05-28) — gris neutre pour
    // signaler le status read-only / auto-managé, distinct du jaune des
    // exceptionnelles et du bleu des budgetées.
    if (isContributionRow) {
      return 'text-gray-600'
    }
    if (transaction.is_exceptional) {
      return 'text-yellow-700'
    } else {
      return 'text-blue-700'
    }
  }

  /**
   * Handle delete confirmation
   */
  const handleDeleteConfirm = async () => {
    setIsDeleting(true)
    try {
      const success = await onDelete(transaction.id)
      if (success) {
        setIsDeleteModalOpen(false)
      }
    } catch (error) {
      logger.error('Error deleting transaction:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  /**
   * Construit le ReactNode `details` pour la modal de confirmation suppression.
   * Sprint 2026-05-22 / Delete-Header-And-Income-Concise :
   *   - "Après suppression :" header obligatoire au-dessus de chaque branche
   *     (panel ou texte fallback) pour clarifier ce que représente l'encart.
   *   - Income branches : drop le "Revenu lié à 'xxx'" line (concis), color
   *     "Reste à vivre" en blue dans les phrases fallback.
   *
   * 4 branches selon le type de transaction (cf. Sprint Recap-Reuse-Delete-
   * Confirmation 2026-05-21 pour le panel partagé avec ExpenseBreakdownPreview) :
   *   - Budgeted expense : balances post-delete dans `<AfterOperationPanel compact>`.
   *   - Exceptional expense : 1 ligne RAV post-delete dans le panel.
   *   - Regular income (avec contexte cumul) : 1 ligne RAV post-delete si
   *     ravDelta < 0 dans le panel, sinon phrase texte "RAV pas affecté".
   *   - Exceptional income : 1 ligne RAV post-delete dans le panel.
   *
   * Returns undefined quand aucun contexte (`budgetSnapshot` / `currentRav`)
   * n'est dispo pour calculer l'état post-delete.
   */
  const buildDeleteDetails = (): ReactNode | undefined => {
    // Sprint 15 V3 — branche carry-over expense : la suppression renvoie le
    // montant en tirelire (RPC `delete_carried_expense_to_piggy`). On affiche
    // le nouveau montant tirelire post-delete au lieu du panel classique
    // d'allocation reversée.
    if (isCurrentlyCarried && type === 'expense') {
      const expense = transaction as RealExpense
      const newPiggy = piggyBankAmount != null ? piggyBankAmount + expense.amount : null
      if (newPiggy == null) {
        return (
          <div className="space-y-1.5 text-left">
            <p className="text-sm font-medium text-gray-700">Après suppression :</p>
            <p className="text-gray-600">
              Le montant sera renvoyé dans votre{' '}
              <span className="font-medium text-violet-700">tirelire</span>.
            </p>
          </div>
        )
      }
      return (
        <div className="space-y-1.5 text-left">
          <p className="text-sm font-medium text-gray-700">Après suppression :</p>
          <AfterOperationPanel compact>
            <BalanceRow label={<EntityLabel type="piggy" />} amount={newPiggy} />
          </AfterOperationPanel>
        </div>
      )
    }

    const inner = type === 'expense' ? buildExpenseDeleteDetails() : buildIncomeDeleteDetails()
    if (inner == null) return undefined
    return (
      <div className="space-y-1.5 text-left">
        <p className="text-sm font-medium text-gray-700">Après suppression :</p>
        {inner}
      </div>
    )
  }

  const buildExpenseDeleteDetails = (): ReactNode | undefined => {
    const expense = transaction as RealExpense
    const ravBalance = currentRemainingToLive

    if (expense.is_exceptional) {
      if (ravBalance == null) return undefined
      const newRav = ravBalance + expense.amount
      return (
        <AfterOperationPanel compact>
          <BalanceRow label={<EntityLabel type="rav" />} amount={newRav} />
        </AfterOperationPanel>
      )
    }

    const piggyRecovered = expense.amount_from_piggy_bank ?? 0
    const savingsRecovered = expense.amount_from_budget_savings ?? 0
    const fromBudgetTotal = expense.amount_from_budget ?? expense.amount
    const budgetName = expense.estimated_budget?.name

    if (!budgetSnapshot) return undefined

    const { spentAmount, estimatedAmount, cumulatedSavings } = budgetSnapshot
    const newSpent = spentAmount - fromBudgetTotal
    const deficitBefore = Math.max(0, spentAmount - estimatedAmount)
    const deficitAfter = Math.max(0, newSpent - estimatedAmount)
    const ravRecovered = deficitBefore - deficitAfter
    const newSavings = cumulatedSavings + savingsRecovered
    const newPiggy = piggyBankAmount != null ? piggyBankAmount + piggyRecovered : null
    const newRav = ravBalance != null ? ravBalance + ravRecovered : null

    return (
      <AfterOperationPanel compact>
        {piggyRecovered > 0 && newPiggy != null && (
          <BalanceRow label={<EntityLabel type="piggy" />} amount={newPiggy} />
        )}
        {savingsRecovered > 0 && (
          <BalanceRow label={<EntityLabel type="savings" />} amount={newSavings} />
        )}
        {budgetName && (
          <BudgetRecapRow budgetName={budgetName} spent={newSpent} estimated={estimatedAmount} />
        )}
        {ravRecovered !== 0 && newRav != null && (
          <BalanceRow label={<EntityLabel type="rav" />} amount={newRav} />
        )}
      </AfterOperationPanel>
    )
  }

  const buildIncomeDeleteDetails = (): ReactNode | undefined => {
    const income = transaction as RealIncome
    const ravBalance = currentRemainingToLive

    if (income.is_exceptional) {
      if (ravBalance == null) return undefined
      const newRav = ravBalance - income.amount
      return (
        <AfterOperationPanel compact>
          <BalanceRow label={<EntityLabel type="rav" />} amount={newRav} />
        </AfterOperationPanel>
      )
    }

    if (incomeSourceContext) {
      const { cumulRealAmount, estimatedAmount } = incomeSourceContext
      const contribBefore = Math.max(cumulRealAmount, estimatedAmount)
      const contribAfter = Math.max(cumulRealAmount - income.amount, estimatedAmount)
      const ravDelta = contribAfter - contribBefore // ≤ 0
      const newRav = ravBalance != null ? ravBalance + ravDelta : null

      if (ravDelta < 0 && newRav != null) {
        return (
          <AfterOperationPanel compact>
            <BalanceRow label={<EntityLabel type="rav" />} amount={newRav} />
          </AfterOperationPanel>
        )
      }
      return (
        <p className="text-gray-600">
          Votre <span className="font-medium text-blue-600">reste à vivre</span> ne sera pas affecté
          (le revenu estimé tient déjà la base).
        </p>
      )
    }

    return (
      <p>
        Votre <span className="font-medium text-blue-600">reste à vivre</span> sera réajusté en
        conséquence.
      </p>
    )
  }

  /**
   * Get dropdown menu items. Sprint Long-Press-Toggle-Apply-To-Balance
   * (2026-05-23) — ajout d'une 3e entrée « Appliquer/Retirer du solde »
   * (alternative clavier au long-press tactile). Supprimer est `disabled`
   * quand la transaction est appliquée — l'utilisateur doit d'abord la
   * retirer du solde (cf. 409 côté API DELETE).
   *
   * Sprint 15 V3 (2026-05-27) — pour les transactions carry-over
   * (`hasCarryOverContext=true`), labels adaptés :
   *   - Toggle : "Valider et appliquer au solde" (état carried) /
   *              "Dévalider (remettre en attente)" (état was-carried-now-validé).
   *   - Supprimer : "Supprimer (renvoyer en tirelire)" pour les dépenses
   *                 carry-over actuellement carried (auto-détection serveur
   *                 crédite la tirelire). "Supprimer" simple pour les autres
   *                 cas (income carry-over, ou state B avec isApplied
   *                 bloquant la suppression jusqu'à dévalidation).
   *   - Modifier : ABSENT quand `isCurrentlyCarried=true` (règle produit :
   *                une transaction reportée ne peut qu'être validée ou
   *                supprimée, pas modifiée). Une fois validée (state B),
   *                Modifier réapparaît — la transaction est redevenue normale.
   *                Défense en profondeur : PUT real_expenses/real_income_entries
   *                retourne 409 'cannot-edit-carried-transaction' si jamais
   *                la requête arrivait quand même.
   */
  const editItem = {
    label: 'Modifier',
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
      </svg>
    ),
    onClick: () => onEdit(transaction),
  }

  const toggleIcon = (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {isApplied ? (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
      )}
    </svg>
  )

  const deleteIcon = (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  )

  const toggleLabel = hasCarryOverContext
    ? isCurrentlyCarried
      ? 'Valider et appliquer au solde'
      : 'Dévalider (remettre en attente)'
    : isApplied
      ? 'Retirer du solde'
      : 'Appliquer au solde'

  const deleteLabel =
    hasCarryOverContext && isCurrentlyCarried && type === 'expense'
      ? 'Supprimer (renvoyer en tirelire)'
      : 'Supprimer'

  const getDropdownItems = () => [
    // Modifier disparaît du menu pour une transaction actuellement reportée
    // (règle produit). Réapparaît si l'utilisateur la valide d'abord.
    ...(isCurrentlyCarried ? [] : [editItem]),
    {
      label: toggleLabel,
      icon: toggleIcon,
      onClick: () => {
        void runToggle()
      },
      disabled: isToggling,
    },
    {
      label: deleteLabel,
      icon: deleteIcon,
      onClick: () => setIsDeleteModalOpen(true),
      variant: 'danger' as const,
      disabled: isApplied,
    },
  ]

  // Sprint 15 V3 — carry-over visuel : fond gris très clair pour signaler
  // "hors solde, hors calculs" tant que la transaction reste reportée.
  const appliedBgClass = isCurrentlyCarried
    ? 'bg-gray-50'
    : isApplied
      ? type === 'expense'
        ? 'bg-red-50'
        : 'bg-green-50'
      : 'bg-white'

  return (
    <>
      <div
        {...longPress}
        role="button"
        tabIndex={0}
        aria-pressed={isApplied}
        aria-label={
          isCurrentlyCarried
            ? `${type === 'expense' ? 'Dépense' : 'Revenu'} reportée du mois précédent, appuyez longuement pour valider`
            : hasCarryOverContext && isApplied
              ? `${type === 'expense' ? 'Dépense' : 'Revenu'} validée du mois précédent, appuyez longuement pour dévalider`
              : isApplied
                ? `${type === 'expense' ? 'Dépense' : 'Revenu'} appliquée au solde, appuyez longuement pour retirer`
                : `${type === 'expense' ? 'Dépense' : 'Revenu'} non appliquée au solde, appuyez longuement pour appliquer`
        }
        className={cn(
          'relative overflow-hidden rounded-lg border border-gray-200 p-4 shadow-md transition-colors duration-300',
          'hover:border-gray-300 hover:shadow-lg',
          appliedBgClass,
          className,
        )}
        style={longPress.style}
      >
        {/* Progress ring fill — apparaît seulement pendant un long-press
            sustained. width 0 → 100% en 800ms via transform scaleX (évite
            reflow). Couleur cohérente avec le statut cible (vert si on va
            apply un revenu, rouge si on va apply une dépense, gris si on
            unapply). pointer-events-none pour ne pas intercepter le geste. */}
        {isPressing && (
          <span
            ref={progressBarRef}
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute right-0 bottom-0 left-0 h-1 origin-left rounded-b-lg',
              isApplied ? 'bg-gray-400' : type === 'expense' ? 'bg-red-400' : 'bg-green-500',
            )}
            style={{
              transform: 'scaleX(0)',
              transition: `transform ${LONG_PRESS_DELAY_MS}ms linear`,
            }}
          />
        )}
        <div className="flex items-center justify-between">
          {/* Transaction Details */}
          <div className="flex min-w-0 flex-1 items-center space-x-3">
            {/* Avatar of the transaction creator (group context only) */}
            {context === 'group' && (
              <div className="shrink-0">
                <UserAvatar profile={creatorProfile} size="sm" />
              </div>
            )}

            {/* 3-line layout */}
            <div className="min-w-0 flex-1 space-y-0.5">
              {/* Sprint 15 V3 — badge "Mois précédent" pour les transactions
                  carry-over actuellement non-validées. Gris neutre (cf. décision
                  produit) pour ne pas créer de conflit visuel avec les couleurs
                  métier (violet=tirelire, orange=budgets, vert=succès, rouge=déficit). */}
              {isCurrentlyCarried && (
                <div className="flex">
                  <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                    Mois précédent
                  </span>
                </div>
              )}
              {/* Line 1: Amount with breakdown badges */}
              <div className="flex items-baseline space-x-1.5">
                <span
                  className={cn(
                    'text-lg font-bold',
                    type === 'expense' ? 'text-red-600' : 'text-green-600',
                  )}
                >
                  {type === 'expense' ? '-' : '+'}
                  {formatAmount(transaction.amount)}
                </span>

                {/* Breakdown badges for expenses with smart allocation */}
                {type === 'expense' &&
                  (transaction as RealExpense).amount_from_piggy_bank !== undefined && (
                    <div className="flex items-center gap-1">
                      {(transaction as RealExpense).amount_from_piggy_bank! > 0 && (
                        <span className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                          🪙 {formatAmount((transaction as RealExpense).amount_from_piggy_bank!)}
                        </span>
                      )}
                      {(transaction as RealExpense).amount_from_budget_savings! > 0 && (
                        <span className="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                          💰{' '}
                          {formatAmount((transaction as RealExpense).amount_from_budget_savings!)}
                        </span>
                      )}
                    </div>
                  )}
              </div>

              {/* Line 2: Description — Category name (with em-dash separator) */}
              <p className="truncate text-sm">
                <span className="font-semibold text-gray-900">{transaction.description}</span>
                <span className="mx-1.5 text-gray-400">—</span>
                <span className={cn('font-medium', getCategoryTextColor())}>
                  {getCategoryName()}
                </span>
              </p>

              {/* Line 3: Date with time (very small) */}
              <p className="text-xs text-gray-500">{formatDateWithTime(transaction.created_at)}</p>
            </div>
          </div>

          {/* Actions dropdown - Bigger and centered. stopPropagation sur
              pointerdown empêche le long-press de la carte de démarrer quand
              on tape sur les 3 points (sinon hold sur le bouton fait toggle
              du solde au lieu d'ouvrir le menu).

              Feature "Contribution au groupe" (2026-05-28) — kebab masqué
              entièrement pour les rows contribution : pas d'édition ni de
              suppression manuelle possibles (cycle de vie 100% piloté par
              triggers DB). Seule la validation/dévalidation via long-press
              sur la carte reste disponible. */}
          {!isContributionRow && (
            <div
              className="ml-1.5 flex min-h-full shrink-0 items-center"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <DropdownMenu
                items={getDropdownItems()}
                buttonClassName="p-3 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center h-full"
                buttonContent={
                  <svg className="h-6 w-6 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                  </svg>
                }
              />
            </div>
          )}
        </div>

        {/* Feature "Contribution au groupe" (2026-05-28) — bloc warning
            in-card affiché dans 2 cas :
              (1) première validation requise (never applied).
              (2) drift entre amount auto-update et last_applied_amount
                  → le user doit ajouter/retirer le delta du groupe et
                  re-valider.
            Bordure + fond orange légers (charte : orange = "needs attention",
            distinct du red "déficit" et du yellow réservé "exceptionnel").
            Le bloc apparaît dans la carte (pas un toast), au-dessous des
            lignes d'info principales. */}
        {isContributionRow && (needsInitialValidation || hasDrift) && (
          <div
            role="status"
            className="mt-2 flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 px-2.5 py-2 text-xs text-orange-900"
          >
            <svg
              className="mt-px h-4 w-4 shrink-0 text-orange-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <div className="flex-1">
              {needsInitialValidation ? (
                <p>
                  Cette dépense n&apos;a pas encore été validée. Long-press pour valider{' '}
                  <span className="font-semibold">{formatAmount(transaction.amount)}</span>.
                </p>
              ) : (
                <p>
                  Attention, la valeur de la contribution est passée à{' '}
                  <span className="font-semibold">{formatAmount(transaction.amount)}</span>{' '}
                  <span className="font-semibold">
                    (soit {driftDelta >= 0 ? '+' : ''}
                    {formatAmount(driftDelta)})
                  </span>
                  . Veuillez ajouter/retirer ce montant du groupe et re-valider la dépense.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      <ConfirmationDialog
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteConfirm}
        title={`Supprimer ${type === 'expense' ? 'cette dépense' : 'ce revenu'}`}
        message={`Êtes-vous sûr de vouloir supprimer "${transaction.description}" d'un montant de ${formatAmount(transaction.amount)} ? Cette action ne peut pas être annulée.`}
        details={buildDeleteDetails()}
        confirmText="Supprimer"
        loading={isDeleting}
        variant="danger"
      />
    </>
  )
}
