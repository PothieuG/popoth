import { describe, expect, it } from 'vitest'
import { isAdvanceAllowed, nextRequiredStep, RECAP_STEP_ORDER, type RecapStep } from '@/lib/recap'

describe('RECAP_STEP_ORDER', () => {
  it('lists the seven wizard steps in canonical order', () => {
    expect(RECAP_STEP_ORDER).toEqual([
      'welcome',
      'complete_month',
      'summary',
      'manage_bilan',
      'salary_update',
      'final_recap',
      'completed',
    ] satisfies readonly RecapStep[])
  })

  it('places complete_month at index 1 (between welcome and summary)', () => {
    // Sprint Complete-Month-Step (2026-05-29) — pin the position so a future
    // reorder doesn't silently break the wizard's welcome → complete_month
    // → summary linear flow.
    expect(RECAP_STEP_ORDER.indexOf('complete_month')).toBe(1)
    expect(RECAP_STEP_ORDER.indexOf('summary')).toBe(2)
  })
})

describe('isAdvanceAllowed', () => {
  it('accepts welcome → complete_month (new consecutive forward)', () => {
    expect(isAdvanceAllowed('welcome', 'complete_month')).toBe(true)
  })

  it('accepts complete_month → summary (consecutive forward)', () => {
    expect(isAdvanceAllowed('complete_month', 'summary')).toBe(true)
  })

  it('accepts welcome → summary (skip complete_month — long-range forward)', () => {
    // isAdvanceAllowed deliberately permits non-adjacent forward skips. The
    // wizard's WelcomeStep targets complete_month explicitly post-sprint, but
    // skip semantics remain available to consumers (cf. test below).
    expect(isAdvanceAllowed('welcome', 'summary')).toBe(true)
  })

  it('accepts summary → manage_bilan (consecutive forward)', () => {
    expect(isAdvanceAllowed('summary', 'manage_bilan')).toBe(true)
  })

  it('accepts welcome → salary_update (skip several steps forward)', () => {
    expect(isAdvanceAllowed('welcome', 'salary_update')).toBe(true)
  })

  it('accepts welcome → completed (skip to terminal)', () => {
    expect(isAdvanceAllowed('welcome', 'completed')).toBe(true)
  })

  it('accepts manage_bilan → completed (skip from middle)', () => {
    expect(isAdvanceAllowed('manage_bilan', 'completed')).toBe(true)
  })

  it('rejects summary → complete_month (backward)', () => {
    expect(isAdvanceAllowed('summary', 'complete_month')).toBe(false)
  })

  it('rejects complete_month → welcome (backward)', () => {
    expect(isAdvanceAllowed('complete_month', 'welcome')).toBe(false)
  })

  it('rejects summary → welcome (backward)', () => {
    expect(isAdvanceAllowed('summary', 'welcome')).toBe(false)
  })

  it('rejects final_recap → manage_bilan (backward over several steps)', () => {
    expect(isAdvanceAllowed('final_recap', 'manage_bilan')).toBe(false)
  })

  it('rejects completed → anything (from terminal)', () => {
    expect(isAdvanceAllowed('completed', 'welcome')).toBe(false)
    expect(isAdvanceAllowed('completed', 'final_recap')).toBe(false)
    expect(isAdvanceAllowed('completed', 'completed')).toBe(false)
  })

  it('rejects self-loops at every step', () => {
    for (const step of RECAP_STEP_ORDER) {
      expect(isAdvanceAllowed(step, step)).toBe(false)
    }
  })
})

describe('nextRequiredStep', () => {
  it('returns complete_month from welcome', () => {
    expect(nextRequiredStep('welcome')).toBe('complete_month')
  })

  it('returns summary from complete_month', () => {
    expect(nextRequiredStep('complete_month')).toBe('summary')
  })

  it('returns manage_bilan from summary', () => {
    expect(nextRequiredStep('summary')).toBe('manage_bilan')
  })

  it('returns salary_update from manage_bilan', () => {
    expect(nextRequiredStep('manage_bilan')).toBe('salary_update')
  })

  it('returns final_recap from salary_update', () => {
    expect(nextRequiredStep('salary_update')).toBe('final_recap')
  })

  it('returns completed from final_recap', () => {
    expect(nextRequiredStep('final_recap')).toBe('completed')
  })

  it('returns null from completed (terminal)', () => {
    expect(nextRequiredStep('completed')).toBeNull()
  })
})
