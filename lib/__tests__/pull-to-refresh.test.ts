import { describe, it, expect } from 'vitest'
import { dampPull, shouldTriggerRefresh } from '@/lib/pull-to-refresh'

describe('dampPull', () => {
  it('returns 0 for non-positive travel (no upward pull)', () => {
    expect(dampPull(0, { resistance: 0.5, max: 120 })).toBe(0)
    expect(dampPull(-50, { resistance: 0.5, max: 120 })).toBe(0)
  })

  it('applies resistance to downward travel', () => {
    expect(dampPull(100, { resistance: 0.5, max: 120 })).toBe(50)
    expect(dampPull(40, { resistance: 0.5, max: 120 })).toBe(20)
  })

  it('clamps the damped distance to max', () => {
    expect(dampPull(260, { resistance: 0.5, max: 120 })).toBe(120) // 130 → capped
    expect(dampPull(1000, { resistance: 0.5, max: 120 })).toBe(120)
  })
})

describe('shouldTriggerRefresh', () => {
  it('is true at or above the threshold', () => {
    expect(shouldTriggerRefresh(72, 72)).toBe(true)
    expect(shouldTriggerRefresh(100, 72)).toBe(true)
  })

  it('is false below the threshold', () => {
    expect(shouldTriggerRefresh(71.9, 72)).toBe(false)
    expect(shouldTriggerRefresh(0, 72)).toBe(false)
  })
})
