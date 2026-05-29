/**
 * Classe de couleur Tailwind pour un montant « reste à vivre » (RAV) :
 * vert s'il est positif, rouge s'il est négatif, gris s'il est nul.
 *
 * Source de vérité unique partagée par les encarts récap du planificateur :
 *  - solo : `RavProjectionRecap`
 *  - groupe budget/projet : `GroupMembersRavRecap`
 *  - groupe revenu : la sous-ligne RAV de `GroupMembersContributionsRecap`
 *
 * Aligné sur la sémantique de `getAmountColorClass` du dashboard
 * (`FinancialIndicators` : positif vert, négatif rouge).
 */
export function ravColorClass(amount: number): string {
  if (amount < 0) return 'text-red-600'
  if (amount > 0) return 'text-green-600'
  return 'text-gray-900'
}
