/**
 * Pure helpers from `lib/recap/actions-negative.ts` — non-gated unit tests.
 *
 * Covers `sumSnapshotValues` and `computeDeficitRemaining`, the two shared
 * pure-sync helpers used both server-side (negative-flow endpoints) and
 * client-side (sprint 13 live deficit counter).
 */

import { describe, expect, it } from 'vitest'

import { computeDeficitRemaining, sumSnapshotValues } from '../actions-negative'

describe('sumSnapshotValues', () => {
  it('returns 0 when snapshot is null', () => {
    expect(sumSnapshotValues(null)).toBe(0)
  })

  it('returns 0 when snapshot is undefined', () => {
    expect(sumSnapshotValues(undefined)).toBe(0)
  })

  it('returns 0 for an empty snapshot record', () => {
    expect(sumSnapshotValues({})).toBe(0)
  })

  it('sums numeric values cents-precise', () => {
    expect(sumSnapshotValues({ a: 10.33, b: 20.67 })).toBe(31)
  })

  it('absorbs float drift via round2 (33.33 + 33.33 + 33.34 = 100 exact)', () => {
    expect(sumSnapshotValues({ a: 33.33, b: 33.33, c: 33.34 })).toBe(100)
  })

  it('handles single-key snapshots', () => {
    expect(sumSnapshotValues({ only: 42.5 })).toBe(42.5)
  })
})

describe('computeDeficitRemaining', () => {
  it('returns the absolute initialBilan when nothing has been refloated yet', () => {
    expect(
      computeDeficitRemaining({
        initialBilan: -100,
        refloatedFromPiggy: 0,
        refloatedFromSavings: 0,
        snapshotData: null,
      }),
    ).toBe(100)
  })

  it('subtracts all three refloat sources cumulatively', () => {
    expect(
      computeDeficitRemaining({
        initialBilan: -100,
        refloatedFromPiggy: 30,
        refloatedFromSavings: 20,
        snapshotData: { a: 10 },
      }),
    ).toBe(40)
  })

  it('returns 0 when refloat sources exactly cover the deficit', () => {
    expect(
      computeDeficitRemaining({
        initialBilan: -75,
        refloatedFromPiggy: 25,
        refloatedFromSavings: 25,
        snapshotData: { a: 25 },
      }),
    ).toBe(0)
  })

  it('returns a negative value when over-refloated (caller responsibility)', () => {
    expect(
      computeDeficitRemaining({
        initialBilan: -50,
        refloatedFromPiggy: 60,
        refloatedFromSavings: 0,
        snapshotData: null,
      }),
    ).toBe(-10)
  })

  it('returns a non-positive value for a positive initialBilan (caller responsibility)', () => {
    // computeDeficitRemaining doesn't enforce caller invariants — it computes
    // `|bilan| - refloat`, leaving the negative-bilan check to the executeXxx
    // helpers / routes.
    expect(
      computeDeficitRemaining({
        initialBilan: 50, // positive bilan → no deficit
        refloatedFromPiggy: 10,
        refloatedFromSavings: 0,
        snapshotData: null,
      }),
    ).toBe(40) // |50| - 10 = 40 (caller must treat positive bilan as "no_deficit")
  })

  it('snapshot float drift does not break the cents-precise result', () => {
    expect(
      computeDeficitRemaining({
        initialBilan: -100,
        refloatedFromPiggy: 0,
        refloatedFromSavings: 0,
        snapshotData: { a: 33.33, b: 33.33, c: 33.34 },
      }),
    ).toBe(0)
  })
})
