/**
 * Sprint 08 — `lib/recap/actions-finalize.ts` unit tests.
 *
 * Mocks `@/lib/supabase-server` to assert orchestrator decisions:
 *
 *  - Empty/null snapshot → `finalize_recap_apply_snapshot` RPC is NOT called.
 *  - Non-empty snapshot → RPC called with the coerced snapshot.
 *  - Snapshot RPC error → continues to process_transactions + mark completed
 *    (fail-soft), outcome.snapshotApplied=null.
 *  - process_transactions RPC error → continues to mark completed (fail-soft),
 *    outcome.transactions=all-zero.
 *  - Final completed_at update fails → throws (NOT fail-soft).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface MocksState {
  rpc: ReturnType<typeof vi.fn>
  recapsUpdateEq: ReturnType<typeof vi.fn>
}

vi.mock('@/lib/supabase-server', () => {
  const rpc = vi.fn()
  const recapsUpdateEq = vi.fn()

  const supabaseServer = {
    from(table: string) {
      if (table === 'monthly_recaps') {
        return { update: () => ({ eq: recapsUpdateEq }) }
      }
      throw new Error(`Unexpected supabaseServer.from(${table})`)
    },
    rpc,
  }
  return { supabaseServer, __mocks: { rpc, recapsUpdateEq } }
})

async function getMocks(): Promise<MocksState> {
  const mod = (await import('@/lib/supabase-server')) as unknown as { __mocks: MocksState }
  return mod.__mocks
}

beforeEach(async () => {
  const m = await getMocks()
  m.rpc.mockResolvedValue({ data: null, error: null })
  m.recapsUpdateEq.mockResolvedValue({ error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const PROFILE_ID = 'aaaa1111-1111-1111-1111-111111111111'
const GROUP_ID = 'bbbb2222-2222-2222-2222-222222222222'
const RECAP_ID = 'cccc3333-3333-3333-3333-333333333333'
const BUDGET_1 = 'dddd4444-4444-4444-4444-444444444444'
const BUDGET_2 = 'eeee5555-5555-5555-5555-555555555555'

describe('executeCompleteRecap', () => {
  it('empty snapshot → skips apply_snapshot RPC, still processes + marks completed', async () => {
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    m.rpc.mockResolvedValueOnce({
      data: { deleted_expenses: 0, deleted_incomes: 0, carried_expenses: 0, carried_incomes: 0 },
      error: null,
    })

    const outcome = await executeCompleteRecap({
      context: 'profile',
      profile: { id: PROFILE_ID, group_id: null },
      recap: { id: RECAP_ID, budget_snapshot_data: {} },
    })

    expect(outcome.completed).toBe(true)
    expect(outcome.snapshotApplied).toBeNull()
    expect(m.rpc).toHaveBeenCalledTimes(1)
    expect(m.rpc).toHaveBeenCalledWith('process_recap_transactions', {
      p_recap_id: RECAP_ID,
      p_profile_id: PROFILE_ID,
    })
    expect(m.recapsUpdateEq).toHaveBeenCalledTimes(1)
  })

  it('non-empty snapshot → calls apply_snapshot then process_transactions', async () => {
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    m.rpc
      .mockResolvedValueOnce({
        data: {
          applied: [
            { budget_id: BUDGET_1, amount: 20 },
            { budget_id: BUDGET_2, amount: 30 },
          ],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { deleted_expenses: 2, deleted_incomes: 1, carried_expenses: 3, carried_incomes: 0 },
        error: null,
      })

    const outcome = await executeCompleteRecap({
      context: 'profile',
      profile: { id: PROFILE_ID, group_id: null },
      recap: { id: RECAP_ID, budget_snapshot_data: { [BUDGET_1]: 20, [BUDGET_2]: 30 } },
    })

    expect(outcome.completed).toBe(true)
    expect(outcome.snapshotApplied?.applied).toHaveLength(2)
    expect(outcome.transactions.deleted_expenses).toBe(2)
    expect(outcome.transactions.carried_expenses).toBe(3)
    expect(m.rpc).toHaveBeenNthCalledWith(1, 'finalize_recap_apply_snapshot', {
      p_recap_id: RECAP_ID,
      p_snapshot: { [BUDGET_1]: 20, [BUDGET_2]: 30 },
    })
    expect(m.rpc).toHaveBeenNthCalledWith(2, 'process_recap_transactions', {
      p_recap_id: RECAP_ID,
      p_profile_id: PROFILE_ID,
    })
  })

  it('apply_snapshot RPC error → fail-soft (continue to process + mark completed)', async () => {
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    m.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'snapshot boom' } })
      .mockResolvedValueOnce({
        data: { deleted_expenses: 1, deleted_incomes: 0, carried_expenses: 0, carried_incomes: 0 },
        error: null,
      })

    const outcome = await executeCompleteRecap({
      context: 'profile',
      profile: { id: PROFILE_ID, group_id: null },
      recap: { id: RECAP_ID, budget_snapshot_data: { [BUDGET_1]: 10 } },
    })

    expect(outcome.completed).toBe(true)
    expect(outcome.snapshotApplied).toBeNull()
    expect(outcome.transactions.deleted_expenses).toBe(1)
    expect(m.recapsUpdateEq).toHaveBeenCalledTimes(1)
  })

  it('process_transactions RPC error → fail-soft (mark completed, zero counts)', async () => {
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'tx boom' } })

    const outcome = await executeCompleteRecap({
      context: 'group',
      profile: { id: PROFILE_ID, group_id: GROUP_ID },
      recap: { id: RECAP_ID, budget_snapshot_data: {} },
    })

    expect(outcome.completed).toBe(true)
    expect(outcome.transactions).toEqual({
      deleted_expenses: 0,
      deleted_incomes: 0,
      carried_expenses: 0,
      carried_incomes: 0,
    })
    expect(m.rpc).toHaveBeenCalledWith('process_recap_transactions', {
      p_recap_id: RECAP_ID,
      p_group_id: GROUP_ID,
    })
    expect(m.recapsUpdateEq).toHaveBeenCalledTimes(1)
  })

  it('final UPDATE completed_at fails → throws (NOT fail-soft)', async () => {
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    m.rpc.mockResolvedValueOnce({
      data: { deleted_expenses: 0, deleted_incomes: 0, carried_expenses: 0, carried_incomes: 0 },
      error: null,
    })
    m.recapsUpdateEq.mockResolvedValueOnce({ error: { message: 'completion boom' } })

    await expect(
      executeCompleteRecap({
        context: 'profile',
        profile: { id: PROFILE_ID, group_id: null },
        recap: { id: RECAP_ID, budget_snapshot_data: {} },
      }),
    ).rejects.toMatchObject({ message: 'completion boom' })
  })
})
