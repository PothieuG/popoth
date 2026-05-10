/**
 * Bibliothèque de calculs financiers — chantier I4 in progress.
 *
 * Ce fichier est devenu un thin re-export shim au commit #8 du chantier
 * I4. Toute la logique a migré sous lib/finance/. Les 17 importers en
 * production continuent de fonctionner verbatim ; le commit #9 les
 * migrera vers `@/lib/finance` (ou un sous-module précis), et le commit
 * #10 supprimera ce fichier.
 *
 * NE PAS ajouter de nouveau code ici. Pour toute nouvelle fonction
 * finance : créer un module ad-hoc sous `lib/finance/` et l'exposer via
 * le barrel `lib/finance/index.ts`.
 */

export {
  calculateAvailableCash,
  calculateBudgetDeficit,
  calculateBudgetSavings,
  calculateRemainingToLiveGroup,
  calculateRemainingToLiveProfile,
} from './finance/calc-rtl'
export { getBudgetSavingsDetail } from './finance/budget-savings-detail'
export { getGroupFinancialData, getProfileFinancialData } from './finance/financial-data'
export { getRavFromDatabase } from './finance/rav-persistence'
export { saveRemainingToLiveSnapshot } from './finance/snapshots'
export type { BudgetSavings, FinancialData } from './finance/types'
