import { describe, expect, it } from 'vitest'

import {
  buildSavingsProjectMeta,
  computeDeadlineFromDuration,
  formatDeadline,
  formatMonthsRemaining,
  isLastDayOfMonthUtc,
  monthsBetween,
} from '@/lib/finance/projects-meta'

/**
 * Sprint Projets-Épargne 03 — pure helpers, no I/O. Pinned cases :
 *   - monthsBetween : exact, fractional, past, cross-year, clamp fin de mois
 *   - computeDeadlineFromDuration : first-of-month, end-of-month overflow,
 *     cross-year
 *   - buildSavingsProjectMeta : maps snake_case → camelCase + injects today
 */

describe('monthsBetween', () => {
  it('returns the exact integer when day-of-month aligns', () => {
    const from = new Date(2026, 4, 26) // 2026-05-26 local
    expect(monthsBetween(from, '2026-08-26')).toBe(3)
  })

  it('floors when the deadline day is earlier in the month (fractional month)', () => {
    // 3 months minus 16 days → 2 full calendar months (floor)
    const from = new Date(2026, 4, 26)
    expect(monthsBetween(from, '2026-08-10')).toBe(2)
  })

  it('returns 0 when the deadline is in the past', () => {
    const from = new Date(2026, 4, 26)
    expect(monthsBetween(from, '2026-04-15')).toBe(0)
  })

  it('handles cross-year deadlines (year+month combo)', () => {
    const from = new Date(2026, 10, 15) // 2026-11-15
    expect(monthsBetween(from, '2027-04-15')).toBe(5)
  })

  // Sprint Deadline-Month-End-Clamp 2026-08-31 — régression de production.
  // `computeDeadlineFromDuration(6)` depuis le 31 août rabote le jour au
  // 28 février (Feb n'a pas de 31). L'ancien floor `dayDiff < 0` relisait
  // alors 5 mois, et le refine de `makeProjectClientSchema` refusait une
  // échéance que le formulaire venait lui-même de produire.
  it('counts a full month when the deadline was clamped to the last day of a shorter month', () => {
    const from = new Date(2026, 7, 31) // 2026-08-31 local
    expect(computeDeadlineFromDuration(6, new Date(Date.UTC(2026, 7, 31)))).toBe('2027-02-28')
    expect(monthsBetween(from, '2027-02-28')).toBe(6)
  })

  it('still floors when the deadline is early in its month (not a clamp artefact)', () => {
    // 2027-02-27 n'est PAS le dernier jour de février → vrai mois entamé.
    expect(monthsBetween(new Date(2026, 7, 31), '2027-02-27')).toBe(5)
  })
})

describe('isLastDayOfMonthUtc', () => {
  it('is true on the last day of 31-, 30- and 28-day months', () => {
    expect(isLastDayOfMonthUtc(new Date('2027-01-31'))).toBe(true)
    expect(isLastDayOfMonthUtc(new Date('2027-04-30'))).toBe(true)
    expect(isLastDayOfMonthUtc(new Date('2027-02-28'))).toBe(true)
  })

  it('is true on Feb 29 of a leap year and false on Feb 28 of that year', () => {
    expect(isLastDayOfMonthUtc(new Date('2028-02-29'))).toBe(true)
    expect(isLastDayOfMonthUtc(new Date('2028-02-28'))).toBe(false)
  })

  it('is false mid-month', () => {
    expect(isLastDayOfMonthUtc(new Date('2027-03-15'))).toBe(false)
  })
})

describe('computeDeadlineFromDuration', () => {
  it('first-of-month + N months stays first-of-month', () => {
    const from = new Date(Date.UTC(2026, 4, 1)) // 2026-05-01 UTC
    expect(computeDeadlineFromDuration(3, from)).toBe('2026-08-01')
  })

  it('end-of-month is clamped to last day of target month (no overflow to next month)', () => {
    // Jan 31 + 1 month → naive JS would wrap to Mar 3 (Feb 31 overflow).
    // We clamp to Feb 28 (2026 is not a leap year) instead.
    const from = new Date(Date.UTC(2026, 0, 31)) // 2026-01-31 UTC
    expect(computeDeadlineFromDuration(1, from)).toBe('2026-02-28')
  })

  it('cross-year duration carries over years correctly', () => {
    const from = new Date(Date.UTC(2026, 10, 15)) // 2026-11-15 UTC
    expect(computeDeadlineFromDuration(6, from)).toBe('2027-05-15')
  })
})

describe('formatDeadline', () => {
  it('formats ISO YYYY-MM-DD to fr-FR JJ/MM/AAAA', () => {
    expect(formatDeadline('2029-05-01')).toBe('01/05/2029')
  })

  it('zero-pads single-digit day and month', () => {
    expect(formatDeadline('2026-01-07')).toBe('07/01/2026')
  })

  it('falls back to the raw string when parse fails', () => {
    expect(formatDeadline('not-a-date')).toBe('not-a-date')
  })
})

describe('formatMonthsRemaining', () => {
  it('plural for N > 1', () => {
    expect(formatMonthsRemaining(36)).toBe('36 mois restants')
  })

  it('singular for N === 1', () => {
    expect(formatMonthsRemaining(1)).toBe('1 mois restant')
  })

  it('overdue label for 0 or negative', () => {
    expect(formatMonthsRemaining(0)).toBe('Échéance dépassée')
    expect(formatMonthsRemaining(-3)).toBe('Échéance dépassée')
  })
})

describe('buildSavingsProjectMeta', () => {
  it('maps snake_case row → camelCase meta and derives monthsRemaining via injected today', () => {
    const today = new Date(2026, 4, 26) // 2026-05-26 local
    const meta = buildSavingsProjectMeta(
      {
        id: 'proj-1',
        name: 'Trip Japan',
        monthly_allocation: 195,
        amount_saved: 4084,
        target_amount: 7000,
        deadline_date: '2029-05-01',
        pending_delay_fraction: 0,
      },
      today,
    )
    expect(meta).toEqual({
      id: 'proj-1',
      name: 'Trip Japan',
      monthlyAllocation: 195,
      amountSaved: 4084,
      targetAmount: 7000,
      deadlineDate: '2029-05-01',
      monthsRemaining: 35, // 36 months minus the 25-day partial month
      pendingDelayFraction: 0,
    })
  })

  it('forwards pending_delay_fraction verbatim (sprint 10 FinalRecapStep deadline shift preview)', () => {
    const meta = buildSavingsProjectMeta(
      {
        id: 'proj-2',
        name: 'Voiture',
        monthly_allocation: 100,
        amount_saved: 250,
        target_amount: 1000,
        deadline_date: '2027-01-01',
        pending_delay_fraction: 0.75,
      },
      new Date(2026, 4, 26),
    )
    expect(meta.pendingDelayFraction).toBe(0.75)
  })
})
