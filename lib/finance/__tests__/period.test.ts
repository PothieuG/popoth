import { describe, it, expect } from 'vitest'
import { computePeriodDateRange } from '@/lib/finance/period'

describe('computePeriodDateRange', () => {
  // 2026-05-15 (Friday) — date du Sprint P1 livraison.
  // Paris timezone in May is UTC+2 (DST), so 12:00 UTC = 14:00 Paris → same date.
  const fridayMay15 = new Date('2026-05-15T12:00:00Z')

  it("period='month' returns null (no filter — preserves 'since last recap')", () => {
    expect(computePeriodDateRange('month', fridayMay15)).toBeNull()
  })

  it("period='day' returns today/today (Europe/Paris)", () => {
    expect(computePeriodDateRange('day', fridayMay15)).toEqual({
      startDate: '2026-05-15',
      endDate: '2026-05-15',
    })
  })

  it("period='week' from Friday returns Monday-Sunday of that week", () => {
    // Friday May 15 → Monday May 11, Sunday May 17
    expect(computePeriodDateRange('week', fridayMay15)).toEqual({
      startDate: '2026-05-11',
      endDate: '2026-05-17',
    })
  })

  it("period='week' from a Monday returns same Monday and following Sunday", () => {
    const mondayMay11 = new Date('2026-05-11T12:00:00Z')
    expect(computePeriodDateRange('week', mondayMay11)).toEqual({
      startDate: '2026-05-11',
      endDate: '2026-05-17',
    })
  })

  it("period='week' from a Sunday returns same week (not next week)", () => {
    // ISO 8601 : Sunday is the end of the week, not the start.
    const sundayMay17 = new Date('2026-05-17T12:00:00Z')
    expect(computePeriodDateRange('week', sundayMay17)).toEqual({
      startDate: '2026-05-11',
      endDate: '2026-05-17',
    })
  })

  it("period='week' spanning month boundary", () => {
    // 2026-05-31 (Sunday) — week is May 25 → May 31
    const sundayMay31 = new Date('2026-05-31T12:00:00Z')
    expect(computePeriodDateRange('week', sundayMay31)).toEqual({
      startDate: '2026-05-25',
      endDate: '2026-05-31',
    })
  })

  it("period='week' from late Sunday evening Paris time (DST safety)", () => {
    // 2026-05-17 22:00 UTC = 00:00 Paris next day (May 18 Monday) ?
    // Actually 22:00 UTC + 2h (CEST) = 00:00 of next day in Paris.
    // So this should return the NEXT week (May 18-24).
    const sundayLateUtc = new Date('2026-05-17T22:00:00Z')
    expect(computePeriodDateRange('week', sundayLateUtc)).toEqual({
      startDate: '2026-05-18',
      endDate: '2026-05-24',
    })
  })

  it("period='day' uses Paris timezone, not server UTC", () => {
    // 2026-05-15 23:30 UTC = 01:30 Paris next day (May 16)
    const lateNightUtc = new Date('2026-05-15T23:30:00Z')
    expect(computePeriodDateRange('day', lateNightUtc)).toEqual({
      startDate: '2026-05-16',
      endDate: '2026-05-16',
    })
  })
})
