/**
 * Pure presentational helpers for `savings_projects` rows.
 *
 * Sprint Projets-Épargne 03 — extrait sous-module séparé pour les helpers
 * sans I/O (pas de Supabase, pas de logger) consommés à la fois par
 * `lib/finance/financial-data.ts` (orchestrateur) et par les futurs forms
 * du sprint 05 (modal create/edit qui suggère une deadline à partir d'une
 * durée mois utilisateur).
 *
 * Note : `lib/schemas/projects.ts` contient déjà `monthsUntilDeadline(today:
 * Date, deadline: Date)` consommé par le refine 2 de `makeProjectClientSchema`.
 * Les deux signatures coexistent : `monthsUntilDeadline` prend 2 `Date` (form
 * client), `monthsBetween` prend `(Date, string)` (orchestrateur lit la
 * colonne `date` ISO). Pas de duplication sémantique — même règle floor des
 * mois calendaires, formats d'entrée différents.
 */

import type { Database } from '@/lib/database.types'

import type { SavingsProjectMeta } from './types'

export type SavingsProjectRow = Database['public']['Tables']['savings_projects']['Row']

/**
 * Mois calendaires entiers entre `from` (date courante, locale) et `to`
 * (ISO `YYYY-MM-DD`). Floor : un demi-mois résiduel ne peut pas accueillir
 * une allocation mensuelle créditée 1× par recap calendaire (sémantique
 * miroir `apply_recap_projects_snapshot`). Retourne `0` si la deadline est
 * passée ou que `to` n'est pas une date valide.
 */
export function monthsBetween(from: Date, to: string): number {
  const toDate = new Date(`${to}T00:00:00Z`)
  if (Number.isNaN(toDate.getTime())) return 0
  const fromUtc = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))
  const yearDiff = toDate.getUTCFullYear() - fromUtc.getUTCFullYear()
  const monthDiff = toDate.getUTCMonth() - fromUtc.getUTCMonth()
  const dayDiff = toDate.getUTCDate() - fromUtc.getUTCDate()
  let months = yearDiff * 12 + monthDiff
  if (dayDiff < 0) months -= 1
  return Math.max(0, months)
}

/**
 * Build le subset présentationnel d'une row `savings_projects`. `today` est
 * injectable pour les tests (sinon `new Date()`). `monthsRemaining` est
 * dérivé via `monthsBetween` au moment du fetch — non-persisted, donc à
 * jour à chaque recompute du dashboard.
 */
export function buildSavingsProjectMeta(
  row: Pick<
    SavingsProjectRow,
    | 'id'
    | 'name'
    | 'monthly_allocation'
    | 'amount_saved'
    | 'target_amount'
    | 'deadline_date'
    | 'pending_delay_fraction'
  >,
  today: Date = new Date(),
): SavingsProjectMeta {
  return {
    id: row.id,
    name: row.name,
    monthlyAllocation: row.monthly_allocation,
    amountSaved: row.amount_saved,
    targetAmount: row.target_amount,
    deadlineDate: row.deadline_date,
    monthsRemaining: monthsBetween(today, row.deadline_date),
    pendingDelayFraction: row.pending_delay_fraction,
  }
}

/**
 * ISO `YYYY-MM-DD` de la deadline située `durationMonths` mois après `from`.
 * Utilisé par la modal create/edit du sprint 05 pour pré-remplir le champ
 * `deadlineDate` à partir d'une durée saisie par l'utilisateur. Clamp
 * end-of-month pour éviter l'overflow JS (Jan 31 + 1 mois ne wrap pas à
 * Mar 3, mais reste à Feb 28).
 */
export function computeDeadlineFromDuration(
  durationMonths: number,
  from: Date = new Date(),
): string {
  const baseYear = from.getUTCFullYear()
  const baseMonth = from.getUTCMonth()
  const baseDay = from.getUTCDate()
  const targetMonthIndex = baseMonth + durationMonths
  // Last day of the target month: day-0 of (month+1) — JS Date normalizes
  // negative or overflowing day values, so this works across years.
  const lastDayOfTargetMonth = new Date(Date.UTC(baseYear, targetMonthIndex + 1, 0)).getUTCDate()
  const clampedDay = Math.min(baseDay, lastDayOfTargetMonth)
  const result = new Date(Date.UTC(baseYear, targetMonthIndex, clampedDay))
  return result.toISOString().split('T')[0]!
}

/**
 * Format ISO `YYYY-MM-DD` → `JJ/MM/AAAA` (fr-FR). Parse explicite UTC pour
 * éviter le drift de timezone JS (un `new Date('2027-12-31')` est interprété
 * UTC, mais affiché en local — selon la zone du browser, le 31 décembre
 * peut s'afficher 30 décembre). On retombe sur la string brute si le parse
 * échoue (jamais en prod, mais protège les tests qui passeraient un
 * format inattendu).
 */
export function formatDeadline(deadline: string): string {
  const date = new Date(`${deadline}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return deadline
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const year = date.getUTCFullYear()
  return `${day}/${month}/${year}`
}

/**
 * Phrase courte "N mois restants" / "1 mois restant" / "Échéance dépassée"
 * pour l'UI ProjectListItem. Le `0 mois restants` est mappé sur "Échéance
 * dépassée" : sémantiquement la deadline est passée OU dans le mois courant,
 * donc plus de mensualité prévue (le trigger d'apply_recap_projects_snapshot
 * ne créditera plus rien).
 */
export function formatMonthsRemaining(monthsRemaining: number): string {
  if (monthsRemaining <= 0) return 'Échéance dépassée'
  if (monthsRemaining === 1) return '1 mois restant'
  return `${monthsRemaining} mois restants`
}
