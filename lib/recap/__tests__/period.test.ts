/**
 * Pure-helper tests for `lib/recap/period.ts`.
 *
 * `getRecapPeriod` is the single source of truth for "which month does the
 * recap opened right now review" — always the previous calendar month
 * relative to `now`. Regression-guards the December → January rollover.
 */

import { describe, expect, it } from 'vitest'

import { getRecapPeriod } from '@/lib/recap/period'

describe('getRecapPeriod', () => {
  // Local-time `Date` constructor (year, month0Indexed, day, ...) throughout —
  // `getRecapPeriod` reads `now.getMonth()` which is local-time, so building
  // fixtures from a 'Z'-suffixed ISO string would make this test flaky
  // depending on the runner's timezone offset around month boundaries.
  it('returns the previous month within the same year', () => {
    expect(getRecapPeriod(new Date(2026, 6, 3, 18, 5))).toEqual({ month: 6, year: 2026 })
  })

  it('returns the previous month for the 1st of the month too', () => {
    expect(getRecapPeriod(new Date(2026, 6, 1, 5, 41))).toEqual({ month: 6, year: 2026 })
  })

  it('rolls over to December of the prior year when now is January', () => {
    expect(getRecapPeriod(new Date(2026, 0, 15, 12, 0))).toEqual({ month: 12, year: 2025 })
  })

  it('rolls over on January 1st exactly', () => {
    expect(getRecapPeriod(new Date(2026, 0, 1, 0, 0))).toEqual({ month: 12, year: 2025 })
  })

  it('defaults to the current instant when now is omitted', () => {
    const result = getRecapPeriod()
    expect(result.month).toBeGreaterThanOrEqual(1)
    expect(result.month).toBeLessThanOrEqual(12)
  })
})
