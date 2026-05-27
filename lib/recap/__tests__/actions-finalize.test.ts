/**
 * Sprint 08 — `lib/recap/actions-finalize.ts` unit tests.
 *
 * Mocks `@/lib/supabase-server` to assert orchestrator decisions:
 *
 *  - Empty/null snapshot → `finalize_recap_apply_snapshot` RPC IS called
 *    (Sprint Carryover-Self-Healing 2026-05-26 — the RPC must run even with
 *    empty snapshot to reset stale owner carryovers to 0).
 *  - Non-empty snapshot → RPC called with the coerced snapshot.
 *  - Snapshot RPC error → continues to process_transactions + mark completed
 *    (fail-soft), outcome.snapshotApplied=null.
 *  - process_transactions RPC error → continues to mark completed (fail-soft),
 *    outcome.transactions=all-zero.
 *  - Final completed_at update fails → throws (NOT fail-soft).
 *
 * Sprint Projets-Épargne 10 — extended :
 *  - `apply_recap_projects_snapshot` RPC is ALWAYS called (even when
 *    `project_snapshot_data` is null/empty — the RPC iterates on all active
 *    projects of the owner to credit `amount_saved`).
 *  - Projects RPC error → fail-soft, outcome.projectsApplied=null.
 *  - Non-empty `project_snapshot_data` forwarded as `p_allocations` verbatim.
 *
 * Sprint Carryover-Self-Healing 2026-05-26 — extended :
 *  - `outcome.snapshotApplied` now includes `reset_count` (number of owner
 *    budgets whose carryover was reset to 0 before snapshot apply).
 *
 * Sprint Salary-Auto-At-Recap-Complete 2026-06-05 — extended :
 *  - `create_salary_income_for_recap` RPC is called between process_transactions
 *    and UPDATE completed_at, BUT ONLY in solo mode (context==='profile').
 *    In group mode, the mirror income mechanism (trigger Sprint 16 V3 extended)
 *    takes over — no salary RPC call.
 *  - `outcome.salaryIncome` exposes the result (created/skip/already_exists)
 *    in solo mode, `null` in group mode.
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
  it('empty snapshot → STILL calls apply_snapshot RPC (owner reset), then projects + processes + salary + marks completed', async () => {
    // Sprint Carryover-Self-Healing 2026-05-26 — the RPC is no longer skipped
    // for empty snapshot ; it must run to reset owner carryovers to 0.
    // Sprint Salary-Auto-At-Recap-Complete 2026-06-05 — in solo mode, a 4th
    // RPC (`create_salary_income_for_recap`) is called between
    // process_transactions and the completed_at UPDATE.
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    m.rpc
      .mockResolvedValueOnce({ data: { applied: [], reset_count: 2 }, error: null })
      .mockResolvedValueOnce({ data: { updated_count: 0, total_refunded: 0 }, error: null })
      .mockResolvedValueOnce({
        data: { deleted_expenses: 0, deleted_incomes: 0, carried_expenses: 0, carried_incomes: 0 },
        error: null,
      })
      .mockResolvedValueOnce({ data: { created: false, reason: 'no_salary' }, error: null })

    const outcome = await executeCompleteRecap({
      context: 'profile',
      profile: { id: PROFILE_ID, group_id: null },
      recap: { id: RECAP_ID, budget_snapshot_data: {}, project_snapshot_data: {} },
    })

    expect(outcome.completed).toBe(true)
    expect(outcome.snapshotApplied).toEqual({ applied: [], reset_count: 2 })
    expect(outcome.projectsApplied).toEqual({ updated_count: 0, total_refunded: 0 })
    expect(outcome.salaryIncome).toEqual({ created: false, reason: 'no_salary' })
    expect(m.rpc).toHaveBeenCalledTimes(4)
    expect(m.rpc).toHaveBeenNthCalledWith(1, 'finalize_recap_apply_snapshot', {
      p_recap_id: RECAP_ID,
      p_snapshot: {},
    })
    expect(m.rpc).toHaveBeenNthCalledWith(2, 'apply_recap_projects_snapshot', {
      p_recap_id: RECAP_ID,
      p_allocations: {},
    })
    expect(m.rpc).toHaveBeenNthCalledWith(3, 'process_recap_transactions', {
      p_recap_id: RECAP_ID,
      p_profile_id: PROFILE_ID,
    })
    expect(m.rpc).toHaveBeenNthCalledWith(4, 'create_salary_income_for_recap', {
      p_recap_id: RECAP_ID,
      p_profile_id: PROFILE_ID,
    })
    expect(m.recapsUpdateEq).toHaveBeenCalledTimes(1)
  })

  it('non-empty budget snapshot → calls apply_snapshot (with reset_count), projects snapshot, then process_transactions, then salary', async () => {
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    m.rpc
      .mockResolvedValueOnce({
        data: {
          applied: [
            { budget_id: BUDGET_1, amount: 20 },
            { budget_id: BUDGET_2, amount: 30 },
          ],
          reset_count: 4,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { updated_count: 0, total_refunded: 0 }, error: null })
      .mockResolvedValueOnce({
        data: { deleted_expenses: 2, deleted_incomes: 1, carried_expenses: 3, carried_incomes: 0 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { created: true, income_id: 'salary-uuid', amount: 2000 },
        error: null,
      })

    const outcome = await executeCompleteRecap({
      context: 'profile',
      profile: { id: PROFILE_ID, group_id: null },
      recap: {
        id: RECAP_ID,
        budget_snapshot_data: { [BUDGET_1]: 20, [BUDGET_2]: 30 },
        project_snapshot_data: {},
      },
    })

    expect(outcome.completed).toBe(true)
    expect(outcome.snapshotApplied?.applied).toHaveLength(2)
    expect(outcome.snapshotApplied?.reset_count).toBe(4)
    expect(outcome.transactions.deleted_expenses).toBe(2)
    expect(outcome.transactions.carried_expenses).toBe(3)
    expect(m.rpc).toHaveBeenNthCalledWith(1, 'finalize_recap_apply_snapshot', {
      p_recap_id: RECAP_ID,
      p_snapshot: { [BUDGET_1]: 20, [BUDGET_2]: 30 },
    })
    expect(m.rpc).toHaveBeenNthCalledWith(2, 'apply_recap_projects_snapshot', {
      p_recap_id: RECAP_ID,
      p_allocations: {},
    })
    expect(m.rpc).toHaveBeenNthCalledWith(3, 'process_recap_transactions', {
      p_recap_id: RECAP_ID,
      p_profile_id: PROFILE_ID,
    })
  })

  it('non-empty project_snapshot_data → forwards as p_allocations verbatim', async () => {
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    const PROJ_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const PROJ_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    m.rpc
      .mockResolvedValueOnce({ data: { applied: [], reset_count: 0 }, error: null })
      .mockResolvedValueOnce({ data: { updated_count: 2, total_refunded: 80 }, error: null })
      .mockResolvedValueOnce({
        data: { deleted_expenses: 0, deleted_incomes: 0, carried_expenses: 0, carried_incomes: 0 },
        error: null,
      })
      .mockResolvedValueOnce({ data: { created: false, reason: 'no_salary' }, error: null })

    const outcome = await executeCompleteRecap({
      context: 'profile',
      profile: { id: PROFILE_ID, group_id: null },
      recap: {
        id: RECAP_ID,
        budget_snapshot_data: {},
        project_snapshot_data: { [PROJ_1]: 50, [PROJ_2]: 30 },
      },
    })

    expect(outcome.projectsApplied).toEqual({ updated_count: 2, total_refunded: 80 })
    expect(m.rpc).toHaveBeenNthCalledWith(2, 'apply_recap_projects_snapshot', {
      p_recap_id: RECAP_ID,
      p_allocations: { [PROJ_1]: 50, [PROJ_2]: 30 },
    })
  })

  it('apply_snapshot RPC error → fail-soft (continue to projects + process + salary + mark completed)', async () => {
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    m.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'snapshot boom' } })
      .mockResolvedValueOnce({ data: { updated_count: 0, total_refunded: 0 }, error: null })
      .mockResolvedValueOnce({
        data: { deleted_expenses: 1, deleted_incomes: 0, carried_expenses: 0, carried_incomes: 0 },
        error: null,
      })
      .mockResolvedValueOnce({ data: { created: false, reason: 'no_salary' }, error: null })

    const outcome = await executeCompleteRecap({
      context: 'profile',
      profile: { id: PROFILE_ID, group_id: null },
      recap: { id: RECAP_ID, budget_snapshot_data: { [BUDGET_1]: 10 }, project_snapshot_data: {} },
    })

    expect(outcome.completed).toBe(true)
    expect(outcome.snapshotApplied).toBeNull()
    expect(outcome.transactions.deleted_expenses).toBe(1)
    expect(m.recapsUpdateEq).toHaveBeenCalledTimes(1)
  })

  it('apply_recap_projects_snapshot RPC error → fail-soft (continue to process + salary + mark completed, projectsApplied=null)', async () => {
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    m.rpc
      .mockResolvedValueOnce({ data: { applied: [], reset_count: 0 }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'projects boom' } })
      .mockResolvedValueOnce({
        data: { deleted_expenses: 0, deleted_incomes: 0, carried_expenses: 0, carried_incomes: 0 },
        error: null,
      })
      .mockResolvedValueOnce({ data: { created: false, reason: 'no_salary' }, error: null })

    const outcome = await executeCompleteRecap({
      context: 'profile',
      profile: { id: PROFILE_ID, group_id: null },
      recap: { id: RECAP_ID, budget_snapshot_data: {}, project_snapshot_data: {} },
    })

    expect(outcome.completed).toBe(true)
    expect(outcome.projectsApplied).toBeNull()
    expect(m.recapsUpdateEq).toHaveBeenCalledTimes(1)
  })

  it('group context → DOES NOT call create_salary_income_for_recap (mirror trigger Sprint 16 V3 extended takes over)', async () => {
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    m.rpc
      .mockResolvedValueOnce({ data: { applied: [], reset_count: 0 }, error: null })
      .mockResolvedValueOnce({ data: { updated_count: 0, total_refunded: 0 }, error: null })
      .mockResolvedValueOnce({
        data: { deleted_expenses: 0, deleted_incomes: 0, carried_expenses: 0, carried_incomes: 0 },
        error: null,
      })

    const outcome = await executeCompleteRecap({
      context: 'group',
      profile: { id: PROFILE_ID, group_id: GROUP_ID },
      recap: { id: RECAP_ID, budget_snapshot_data: {}, project_snapshot_data: {} },
    })

    expect(outcome.completed).toBe(true)
    expect(outcome.salaryIncome).toBeNull()
    expect(m.rpc).toHaveBeenCalledTimes(3)
    expect(m.rpc).not.toHaveBeenCalledWith('create_salary_income_for_recap', expect.anything())
  })

  it('process_transactions RPC error → fail-soft (mark completed, zero counts)', async () => {
    const { executeCompleteRecap } = await import('../actions-finalize')
    const m = await getMocks()
    m.rpc
      .mockResolvedValueOnce({ data: { applied: [], reset_count: 0 }, error: null })
      .mockResolvedValueOnce({ data: { updated_count: 0, total_refunded: 0 }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'tx boom' } })

    const outcome = await executeCompleteRecap({
      context: 'group',
      profile: { id: PROFILE_ID, group_id: GROUP_ID },
      recap: { id: RECAP_ID, budget_snapshot_data: {}, project_snapshot_data: {} },
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
    m.rpc
      .mockResolvedValueOnce({ data: { applied: [], reset_count: 0 }, error: null })
      .mockResolvedValueOnce({ data: { updated_count: 0, total_refunded: 0 }, error: null })
      .mockResolvedValueOnce({
        data: { deleted_expenses: 0, deleted_incomes: 0, carried_expenses: 0, carried_incomes: 0 },
        error: null,
      })
      .mockResolvedValueOnce({ data: { created: false, reason: 'no_salary' }, error: null })
    m.recapsUpdateEq.mockResolvedValueOnce({ error: { message: 'completion boom' } })

    await expect(
      executeCompleteRecap({
        context: 'profile',
        profile: { id: PROFILE_ID, group_id: null },
        recap: { id: RECAP_ID, budget_snapshot_data: {}, project_snapshot_data: {} },
      }),
    ).rejects.toMatchObject({ message: 'completion boom' })
  })
})
