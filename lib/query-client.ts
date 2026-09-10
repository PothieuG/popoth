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
