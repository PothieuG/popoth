/**
 * Sprint 08 — `lib/recap/actions-salary.ts` unit tests.
 *
 * Mocks `@/lib/supabase-server` with a chainable proxy so we can assert the
 * sequence of SQL calls and inject errors per scenario. Covers:
 *
 *  - Target validation: profile-context requires exactly the caller's profileId.
 *  - Target validation: group-context rejects profileIds outside the group.
 *  - Happy paths: profile (1 update + step advance), group (3 updates + RPC + step).
 *  - Fail-soft: `calculate_group_contributions` RPC error → outcome reports
 *    `contributionsRecalculated=false`, no throw.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface SupabaseMockState {
  profilesSelectEq: ReturnType<typeof vi.fn>
  profilesUpdateEq: ReturnType<typeof vi.fn>
  recapsUpdateEq: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}

vi.mock('@/lib/supabase-server', () => {
  const profilesSelectEq = vi.fn()
  const profilesUpdateEq = vi.fn()
  const recapsUpdateEq = vi.fn()
  const rpc = vi.fn()

  const supabaseServer = {
    from(table: string) {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: profilesSelectEq }),
          update: () => ({ eq: profilesUpdateEq }),
        }
      }
      if (table === 'monthly_recaps') {
        return {
          update: () => ({ eq: recapsUpdateEq }),
        }
      }
      throw new Error(`Unexpected supabaseServer.from(${table})`)
    },
    rpc,
  }
  return { supabaseServer, __mocks: { profilesSelectEq, profilesUpdateEq, recapsUpdateEq, rpc } }
})

async function mocks(): Promise<SupabaseMockState> {
  const mod = (await import('@/lib/supabase-server')) as unknown as {
    __mocks: SupabaseMockState
  }
  return mod.__mocks
}

beforeEach(async () => {
  const m = await mocks()
  m.profilesSelectEq.mockResolvedValue({ data: [], error: null })
  m.profilesUpdateEq.mockResolvedValue({ error: null })
  m.recapsUpdateEq.mockResolvedValue({ error: null })
  m.rpc.mockResolvedValue({ error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const USER_A = '11111111-1111-1111-1111-111111111111'
const USER_B = '22222222-2222-2222-2222-222222222222'
const USER_C = '33333333-3333-3333-3333-333333333333'
const GROUP = '99999999-9999-9999-9999-999999999999'
const RECAP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const STRANGER = '88888888-8888-8888-8888-888888888888'

describe('executeUpdateSalaries — profile context', () => {
  it('happy: 1 salary matching caller userId → updates + advances step', async () => {
    const { executeUpdateSalaries } = await import('../actions-salary')
    const m = await mocks()

    const outcome = await executeUpdateSalaries({
      context: 'profile',
      userId: USER_A,
      profile: { id: USER_A, group_id: null },
      recap: { id: RECAP },
      salaries: [{ profileId: USER_A, salary: 3000 }],
    })

    expect(outcome.updated).toBe(1)
    expect(outcome.nextStep).toBe('final_recap')
    expect(outcome.contributionsRecalculated).toBe(false)
    expect(m.profilesUpdateEq).toHaveBeenCalledTimes(1)
    expect(m.recapsUpdateEq).toHaveBeenCalledTimes(1)
    expect(m.rpc).not.toHaveBeenCalled()
  })

  it('rejects when salaries.length !== 1', async () => {
    const { executeUpdateSalaries } = await import('../actions-salary')
    const { RecapActionError } = await import('../actions-negative')

    await expect(
      executeUpdateSalaries({
        context: 'profile',
        userId: USER_A,
        profile: { id: USER_A, group_id: null },
        recap: { id: RECAP },
        salaries: [
          { profileId: USER_A, salary: 3000 },
          { profileId: USER_B, salary: 2500 },
        ],
      }),
    ).rejects.toBeInstanceOf(RecapActionError)
  })

  it('rejects when salaries[0].profileId !== userId', async () => {
    const { executeUpdateSalaries } = await import('../actions-salary')
    const { RecapActionError } = await import('../actions-negative')

    await expect(
      executeUpdateSalaries({
        context: 'profile',
        userId: USER_A,
        profile: { id: USER_A, group_id: null },
        recap: { id: RECAP },
        salaries: [{ profileId: USER_B, salary: 2500 }],
      }),
    ).rejects.toBeInstanceOf(RecapActionError)
  })
})

describe('executeUpdateSalaries — group context', () => {
  it('happy: 3 members all in group → 3 updates + RPC recalc + step advance', async () => {
    const { executeUpdateSalaries } = await import('../actions-salary')
    const m = await mocks()
    m.profilesSelectEq.mockResolvedValueOnce({
      data: [{ id: USER_A }, { id: USER_B }, { id: USER_C }],
      error: null,
    })

    const outcome = await executeUpdateSalaries({
      context: 'group',
      userId: USER_A,
      profile: { id: USER_A, group_id: GROUP },
      recap: { id: RECAP },
      salaries: [
        { profileId: USER_A, salary: 3000 },
        { profileId: USER_B, salary: 2500 },
        { profileId: USER_C, salary: 4000 },
      ],
    })

    expect(outcome.updated).toBe(3)
    expect(outcome.nextStep).toBe('final_recap')
    expect(outcome.contributionsRecalculated).toBe(true)
    expect(m.profilesUpdateEq).toHaveBeenCalledTimes(3)
    expect(m.rpc).toHaveBeenCalledWith('calculate_group_contributions', { group_id_param: GROUP })
    expect(m.recapsUpdateEq).toHaveBeenCalledTimes(1)
  })

  it('rejects with extras.invalid when a profileId is outside the group', async () => {
    const { executeUpdateSalaries } = await import('../actions-salary')
    const { RecapActionError } = await import('../actions-negative')
    const m = await mocks()
    m.profilesSelectEq.mockResolvedValueOnce({
      data: [{ id: USER_A }, { id: USER_B }],
      error: null,
    })

    let caught: unknown
    try {
      await executeUpdateSalaries({
        context: 'group',
        userId: USER_A,
        profile: { id: USER_A, group_id: GROUP },
        recap: { id: RECAP },
        salaries: [
          { profileId: USER_A, salary: 3000 },
          { profileId: STRANGER, salary: 2500 },
        ],
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(RecapActionError)
    const err = caught as InstanceType<typeof RecapActionError>
    expect(err.code).toBe('invalid_target')
    expect(err.status).toBe(400)
    expect(err.extras.invalid).toEqual([STRANGER])
    // No mutation happened
    expect(m.profilesUpdateEq).not.toHaveBeenCalled()
  })

  it('fail-soft: calculate_group_contributions error → outcome.contributionsRecalculated=false, no throw', async () => {
    const { executeUpdateSalaries } = await import('../actions-salary')
    const m = await mocks()
    m.profilesSelectEq.mockResolvedValueOnce({
      data: [{ id: USER_A }, { id: USER_B }],
      error: null,
    })
    m.rpc.mockResolvedValueOnce({ error: { message: 'recalc boom' } })

    const outcome = await executeUpdateSalaries({
      context: 'group',
      userId: USER_A,
      profile: { id: USER_A, group_id: GROUP },
      recap: { id: RECAP },
      salaries: [
        { profileId: USER_A, salary: 3000 },
        { profileId: USER_B, salary: 2500 },
      ],
    })

    expect(outcome.contributionsRecalculated).toBe(false)
    expect(outcome.updated).toBe(2)
    expect(outcome.nextStep).toBe('final_recap')
    expect(m.recapsUpdateEq).toHaveBeenCalledTimes(1)
  })
})
