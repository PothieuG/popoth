/**
 * Monthly Recap V3 — période recapée.
 *
 * Le récap ouvert "maintenant" revoit le mois qui vient de se terminer, pas
 * le mois en cours (cf. `WelcomeStep.tsx` : "récap mensuel du mois écoulé").
 * Fonction pure — seul point de calcul du mois recapé, consommée par
 * `check-status.ts`, `start/route.ts` et `active-recap.ts` pour que les 3
 * s'accordent systématiquement sur la même ligne `monthly_recaps`.
 */
export function getRecapPeriod(now: Date = new Date()): { month: number; year: number } {
  const currentMonth = now.getMonth() + 1 // 1..12
  const currentYear = now.getFullYear()
  return currentMonth === 1
    ? { month: 12, year: currentYear - 1 }
    : { month: currentMonth - 1, year: currentYear }
}
