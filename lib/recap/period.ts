import { now as clockNow } from '@/lib/clock'

/**
 * Monthly Recap V3 — période recapée.
 *
 * Le récap ouvert "maintenant" revoit le mois qui vient de se terminer, pas
 * le mois en cours (cf. `WelcomeStep.tsx` : "récap mensuel du mois écoulé").
 * Fonction pure — seul point de calcul du mois recapé, consommée par
 * `check-status.ts`, `start/route.ts` et `active-recap.ts` pour que les 3
 * s'accordent systématiquement sur la même ligne `monthly_recaps`.
 *
 * Défaut = horloge de l'appli (`lib/clock`) : en dev local, une date simulée
 * permet de faire tomber le récap sur le mois voulu.
 */
export function getRecapPeriod(now: Date = clockNow()): { month: number; year: number } {
  const currentMonth = now.getMonth() + 1 // 1..12
  const currentYear = now.getFullYear()
  return currentMonth === 1
    ? { month: 12, year: currentYear - 1 }
    : { month: currentMonth - 1, year: currentYear }
}
