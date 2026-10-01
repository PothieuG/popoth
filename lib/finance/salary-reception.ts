/**
 * « Réception du salaire » — règles partagées par le dialogue d'ajout, la liste
 * des revenus et le récap (Sprint Salary-Reception 2026-10-02).
 *
 * Pur, sans I/O : importable côté navigateur comme côté serveur. Le serveur
 * (`lib/api/finance/income-receive-salary.ts`) applique la même décision de
 * son côté — ce module sert à l'annoncer AVANT l'envoi.
 */

/** Sous-ensemble d'une ligne `real_income_entries` utile à la décision. */
export interface SalaryIncomeLike {
  amount: number
  recap_origin_id?: string | null
  applied_to_balance_at?: string | null
  salary_reception?: boolean | null
}

/**
 * Ce que l'option « Réception du salaire » fera pour ce compte :
 *   - `unavailable` : pas de salaire déclaré, rien à réceptionner.
 *   - `current` : une ligne « Salaire » du mois attend sa validation — la paie
 *     reçue est celle du mois en cours, l'écart entre tout de suite dans le
 *     reste à vivre.
 *   - `advance` : le salaire du mois est réglé — la paie reçue finance le mois
 *     suivant ; l'écart entrera dans le reste à vivre de ce mois-là.
 *   - `already-received` : la paie du mois suivant est déjà enregistrée.
 */
export type SalaryReceptionState =
  | { kind: 'unavailable' }
  | { kind: 'current'; expected: number }
  | { kind: 'advance'; expected: number }
  | { kind: 'already-received'; received: number }

export function isPendingSalaryReception(income: SalaryIncomeLike): boolean {
  return income.salary_reception === true
}

/** Ligne salaire automatique (fin de récap) pas encore validée. */
export function isSalaryAwaitingValidation(income: SalaryIncomeLike): boolean {
  return income.recap_origin_id != null && income.applied_to_balance_at == null
}

export function resolveSalaryReceptionState(
  incomes: readonly SalaryIncomeLike[],
  declaredSalary: number,
): SalaryReceptionState {
  const awaiting = incomes.find(isSalaryAwaitingValidation)
  if (awaiting) return { kind: 'current', expected: awaiting.amount }

  const reception = incomes.find(isPendingSalaryReception)
  if (reception) return { kind: 'already-received', received: reception.amount }

  if (declaredSalary > 0) return { kind: 'advance', expected: declaredSalary }
  return { kind: 'unavailable' }
}

/** Écart reçu − prévu, au centime (absorbe le bruit flottant de la saisie). */
export function salaryDelta(received: number, expected: number): number {
  return Math.round((received - expected) * 100) / 100
}

export interface MonthRef {
  /** 1-12 */
  month: number
  year: number
}

export function nextMonth({ month, year }: MonthRef): MonthRef {
  return month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year }
}

/** « octobre », « janvier »… (minuscule, comme dans une phrase). */
export function monthName({ month, year }: MonthRef): string {
  return new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(
    new Date(Date.UTC(year, month - 1, 15)),
  )
}

/** « d'octobre », « de novembre » — élision devant voyelle (avril, août, octobre). */
export function ofMonth(ref: MonthRef): string {
  const name = monthName(ref)
  return /^[aeiouyéèêàâîôû]/i.test(name) ? `d'${name}` : `de ${name}`
}
