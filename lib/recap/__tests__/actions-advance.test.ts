/**
 * Sprint 11 — `lib/recap/actions-advance.ts` unit tests.
 *
 * Mocks `@/lib/supabase-server` with a chainable proxy capturing the final
 * `.select('id')` call. The helper's logic is small (validate transition,
 * guarded UPDATE) so the tests focus on the 4 outcomes:
 *   - happy: valid transition + matching current_step → success
 *   - invalid_transition: backward / self-loop / non-adjacent skip
 *   - stale_step (client view): recap.current_step !== fromStep
 *   - stale_step (race): UPDATE returns 0 rows (concurrent advance)
 *   - db_error: supabase returns an error
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface SupabaseMockState {
  recapsSelect: ReturnType<typeof vi.fn>
}

vi.mock('@/lib/supabase-server', () => {
  const recapsSelect = vi.fn()

  const supabaseServer = {
    from(table: string) {
      if (table === 'monthly_recaps') {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: recapsSelect,
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected supabaseServer.from(${table})`)
    },
  }
  return { supabaseServer, __mocks: { recapsSelect } }
})

async function mocks(): Promise<SupabaseMockState> {
  const mod = (await import('@/lib/supabase-server')) as unknown as {
    __mocks: SupabaseMockState
  }
  return mod.__mocks
}

beforeEach(async () => {
  const m = await mocks()
  m.recapsSelect.mockResolvedValue({ data: [{ id: 'r1' }], error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function makeRecap(currentStep: string) {
  // Minimal shape — executeAdvanceStep only consults id + current_step.
  return {
    id: 'r1',
    current_step: currentStep,
  } as unknown as import('../active-recap').MonthlyRecapRow
}

describe('executeAdvanceStep', () => {
  it('happy welcome → summary: returns success and triggers DB update', async () => {
    const { executeAdvanceStep } = await import('../actions-advance')
    const m = await mocks()

    const outcome = await executeAdvanceStep({
      recap: makeRecap('welcome'),
      fromStep: 'welcome',
      toStep: 'summary',
    })

    expect(outcome).toEqual({ success: true, currentStep: 'summary' })
    expect(m.recapsSelect).toHaveBeenCalledTimes(1)
  })

  it('happy summary → manage_bilan', async () => {
    const { executeAdvanceStep } = await import('../actions-advance')

    const outcome = await executeAdvanceStep({
      recap: makeRecap('summary'),
      fromStep: 'summary',
      toStep: 'manage_bilan',
    })

    expect(outcome).toEqual({ success: true, currentStep: 'manage_bilan' })
  })

  it('happy welcome → complete_month (sprint Complete-Month-Step)', async () => {
    const { executeAdvanceStep } = await import('../actions-advance')

    const outcome = await executeAdvanceStep({
      recap: makeRecap('welcome'),
      fromStep: 'welcome',
      toStep: 'complete_month',
    })

    expect(outcome).toEqual({ success: true, currentStep: 'complete_month' })
  })

  it('happy complete_month → summary (sprint Complete-Month-Step)', async () => {
    const { executeAdvanceStep } = await import('../actions-advance')

    const outcome = await executeAdvanceStep({
      recap: makeRecap('complete_month'),
      fromStep: 'complete_month',
      toStep: 'summary',
    })

    expect(outcome).toEqual({ success: true, currentStep: 'summary' })
  })

  it('rejects summary → complete_month (backward — sprint Complete-Month-Step)', async () => {
    const { executeAdvanceStep } = await import('../actions-advance')

    const outcome = await executeAdvanceStep({
      recap: makeRecap('summary'),
      fromStep: 'summary',
      toStep: 'complete_month',
    })

    expect(outcome).toEqual({ success: false, error: 'invalid_transition' })
  })

  it('rejects invalid_transition when from === to (self-loop)', async () => {
    const { executeAdvanceStep } = await import('../actions-advance')
    const m = await mocks()

    const outcome = await executeAdvanceStep({
      recap: makeRecap('summary'),
      fromStep: 'summary',
      toStep: 'summary',
    })

    expect(outcome).toEqual({ success: false, error: 'invalid_transition' })
    expect(m.recapsSelect).not.toHaveBeenCalled()
  })

  it('rejects invalid_transition when going backward (summary → welcome)', async () => {
    const { executeAdvanceStep } = await import('../actions-advance')

    const outcome = await executeAdvanceStep({
      recap: makeRecap('summary'),
      fromStep: 'summary',
      toStep: 'welcome',
    })

    expect(outcome).toEqual({ success: false, error: 'invalid_transition' })
  })

  it('rejects stale_step when recap.current_step !== fromStep (client out-of-date)', async () => {
    const { executeAdvanceStep } = await import('../actions-advance')
    const m = await mocks()

    const outcome = await executeAdvanceStep({
      recap: makeRecap('manage_bilan'),
      fromStep: 'summary', // client thinks recap is on summary, server has manage_bilan
      toStep: 'manage_bilan',
    })

    expect(outcome).toEqual({ success: false, error: 'stale_step' })
    expect(m.recapsSelect).not.toHaveBeenCalled()
  })

  it('rejects stale_step when UPDATE returns 0 rows (concurrent advance race)', async () => {
    const { executeAdvanceStep } = await import('../actions-advance')
    const m = await mocks()
    m.recapsSelect.mockResolvedValueOnce({ data: [], error: null })

    const outcome = await executeAdvanceStep({
      recap: makeRecap('welcome'),
      fromStep: 'welcome',
      toStep: 'summary',
    })

    expect(outcome).toEqual({ success: false, error: 'stale_step' })
  })

  it('returns db_error when supabase update fails', async () => {
    const { executeAdvanceStep } = await import('../actions-advance')
    const m = await mocks()
    m.recapsSelect.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection lost' },
    })

    const outcome = await executeAdvanceStep({
      recap: makeRecap('welcome'),
      fromStep: 'welcome',
      toStep: 'summary',
    })

    expect(outcome).toEqual({ success: false, error: 'db_error' })
  })

  it('allows long-range forward skip (welcome → final_recap) — caller restricts to next adjacent in practice', async () => {
    // isAdvanceAllowed deliberately permits non-adjacent forward skips
    // (cf. lib/recap/state.ts comment). Endpoint layer is responsible for
    // tightening to nextRequiredStep when needed. This test pins the
    // permissive contract so consumers know they can rely on it.
    const { executeAdvanceStep } = await import('../actions-advance')

    const outcome = await executeAdvanceStep({
      recap: makeRecap('welcome'),
      fromStep: 'welcome',
      toStep: 'final_recap',
    })

    expect(outcome).toEqual({ success: true, currentStep: 'final_recap' })
  })
})
