/**
 * Pure-sync helpers for period date ranges (Sprint P1 — switch hebdo/quotidien).
 *
 * `computePeriodDateRange(period, now?)` returns an inclusive ISO date range
 * { startDate, endDate } in Europe/Paris timezone, or null for 'month' which
 * preserves the actuel "since last recap" semantics (= no DB date filter).
 *
 * Range semantics :
 *   - 'month' → null (no filter)
 *   - 'week'  → ISO 8601 fr-FR : lundi 00:00 → dimanche 23:59 (inclusive)
 *   - 'day'   → today 00:00 → today 23:59 (inclusive)
 *
 * `now` is injectable for deterministic tests. Default `new Date()`.
 *
 * Usable both server-side (filter Supabase SELECT real_expenses.expense_date)
 * and client-side (filter useRealExpenses CSR via useMemo).
 */

export type Period = 'month' | 'week' | 'day'

export interface DateRange {
  /** ISO YYYY-MM-DD inclusive */
  startDate: string
  /** ISO YYYY-MM-DD inclusive */
  endDate: string
}

/**
 * Returns today's date in Europe/Paris timezone as 'YYYY-MM-DD'.
 * Uses Intl.DateTimeFormat with `en-CA` locale which formats as ISO.
 */
function todayInParisIso(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function computePeriodDateRange(period: Period, now: Date = new Date()): DateRange | null {
  if (period === 'month') return null

  const todayIso = todayInParisIso(now)
  if (period === 'day') {
    return { startDate: todayIso, endDate: todayIso }
  }

  // 'week' — compute Monday-Sunday range of the week containing today.
  // Parse the YYYY-MM-DD as UTC noon to avoid DST edge cases when adding days.
  const parts = todayIso.split('-').map(Number)
  const year = parts[0]!
  const month = parts[1]!
  const day = parts[2]!
  const todayUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const dayOfWeek = todayUtc.getUTCDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1

  const monday = new Date(todayUtc)
  monday.setUTCDate(todayUtc.getUTCDate() - daysSinceMonday)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  return {
    startDate: monday.toISOString().slice(0, 10),
    endDate: sunday.toISOString().slice(0, 10),
  }
}
