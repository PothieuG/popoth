import { QueryClient } from '@tanstack/react-query'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
}

/**
 * Invalidate the 11 cross-domain financial-refresh keys.
 *
 * Returns a Promise that resolves once the active refetches settle — a caller
 * that needs to await the refresh (e.g. pull-to-refresh spinner timing) can
 * `await invalidateFinancialRefreshes(qc)`. Existing fire-and-forget callers
 * (mutation `onSuccess`) simply ignore the returned promise.
 *
 * Replaces the legacy bridge `triggerFinancialRefresh()` removed in Sprint 2.
 * Call from a CRUD mutation's `onSuccess` so the dashboard summary, progress
 * views, budgets list, group contributions, savings drawer, real-expenses,
 * AND bank-balance all refetch.
 *
 * `group-contributions` was added by Sprint Group-Budget-Auto-Sync (2026-05-19)
 * so that creating/updating/deleting an estimated_budget cascades to the
 * contribution UI without manual plumbing in each mutation.
 *
 * `savings-data` was added by Sprint Delete-Budget-Savings-Transfer (2026-05-20)
 * — the SavingsDistributionDrawer has its own queryKey separate from
 * `financial-summary` and was stale after a budget delete that moved
 * cumulated_savings to the piggy bank.
 *
 * `real-expenses` + `bank-balance` were added by Feature Contribution-au-groupe
 * (2026-05-28) — un changement de budget groupe cascade via le trigger DB
 * `sync_contribution_real_expense` vers la row real_expenses contribution du
 * dashboard perso (montant updated, potentiellement auto-devalidate qui
 * crédite le solde back). Sans ces 2 keys, le user devait refresh la vue
 * perso manuellement pour voir la nouvelle valeur.
 *
 * `salary-editability` was added by Sprint Salary-Edit-Gating (2026-05-25)
 * — l'édition du salaire dans Settings est conditionnée à un planificateur
 * vierge. Toute mutation sur les 4 tables planificateur (budgets/incomes
 * estimés ou réels) doit refetch la décision serveur pour relâcher (ou
 * resserrer) le verrou côté UI sans refresh manuel.
 *
 * `projects` was added by Sprint Projets-Épargne 02 (Backend-Wiring) — un
 * project consomme une allocation mensuelle qui rejoindra la formule RAV
 * au sprint 03. Toute mutation sur budgets/income doit refetch la liste
 * des projets pour que les UI affichant la marge disponible (sprint 04+)
 * voient instantanément l'effet d'un nouveau budget sur la capacité à
 * créer un nouveau projet.
 *
 * `group-members-rav` was added by Sprint Perf-Group-Members-Rav-Lazy
 * (2026-09-10) — le RAV par membre a quitté `financial-summary` pour sa propre
 * route paresseuse. Sans cette key, une mutation sur un budget groupe (qui
 * recalcule les contributions, donc le RAV perso de chaque membre) laissait
 * l'encart « RAV actuel → projeté » des modals sur des chiffres périmés.
 *
 * `real-incomes` was added by Sprint Contribution-Income-Mirror + Salary-Auto
 * (2026-06-05) — le revenu miroir contribution côté groupe + le revenu salaire
 * auto-créé à la finalisation du recap. Toute mutation sur budgets groupe
 * (cascade trigger sync_contribution_real_income) ET la validation du salaire
 * via la modal doivent invalider la liste des revenus pour refresh la vue
 * dashboard sans refresh manuel.
 */
export function invalidateFinancialRefreshes(qc: QueryClient): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['financial-summary'] }),
    qc.invalidateQueries({ queryKey: ['progress-data'] }),
    qc.invalidateQueries({ queryKey: ['budgets'] }),
    qc.invalidateQueries({ queryKey: ['group-contributions'] }),
    qc.invalidateQueries({ queryKey: ['group-members-rav'] }),
    qc.invalidateQueries({ queryKey: ['savings-data'] }),
    qc.invalidateQueries({ queryKey: ['real-expenses'] }),
    qc.invalidateQueries({ queryKey: ['real-incomes'] }),
    qc.invalidateQueries({ queryKey: ['bank-balance'] }),
    qc.invalidateQueries({ queryKey: ['salary-editability'] }),
    qc.invalidateQueries({ queryKey: ['projects'] }),
  ]).then(() => {})
}

// ─── Toggle « appliqué au solde » — rafraîchissement ciblé ─────────────────
//
// Sprint Perf-Toggle-Targeted-Refresh (2026-09-10). Un long-press ne change
// que `bank_balances.balance` et le flag de la ligne (déjà posé en optimiste
// par le hook). Ni le RAV, ni les budgets, ni la progression, ni les
// contributions, ni le verrou salaire n'en dépendent — vérifié sur
// `_loadFinancialData`, `budgets-estimated`, `expenses-progress`,
// `planner-emptiness` : aucun ne lit `applied_to_balance_at`.
//
// Appeler `invalidateFinancialRefreshes` après un toggle relançait donc les
// 11 keys pour rien : ~12 appels d'API et ~35 requêtes en parallèle, dont le
// refetch de la liste elle-même — qui la remplaçait par un skeleton le temps
// que tout revienne. C'était le « c'est long quand je valide une dépense ».
//
// La RPC renvoie le nouveau solde : c'est exactement ce que `useBankBalance`
// et `FinancialData.availableBalance` (= `bank_balances.balance`, pur depuis
// Sprint Long-Press) afficheraient après refetch. On l'écrit directement.

export type FinancialContext = 'profile' | 'group'

/** Shape minimale du cache `['bank-balance', ctx]` (cf. useBankBalance). */
interface BankBalanceCache {
  balance: number
  graceful_default?: boolean
}

/** Shape minimale du cache `['financial-summary', ctx]` (cf. useFinancialData). */
interface FinancialSummaryCache {
  data: { availableBalance: number }
}

/** Champs d'une ligne de liste (dépense ou revenu) touchés par un toggle. */
interface AppliedRowCache {
  id: string
  amount: number
  applied_to_balance_at?: string | null
  last_applied_amount?: number | null
}

/**
 * Résultat de la RPC `toggle_contribution_pair_applied`, tel que renvoyé par
 * les routes `toggle-applied` sous `data.pair` quand la ligne est un miroir de
 * contribution (dépense perso ↔ revenu groupe).
 */
export interface ContributionPairToggle {
  expenseId: string
  incomeId: string
  expenseChanged: boolean
  incomeChanged: boolean
  /** `null` quand ce côté était déjà dans l'état cible (pas de mouvement). */
  expenseBalance: number | null
  incomeBalance: number | null
  applied: boolean
}

/**
 * Écrit le solde renvoyé par un toggle dans les deux caches qui l'affichent
 * (ligne de solde du drawer + carte « Solde disponible ») — sans refetch.
 */
export function applyBankBalanceToCache(
  qc: QueryClient,
  context: FinancialContext,
  balance: number,
): void {
  qc.setQueryData<BankBalanceCache>(['bank-balance', context], (prev) => ({ ...prev, balance }))
  // Pas d'entrée en cache → rien à patcher : on ne fabrique pas un résumé
  // partiel, le prochain montage le chargera entier.
  qc.setQueryData<FinancialSummaryCache>(['financial-summary', context], (prev) =>
    prev ? { ...prev, data: { ...prev.data, availableBalance: balance } } : prev,
  )
}

/**
 * Répercute un toggle de paire contribution sur les DEUX contextes : la
 * dépense miroir vit dans `['real-expenses', 'profile']`, le revenu miroir
 * dans `['real-incomes', 'group']`, et chaque côté a son propre solde.
 *
 * `last_applied_amount` suit la RPC : `= amount` à l'apply, `NULL` à l'un-apply.
 * Sans ce champ, l'encart « contribution à re-valider » (drift) resterait
 * affiché jusqu'au prochain refetch — c'est lui, pas le flag, qui pilote le
 * warning de `TransactionListItem`.
 */
export function applyContributionPairToCache(
  qc: QueryClient,
  pair: ContributionPairToggle,
  appliedAt: string | null,
): void {
  const patchRow = <T extends AppliedRowCache>(rows: T[] | undefined, id: string) =>
    rows?.map((row) =>
      row.id === id
        ? {
            ...row,
            applied_to_balance_at: appliedAt,
            last_applied_amount: pair.applied ? row.amount : null,
          }
        : row,
    )
  qc.setQueryData<AppliedRowCache[]>(['real-expenses', 'profile'], (prev) =>
    patchRow(prev, pair.expenseId),
  )
  qc.setQueryData<AppliedRowCache[]>(['real-incomes', 'group'], (prev) =>
    patchRow(prev, pair.incomeId),
  )
  if (pair.expenseBalance != null) applyBankBalanceToCache(qc, 'profile', pair.expenseBalance)
  if (pair.incomeBalance != null) applyBankBalanceToCache(qc, 'group', pair.incomeBalance)
}

/**
 * Convergence quand le toggle n'a PAS renvoyé de solde (409 « déjà dans
 * l'état cible », erreur réseau) : les 2 keys qui affichent le solde, pas 11.
 */
export function invalidateBalanceViews(qc: QueryClient, context: FinancialContext): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['bank-balance', context] }),
    qc.invalidateQueries({ queryKey: ['financial-summary', context] }),
  ]).then(() => {})
}
