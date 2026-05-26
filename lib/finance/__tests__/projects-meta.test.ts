import { describe, expect, it } from 'vitest'

import {
  buildSavingsProjectMeta,
  computeDeadlineFromDuration,
  monthsBetween,
} from '@/lib/finance/projects-meta'

/**
 * Sprint Projets-Épargne 03 — pure helpers, no I/O. Pinned cases :
 *   - monthsBetween : exact, fractional, past, cross-year
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
    })
  })
})
