/**
 * Monthly Recap — lecture du blob `monthly_recaps.recovery_data`.
 *
 * Sprint Abandoned-Recap-Recovery (2026-09-01).
 *
 * Contexte : un bilan mensuel démarré, dans lequel l'utilisateur a réellement
 * puisé (tirelire et/ou économies) pour éponger un déficit, puis jamais
 * terminé, devient invisible au franchissement du 1er du mois — toutes les
 * lectures serveur filtrent sur l'égalité stricte `(recap_month, recap_year)
 * = getRecapPeriod()`. L'argent était donc sorti sans contrepartie.
 *
 * Depuis la migration `20260901000001`, `start_monthly_recap` balaye ces
 * bilans : elle recrédite `refloated_from_piggy + refloated_from_savings` sur
 * la tirelire, marque les lignes `abandoned_at`, et écrit sur la NOUVELLE
 * ligne un `recovery_data` de la forme
 *
 *   { "total": 150, "periods": [{ "month": 6, "year": 2026, "amount": 150 }] }
 *
 * Ce module narrow ce blob `Json` en une forme stricte pour l'UI. Pur-sync,
 * zéro I/O — il est importé par un composant client (`RecoveredFundsBanner`),
 * il ne doit donc jamais tirer `supabaseServer` dans le bundle navigateur.
 * Même intention et même forme que `coerceSnapshot` (`deficit-math.ts`).
 *
 * ⚠️ Vocabulaire : « orphelin » désigne déjà autre chose dans ce repo (une
 * ligne de la BONNE période dont `started_by_profile_id IS NULL`, cf.
 * `check-status.ts`). Le cas traité ici se dit « abandonné » / `abandoned`.
 */

import type { Json } from '@/lib/database.types'

/** Une période dont les prélèvements ont été rendus à la tirelire. */
export interface RecapRecoveryPeriod {
  /** Mois recapé, 1..12. */
  month: number
  year: number
  /** `refloated_from_piggy + refloated_from_savings` de cette période. */
  amount: number
}

export interface RecapRecoveryData {
  /** Somme rendue à la tirelire, tous bilans abandonnés confondus. */
  total: number
  /**
   * Périodes concernées, triées du plus ancien au plus récent. Ne contient
   * QUE les périodes qui ont réellement coûté de l'argent — la RPC applique
   * un `FILTER (WHERE ... > 0)`. Un bilan abandonné avant l'étape de
   * renflouement est bien archivé, mais n'a rien à annoncer (décision produit
   * 2026-09-01 : archivage silencieux à 0 €).
   */
  periods: RecapRecoveryPeriod[]
}

/**
 * Narrow le blob JSONB en `RecapRecoveryData`, ou `null` quand il n'y a rien
 * à annoncer — c'est-à-dire dans TOUS les cas suivants : colonne absente,
 * `{}` (aucun balayage), `total` non strictement positif (bilans abandonnés
 * mais à 0 €), ou forme inattendue. Les consommateurs n'ont donc qu'un seul
 * test à faire : `!== null` ⇒ il y a un bandeau à afficher.
 *
 * Les entrées de `periods` mal formées sont écartées une à une plutôt que de
 * faire échouer l'ensemble : le montant total reste juste, ce qui compte
 * davantage pour l'utilisateur que la liste des mois.
 */
export function parseRecoveryData(raw: Json | null | undefined): RecapRecoveryData | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null

  const record: Record<string, Json | undefined> = raw
  const total = record.total
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null

  const rawPeriods = record.periods
  const periods: RecapRecoveryPeriod[] = []
  if (Array.isArray(rawPeriods)) {
    for (const entry of rawPeriods) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const { month, year, amount } = entry as Record<string, Json | undefined>
      if (typeof month !== 'number' || month < 1 || month > 12) continue
      if (typeof year !== 'number' || !Number.isFinite(year)) continue
      if (typeof amount !== 'number' || !Number.isFinite(amount)) continue
      periods.push({ month, year, amount })
    }
  }

  return { total, periods }
}
