/**
 * Transfert d'économies (Part 50 — 2026-10-03). 3e type du dialogue d'ajout,
 * à côté de « Dépense » et « Revenu » : de l'argent passe du compte courant à
 * l'épargne réelle (livret…) ou en revient.
 *
 * Seul le solde disponible (`bank_balances.balance`) bouge : envoi = −montant,
 * réception = +montant. Rien d'autre — aucune ligne de transaction, ni reste à
 * vivre, ni économies des budgets, ni tirelire, ni récap. Le montant est
 * plafonné au total des économies (budgets + tirelire), le chiffre de la carte
 * « Économies » du dashboard.
 *
 * Module pur, sans accès base : importé par le dialogue ET par la route.
 */

export const SAVINGS_TRANSFER_DIRECTIONS = ['send', 'receive'] as const

export type SavingsTransferDirection = (typeof SAVINGS_TRANSFER_DIRECTIONS)[number]

/** Variation du solde disponible : envoi = −montant, réception = +montant. */
export function savingsTransferDelta(direction: SavingsTransferDirection, amount: number): number {
  return direction === 'send' ? -amount : amount
}

/** Plafond : jamais plus que le total des économies, jamais négatif. */
export function savingsTransferMax(totalSavings: number): number {
  return Math.max(0, totalSavings)
}

/**
 * `true` si le montant dépasse le plafond. Comparaison au centime : les
 * économies sont des sommes de décimaux (0,1 + 0,2 ≠ 0,3 en flottant), une
 * tolérance fixe laisserait passer un centime de trop.
 */
export function exceedsSavingsTransferMax(amount: number, totalSavings: number): boolean {
  return Math.round(amount * 100) > Math.round(savingsTransferMax(totalSavings) * 100)
}
