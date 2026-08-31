/**
 * Pure-helper tests for `lib/recap/deficit-math.ts`.
 *
 * The `sumSnapshotValues` + `computeDeficitRemaining` helpers also have
 * tests in `__tests__/actions-negative.test.ts` (back-compat with the
 * sprint-07 re-export); these focus on `coerceSnapshot` (the JSONB →
 * `Record<string, number>` narrowing helper added in sprint 13) and the
 * client-safe import surface of the module.
 */

import { describe, expect, it } from 'vitest'

import {
  coerceSnapshot,
  computeDeficitRemaining,
  sumSnapshotValues,
} from '@/lib/recap/deficit-math'

describe('coerceSnapshot', () => {
  it('returns null when raw is null', () => {
    expect(coerceSnapshot(null)).toBeNull()
  })

  it('returns null when raw is undefined', () => {
    expect(coerceSnapshot(undefined)).toBeNull()
  })

  it('returns null when raw is a JSON array (wrong shape)', () => {
    expect(coerceSnapshot([1, 2, 3])).toBeNull()
  })

  it('returns null when raw is a primitive (number / string / boolean)', () => {
    expect(coerceSnapshot(42)).toBeNull()
    expect(coerceSnapshot('hello')).toBeNull()
    expect(coerceSnapshot(true)).toBeNull()
  })

  it('returns an empty object for {}', () => {
    expect(coerceSnapshot({})).toEqual({})
  })

  it('keeps numeric values, drops non-numeric entries', () => {
    expect(coerceSnapshot({ a: 10, b: 'no', c: 20, d: null, e: false })).toEqual({ a: 10, c: 20 })
  })

  it('preserves cents-precise numbers verbatim', () => {
    expect(coerceSnapshot({ a: 33.33, b: 33.34 })).toEqual({ a: 33.33, b: 33.34 })
  })
})

describe('deficit-math re-export surface', () => {
  // Smoke regression : a single happy-path call per helper. The exhaustive
  // matrix lives in __tests__/actions-negative.test.ts (kept there to absorb
  // future churn without rewriting either file).
  it('sumSnapshotValues sums numeric entries', () => {
    expect(sumSnapshotValues({ a: 10, b: 20 })).toBe(30)
  })

  it('computeDeficitRemaining combines piggy + savings + snapshot offsets', () => {
    expect(
      computeDeficitRemaining({
        initialBilan: -100,
        refloatedFromPiggy: 25,
        refloatedFromSavings: 25,
        snapshotData: { x: 25 },
      }),
    ).toBe(25)
  })

  it('computeDeficitRemaining subtracts projectSnapshotData when supplied (sprint 08)', () => {
    expect(
      computeDeficitRemaining({
        initialBilan: -100,
        refloatedFromPiggy: 10,
        refloatedFromSavings: 20,
        snapshotData: { x: 30 },
        projectSnapshotData: { p1: 25, p2: 10 },
      }),
    ).toBe(5)
  })

  it('computeDeficitRemaining is back-compat when projectSnapshotData is omitted', () => {
    expect(
      computeDeficitRemaining({
        initialBilan: -80,
        refloatedFromPiggy: 0,
        refloatedFromSavings: 0,
        snapshotData: null,
      }),
    ).toBe(80)
  })

  // Sprint Deficit-Guard 2026-08-31 — garde-fou : sur un bilan >= 0 il n'y a
  // rien à renflouer. Avant, `Math.abs` produisait un déficit fictif positif
  // (piège pour le prochain appelant ; les 4 appelants actuels gardent tous
  // un `bilanSign !== 'negative'` → 409 en amont).
  it('computeDeficitRemaining short-circuits to 0 on a non-negative bilan', () => {
    expect(
      computeDeficitRemaining({
        initialBilan: 120,
        refloatedFromPiggy: 0,
        refloatedFromSavings: 0,
        snapshotData: { x: 10 },
        projectSnapshotData: { p1: 5 },
      }),
    ).toBe(0)
    expect(
      computeDeficitRemaining({
        initialBilan: 0,
        refloatedFromPiggy: 0,
        refloatedFromSavings: 0,
        snapshotData: null,
      }),
    ).toBe(0)
  })
})
