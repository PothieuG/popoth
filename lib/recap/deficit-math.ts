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
 *     (2026-05-26) added the trailing `projectSnapshotData` term — the
 *     refloat-from-projects step inserted between savings and the final
 *     budget snapshot. Returns `0` on a non-negative `initialBilan`
 *     (sprint Deficit-Guard 2026-08-31) — see the function docstring.
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
   *  (treated as empty). Subtracts the per-project virtual refund recorded
   *  by /api/monthly-recap/refloat-from-projects from `deficitRemaining`.
   *  Sprint 09 cascade UI will surface the resulting deficit; sprint 10
   *  finalize will materialise the snapshot via `apply_recap_projects_snapshot`. */
  projectSnapshotData?: Record<string, number> | null | undefined
}

/**
 * Reste à renflouer après les étapes déjà consommées de la cascade négative.
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
      sumSnapshotValues(args.projectSnapshotData),
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
