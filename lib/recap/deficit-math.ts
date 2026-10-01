/**
 * Monthly Recap V3 — pure helpers for the negative-flow deficit math.
 *
 * Extracted from `actions-negative.ts` (sprint 13) so client components can
 * import them without dragging `supabaseServer` (and the service_role key
 * env read) into the browser bundle. `actions-negative.ts` continues to
 * re-export these symbols verbatim, so existing call sites and tests stay
 * untouched.
 *
 * Three exports, all pure-sync:
 *  - `sumSnapshotValues(snapshot)` : sums the per-budget snapshot amounts
 *     with cents-precise rounding.
 *  - `computeDeficitRemaining(args)` : `|initialBilan| - refloatedFromPiggy
 *     - refloatedFromSavings - sumSnapshotValues(snapshotData)
 *     - sumSnapshotValues(projectSnapshotData)`. Sprint Projets-Épargne 08
 *     (2026-05-26) added the trailing `projectSnapshotData` term (projects
 *     source of the refloat). Returns `0` on a non-negative `initialBilan`
 *     (sprint Deficit-Guard 2026-08-31) — see the function docstring.
 *     Sprint Recap-Manual-Refloat (2026-10-01) added the deferred plan terms
 *     `plannedPiggy` + `sumSnapshotValues(plannedSavingsData)`.
 *  - `coerceSnapshot(raw)` : narrows the JSONB `budget_snapshot_data` blob
 *     (`Json | null | undefined`) into a strict `Record<string, number>`
 *     (or `null`), dropping any unexpected non-number entries.
 */

import type { Json } from '@/lib/database.types'

export function sumSnapshotValues(snapshot: Record<string, number> | null | undefined): number {
  if (!snapshot) return 0
  return round2(Object.values(snapshot).reduce((s, v) => s + Number(v), 0))
}

export interface ComputeDeficitArgs {
  /** `summary.bilan` — negative when the recap is in deficit. A non-negative
   *  value means "no deficit" and short-circuits the computation to `0`. */
  initialBilan: number
  refloatedFromPiggy: number
  refloatedFromSavings: number
  snapshotData: Record<string, number> | null | undefined
  /** Sprint Projets-Épargne 08 (2026-05-26). Optional — defaults to undefined
   *  (treated as empty). Subtracts the per-project refund chosen in the
   *  « Gestion du déficit » screen (`save-refloat-plan`, source `projects`).
   *  Applied at finalize via `apply_recap_projects_snapshot`. */
  projectSnapshotData?: Record<string, number> | null | undefined
  /** Sprint Recap-Manual-Refloat (2026-10-01). Montant choisi pour la
   *  tirelire (`monthly_recaps.planned_piggy_refloat`). Différé : débité au
   *  finalize. Défaut 0. Coexiste avec `refloatedFromPiggy`, qui reste le
   *  montant DÉJÀ débité par l'ancienne cascade (récaps ouverts avant ce
   *  sprint). */
  plannedPiggy?: number | null | undefined
  /** Sprint Recap-Manual-Refloat (2026-10-01). `{ [budgetId]: amount }` à
   *  retirer des économies (`monthly_recaps.planned_savings_refloat`).
   *  Différé : débité au finalize. La part « budget du mois suivant » du même
   *  choix vit dans `snapshotData`. */
  plannedSavingsData?: Record<string, number> | null | undefined
}

/**
 * Reste à renflouer une fois déduites toutes les sources du renflouement
 * (plan manuel + ce que l'ancienne cascade avait déjà débité).
 *
 * Sprint Deficit-Guard 2026-08-31 — court-circuite à `0` quand
 * `initialBilan >= 0`. Le `Math.abs` ci-dessous n'a de sens QUE sur un bilan
 * négatif : sur un bilan positif il fabriquait un "déficit" positif fictif
 * (bilan 50 → 50 à renflouer), et la fonction reportait la responsabilité sur
 * l'appelant. Aucun appelant n'était fautif — les 4 helpers d'
 * `actions-negative.ts` gardent tous un `bilanSign !== 'negative'` → 409, et
 * `BilanNegativeStep` n'est rendu que sur `bilanSign === 'negative'` — mais
 * c'était un piège armé pour le prochain. Les gardes appelantes sont
 * CONSERVÉES (défense en profondeur) : elles répondent 409 `no_deficit` avec
 * le bon statut HTTP, ce que ce `0` ne fait pas.
 */
export function computeDeficitRemaining(args: ComputeDeficitArgs): number {
  if (args.initialBilan >= 0) return 0
  return round2(
    Math.abs(args.initialBilan) -
      args.refloatedFromPiggy -
      args.refloatedFromSavings -
      sumSnapshotValues(args.snapshotData) -
      sumSnapshotValues(args.projectSnapshotData) -
      (args.plannedPiggy ?? 0) -
      sumSnapshotValues(args.plannedSavingsData),
  )
}

export function coerceSnapshot(raw: Json | null | undefined): Record<string, number> | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number') out[k] = v
  }
  return out
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
