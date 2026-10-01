/**
 * « Réception du salaire » — règles partagées par le dialogue d'ajout, la liste
 * des revenus et le récap (Sprint Salary-Reception 2026-10-02).
 *
 * Pur, sans I/O : importable côté navigateur comme côté serveur. Le serveur
 * (`lib/api/finance/income-receive-salary.ts`) applique les mêmes règles de son
 * côté — ce module sert à les annoncer AVANT l'envoi.
 *
 * Modèle : une ligne salaire par mois FINANCÉ (`real_income_entries.salary_month`,
 * 1er jour du mois). L'utilisateur choisit ce mois parmi deux : le mois ouvert
 * (celui qu'il est en train de vivre — ou de recaper) et le suivant. Une
 * personne payée le 3 finance le mois en cours ; une personne payée le 28
 * finance le mois suivant. L'appli propose, l'utilisateur tranche.
 */

export interface MonthRef {
  /** 1-12 */
  month: number
  year: number
}

/** Sous-ensemble d'une ligne `real_income_entries` utile à la décision. */
export interface SalaryIncomeLike {
  amount: number
  /** `AAAA-MM-01` — mois financé. `null`/absent = pas une ligne salaire. */
  salary_month?: string | null
  recap_origin_id?: string | null
  applied_to_balance_at?: string | null
}

/**
 * Ce que « Réception du salaire » fera pour un mois donné :
 *   - `available` : aucun salaire enregistré pour ce mois → il sera créé.
 *   - `awaiting` : la ligne « Salaire » créée par le récap attend sa
 *     validation → c'est elle qui sera validée (`expected` = son montant).
 *   - `received` : le salaire de ce mois est déjà enregistré.
 */
export type SalaryMonthStatus =
  | { kind: 'available'; expected: number }
  | { kind: 'awaiting'; expected: number }
  | { kind: 'received'; received: number }

export interface SalaryMonthOption {
  month: MonthRef
  /** `true` = mois ouvert : l'écart entre tout de suite dans le reste à vivre.
   *  `false` = mois suivant : l'écart y entrera à la fin du récap. */
  isOpenMonth: boolean
  status: SalaryMonthStatus
}

export function nextMonth({ month, year }: MonthRef): MonthRef {
  return month === 12 ? { month: 1, year: year + 1 } : { month: month + 1, year }
}

export function sameMonth(a: MonthRef, b: MonthRef): boolean {
  return a.month === b.month && a.year === b.year
}

/** `a` est-il strictement après `b` ? */
export function isLaterMonth(a: MonthRef, b: MonthRef): boolean {
  return a.year > b.year || (a.year === b.year && a.month > b.month)
}

/** `AAAA-MM-01`, format de `real_income_entries.salary_month`. */
export function toSalaryMonth({ month, year }: MonthRef): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

/** Inverse de `toSalaryMonth` ; accepte aussi `AAAA-MM`. `null` si invalide. */
export function parseSalaryMonth(value: string | null | undefined): MonthRef | null {
  const match = /^(\d{4})-(\d{2})(?:-01)?$/.exec(value ?? '')
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return { month, year }
}

/** Ligne salaire du récap pas encore validée. */
export function isSalaryAwaitingValidation(income: SalaryIncomeLike): boolean {
  return income.recap_origin_id != null && income.applied_to_balance_at == null
}

function statusFor(
  incomes: readonly SalaryIncomeLike[],
  month: MonthRef,
  declaredSalary: number,
): SalaryMonthStatus {
  const key = toSalaryMonth(month)
  const line = incomes.find((income) => income.salary_month === key)
  if (!line) return { kind: 'available', expected: declaredSalary }
  if (isSalaryAwaitingValidation(line)) return { kind: 'awaiting', expected: line.amount }
  return { kind: 'received', received: line.amount }
}

/**
 * Les deux mois qu'une paie peut financer : le mois ouvert et le suivant.
 * Tableau vide si le compte n'a pas de salaire déclaré et aucune ligne en
 * attente (rien à réceptionner).
 */
export function salaryMonthOptions(
  incomes: readonly SalaryIncomeLike[],
  declaredSalary: number,
  openMonth: MonthRef,
): SalaryMonthOption[] {
  const options: SalaryMonthOption[] = [
    { month: openMonth, isOpenMonth: true, status: statusFor(incomes, openMonth, declaredSalary) },
    {
      month: nextMonth(openMonth),
      isOpenMonth: false,
      status: statusFor(incomes, nextMonth(openMonth), declaredSalary),
    },
  ]
  if (declaredSalary <= 0 && !options.some((option) => option.status.kind === 'awaiting')) {
    return []
  }
  return options
}

/** Jour du mois jusqu'auquel une paie est présumée financer le mois en cours. */
export const SALARY_CURRENT_MONTH_LAST_DAY = 15

/**
 * Mois proposé par défaut :
 *   1. une ligne « Salaire » attend sa validation → ce mois-là ;
 *   2. sinon, selon le jour de réception : jusqu'au 15 → mois ouvert, après →
 *      mois suivant ;
 *   3. si le mois ainsi choisi est déjà réglé → l'autre.
 * `null` si aucun mois n'est disponible.
 */
export function defaultSalaryMonthOption(
  options: readonly SalaryMonthOption[],
  receptionDay: number,
): SalaryMonthOption | null {
  const selectable = options.filter((option) => option.status.kind !== 'received')
  if (selectable.length === 0) return null

  const awaiting = selectable.find((option) => option.status.kind === 'awaiting')
  if (awaiting) return awaiting

  const wantsOpenMonth = receptionDay <= SALARY_CURRENT_MONTH_LAST_DAY
  return selectable.find((option) => option.isOpenMonth === wantsOpenMonth) ?? selectable[0] ?? null
}

/** Écart reçu − prévu, au centime (absorbe le bruit flottant de la saisie). */
export function salaryDelta(received: number, expected: number): number {
  return Math.round((received - expected) * 100) / 100
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
