/**
 * Format un montant en euros en français avec 2 décimales (centimes-precise).
 *
 * Utilisé par les composants Monthly Recap V3 (sprint 11+) où la précision au
 * centime est requise (un bilan à -0,42 € doit être visible, pas arrondi à 0).
 *
 * NOTE : `lib/contribution-calculator.ts::formatCurrency` existe aussi (0
 * décimales) pour les autres surfaces produit (dashboard, contribution). Les
 * deux helpers cohabitent volontairement — n'unifie pas sans peser les
 * consumers.
 */
const EURO_FORMATTER = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatEuro(amount: number): string {
  if (!Number.isFinite(amount)) return EURO_FORMATTER.format(0)
  return EURO_FORMATTER.format(amount)
}
