/**
 * Mocked unit tests for `applyRecoveryDecision` + `loadRecoverySnapshot`
 * — Sprint Refactor-Recover.
 *
 * Pins the orchestration contract that the gated caract tests can't
 * easily cover at scale: per-action dispatch (restore_table vs
 * update_bank_balance_v1), fail-soft per-action error accumulation into
 * `RecoveryResults.errors[]`, snapshot deactivation fail-soft via
 * logger.warn, CLEANUP-ATTEMPT CRITIQUE preservation (logger.error +
 * RecoveryAppliedPartiallyError carry), strict boolean invariant for
 * bank/piggy, loader error mapping (NotFound / Corrupted / Context).
 *
 * Mock strategy mirrors lib/recap/__tests__/complete-persist.test.ts:
 * `vi.mock` hoisted with a __mocks registry on the supabaseServer mock,
 * dynamic `await import` of the SUT inside test bodies so the mocks
 * are installed before module load. Chain supports
 * `.select(...).eq(...).order(...).limit(...).single()`,
 * `.delete().eq(...)`, `.insert(...)` (direct await),
 * `.update(...).eq(...)` (direct await).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ProcessRecoveryDecision,
  ProcessRecoveryInput,
  RestorableTable,
  RestorationAction,
  ResultKey,
} from '@/lib/recap/recover-types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase-server', () => {
  // Top-level terminal vi.fns the tests queue responses on.
  const single = vi.fn(async () => ({ data: null, error: null }))
  const insertAwait = vi.fn(async () => ({ data: null, error: null }))
  const updateAwait = vi.fn(async () => ({ data: null, error: null }))
  const deleteAwait = vi.fn(async () => ({ data: null, error: null }))

  // updateEqChain is what chain.update(...) returns. .eq returns same.
  // Thenable for direct `await update().eq(...)`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thenable + chainable
  const updateEqChain: any = {}
  updateEqChain.eq = vi.fn(() => updateEqChain)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary onResolve/onReject signatures
  updateEqChain.then = (onResolve: any, onReject: any) => updateAwait().then(onResolve, onReject)

  // deleteEqChain is what chain.delete() returns. .eq returns same. Thenable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thenable + chainable
  const deleteEqChain: any = {}
  deleteEqChain.eq = vi.fn(() => deleteEqChain)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteEqChain.then = (onResolve: any, onReject: any) => deleteAwait().then(onResolve, onReject)

  // insertChain is what chain.insert(...) returns. Thenable for direct await.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertChain: any = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insertChain.then = (onResolve: any, onReject: any) => insertAwait().then(onResolve, onReject)

  // Top-level chain returned by from(...). Chainable.
  // .order + .limit return the chain itself (terminal is .single() which
  // hits the top-level `single` vi.fn).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.single = single
  chain.insert = vi.fn(() => insertChain)
  chain.update = vi.fn(() => updateEqChain)
  chain.delete = vi.fn(() => deleteEqChain)

  const from = vi.fn(() => chain)
  return {
    supabaseServer: { from },
    __mocks: {
      from,
      single,
      insertAwait,
      updateAwait,
      deleteAwait,
      chainSelect: chain.select,
      chainEq: chain.eq,
      chainOrder: chain.order,
      chainLimit: chain.limit,
      chainInsert: chain.insert,
      chainUpdate: chain.update,
      chainDelete: chain.delete,
    },
  }
})

beforeEach(() => {
  // logger.warn / logger.error route through console under the hood; silence.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInput(overrides: Partial<ProcessRecoveryInput> = {}): ProcessRecoveryInput {
  return {
    userId: 'user-1',
    context: 'profile',
    contextId: 'profile-1',
    ownerField: 'profile_id',
    currentDate: new Date('2026-05-16T12:00:00.000Z'),
    ...overrides,
  }
}

function buildDecision(
  actions: RestorationAction[] = [],
  snapshotRowId = 'snap-row-1',
): ProcessRecoveryDecision {
  return { actions, snapshotRowId }
}

function restoreAction(
  table: RestorableTable,
  rows: unknown[],
  resultKey: ResultKey,
): RestorationAction {
  return { kind: 'restore_table', table, rows, resultKey }
}

function bankV1Action(amount: number): RestorationAction {
  return { kind: 'update_bank_balance_v1', amount }
}

type SupabaseMockMod = {
  __mocks: {
    from: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
    insertAwait: ReturnType<typeof vi.fn>
    updateAwait: ReturnType<typeof vi.fn>
    deleteAwait: ReturnType<typeof vi.fn>
    chainInsert: ReturnType<typeof vi.fn>
    chainUpdate: ReturnType<typeof vi.fn>
    chainDelete: ReturnType<typeof vi.fn>
    chainSelect: ReturnType<typeof vi.fn>
    chainEq: ReturnType<typeof vi.fn>
    chainOrder: ReturnType<typeof vi.fn>
    chainLimit: ReturnType<typeof vi.fn>
  }
}

// ---------------------------------------------------------------------------
// applyRecoveryDecision tests
// ---------------------------------------------------------------------------

describe('applyRecoveryDecision — happy paths', () => {
  it('V1 happy: 4 restore_table + 1 update_bank_balance_v1 → 5 results populated + snapshot deactivated', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    const { applyRecoveryDecision } = await import('@/lib/recap/recover-persist')

    const decision = buildDecision(
      [
        restoreAction('estimated_incomes', [{ id: 'i-1' }], 'estimated_incomes'),
        restoreAction('estimated_budgets', [{ id: 'b-1' }, { id: 'b-2' }], 'estimated_budgets'),
        restoreAction('real_income_entries', [{ id: 'rie-1' }], 'real_incomes'),
        restoreAction('real_expenses', [{ id: 'rex-1' }], 'real_expenses'),
        bankV1Action(1234),
      ],
      'snap-v1',
    )

    const results = await applyRecoveryDecision(buildInput(), decision)

    expect(results.errors).toEqual([])
    expect(results.estimated_incomes).toBe(1)
    expect(results.estimated_budgets).toBe(2)
    expect(results.real_incomes).toBe(1)
    expect(results.real_expenses).toBe(1)
    expect(results.bank_balance).toStrictEqual(true) // strict boolean
    expect(results.piggy_bank).toStrictEqual(false) // init preserved
    expect(results.budget_transfers).toBe(0)

    // 4 restore tables → 4 deletes + 4 inserts; 1 v1 update → 1 update;
    // step 8 deactivate snapshot → 1 update; total 2 updates.
    expect(supabaseMock.__mocks.deleteAwait).toHaveBeenCalledTimes(4)
    expect(supabaseMock.__mocks.insertAwait).toHaveBeenCalledTimes(4)
    expect(supabaseMock.__mocks.updateAwait).toHaveBeenCalledTimes(2)
  })

  it('V2 happy: 7 restore_table → all counts/booleans populated + snapshot deactivated', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    const { applyRecoveryDecision } = await import('@/lib/recap/recover-persist')

    const decision = buildDecision(
      [
        restoreAction('estimated_incomes', [{ id: 'i-1' }], 'estimated_incomes'),
        restoreAction('estimated_budgets', [{ id: 'b-1' }], 'estimated_budgets'),
        restoreAction('real_income_entries', [{ id: 'rie-1' }, { id: 'rie-2' }], 'real_incomes'),
        restoreAction('real_expenses', [{ id: 'rex-1' }], 'real_expenses'),
        restoreAction('bank_balances', [{ id: 'bb-1' }], 'bank_balance'),
        restoreAction('piggy_bank', [{ id: 'pg-1' }], 'piggy_bank'),
        restoreAction('budget_transfers', [{ id: 'bt-1' }, { id: 'bt-2' }], 'budget_transfers'),
      ],
      'snap-v2',
    )

    const results = await applyRecoveryDecision(buildInput(), decision)

    expect(results.errors).toEqual([])
    expect(results.estimated_incomes).toBe(1)
    expect(results.estimated_budgets).toBe(1)
    expect(results.real_incomes).toBe(2)
    expect(results.real_expenses).toBe(1)
    expect(results.bank_balance).toStrictEqual(true) // strict boolean — NOT 1
    expect(results.piggy_bank).toStrictEqual(true) // strict boolean — NOT 1
    expect(results.budget_transfers).toBe(2)

    // 7 restores → 7 deletes + 7 inserts; 0 v1 update; 1 deactivate = 1 update.
    expect(supabaseMock.__mocks.deleteAwait).toHaveBeenCalledTimes(7)
    expect(supabaseMock.__mocks.insertAwait).toHaveBeenCalledTimes(7)
    expect(supabaseMock.__mocks.updateAwait).toHaveBeenCalledTimes(1)
  })

  it('empty decision (0 actions) → init results + snapshot still deactivated', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    const { applyRecoveryDecision } = await import('@/lib/recap/recover-persist')

    const results = await applyRecoveryDecision(buildInput(), buildDecision([]))

    expect(results).toEqual({
      estimated_incomes: 0,
      estimated_budgets: 0,
      real_incomes: 0,
      real_expenses: 0,
      bank_balance: false,
      piggy_bank: false,
      budget_transfers: 0,
      errors: [],
    })
    expect(supabaseMock.__mocks.deleteAwait).not.toHaveBeenCalled()
    expect(supabaseMock.__mocks.insertAwait).not.toHaveBeenCalled()
    // Snapshot deactivation still fires (step 8 always)
    expect(supabaseMock.__mocks.updateAwait).toHaveBeenCalledTimes(1)
  })

  it('update_bank_balance_v1 only → strict boolean true assigned via v1 path', async () => {
    const { applyRecoveryDecision } = await import('@/lib/recap/recover-persist')
    const decision = buildDecision([bankV1Action(500)], 'snap-1')

    const results = await applyRecoveryDecision(buildInput(), decision)

    expect(results.bank_balance).toStrictEqual(true) // CRITICAL strict boolean
    expect(results.piggy_bank).toStrictEqual(false) // init preserved
    expect(results.errors).toEqual([])
  })
})

describe('applyRecoveryDecision — fail-soft per-action', () => {
  it('DELETE fails on first table → errors[] push + 2nd table still attempted', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    const { applyRecoveryDecision } = await import('@/lib/recap/recover-persist')

    // 1st DELETE fails, 2nd-3rd-4th succeed, step8 deactivate succeeds
    supabaseMock.__mocks.deleteAwait
      .mockResolvedValueOnce({ data: null, error: { message: 'simulated incomes delete fail' } })
      .mockResolvedValueOnce({ data: null, error: null })

    const decision = buildDecision([
      restoreAction('estimated_incomes', [{ id: 'i-1' }], 'estimated_incomes'),
      restoreAction('estimated_budgets', [{ id: 'b-1' }], 'estimated_budgets'),
    ])

    const results = await applyRecoveryDecision(buildInput(), decision)

    expect(results.errors).toHaveLength(1)
    expect(results.errors[0]).toMatch(/Erreur suppression estimated_incomes/)
    expect(results.estimated_incomes).toBe(0) // failed → not populated
    expect(results.estimated_budgets).toBe(1) // succeeded → count
    // Both deletes attempted; only 1 insert (the successful budgets one,
    // because the failed estimated_incomes delete short-circuits insert)
    expect(supabaseMock.__mocks.deleteAwait).toHaveBeenCalledTimes(2)
    expect(supabaseMock.__mocks.insertAwait).toHaveBeenCalledTimes(1)
  })

  it('INSERT fails on first table → errors[] push + 2nd table still attempted', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    const { applyRecoveryDecision } = await import('@/lib/recap/recover-persist')

    // Both deletes succeed; 1st INSERT fails, 2nd succeeds
    supabaseMock.__mocks.insertAwait
      .mockResolvedValueOnce({ data: null, error: { message: 'simulated incomes insert fail' } })
      .mockResolvedValueOnce({ data: null, error: null })

    const decision = buildDecision([
      restoreAction('estimated_incomes', [{ id: 'i-1' }], 'estimated_incomes'),
      restoreAction('estimated_budgets', [{ id: 'b-1' }], 'estimated_budgets'),
    ])

    const results = await applyRecoveryDecision(buildInput(), decision)

    expect(results.errors).toHaveLength(1)
    expect(results.errors[0]).toMatch(/Erreur restauration estimated_incomes/)
    expect(results.estimated_incomes).toBe(0) // failed
    expect(results.estimated_budgets).toBe(1) // succeeded
  })

  it('update_bank_balance_v1 fails → errors[] push + bank_balance stays false', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    const { applyRecoveryDecision } = await import('@/lib/recap/recover-persist')

    // 1st UPDATE = v1 bank update (fails); 2nd UPDATE = step8 deactivate (succeeds)
    supabaseMock.__mocks.updateAwait
      .mockResolvedValueOnce({ data: null, error: { message: 'simulated bank update fail' } })
      .mockResolvedValueOnce({ data: null, error: null })

    const decision = buildDecision([bankV1Action(500)])
    const results = await applyRecoveryDecision(buildInput(), decision)

    expect(results.errors).toHaveLength(1)
    expect(results.errors[0]).toMatch(/Erreur restauration solde bancaire/)
    expect(results.bank_balance).toStrictEqual(false) // failed → init preserved
  })
})

describe('applyRecoveryDecision — CLEANUP-ATTEMPT CRITIQUE preservation', () => {
  it('unexpected exception in apply loop → logger.error + throws RecoveryAppliedPartiallyError carrying partialResults', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    const loggerMod = await import('@/lib/logger')
    const errorSpy = vi.spyOn(loggerMod.logger, 'error').mockImplementation(() => {})

    const { applyRecoveryDecision } = await import('@/lib/recap/recover-persist')
    const { RecoveryAppliedPartiallyError } = await import('@/lib/recap/recover-types')

    // 1st action succeeds (delete OK + insert OK), 2nd action throws on delete.
    supabaseMock.__mocks.deleteAwait
      .mockResolvedValueOnce({ data: null, error: null })
      .mockRejectedValueOnce(new Error('Supabase client crashed mid-flight'))

    const decision = buildDecision([
      restoreAction('estimated_incomes', [{ id: 'i-1' }], 'estimated_incomes'),
      restoreAction('estimated_budgets', [{ id: 'b-1' }], 'estimated_budgets'),
    ])

    let caught: unknown = null
    try {
      await applyRecoveryDecision(buildInput(), decision)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(RecoveryAppliedPartiallyError)
    expect(
      (caught as InstanceType<typeof RecoveryAppliedPartiallyError>).partialResults,
    ).toMatchObject({
      estimated_incomes: 1, // 1st action succeeded → captured in partialResults
      estimated_budgets: 0, // 2nd action threw before assigning
    })

    // CLEANUP-ATTEMPT CRITIQUE log fired (grep-able for ops investigation)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[recover] rollback partiel impossible'),
      expect.anything(),
    )
  })
})

describe('applyRecoveryDecision — step 8 snapshot deactivation fail-soft', () => {
  it('snapshot deactivation UPDATE fails → logger.warn + flow returns normally', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    const loggerMod = await import('@/lib/logger')
    const warnSpy = vi.spyOn(loggerMod.logger, 'warn').mockImplementation(() => {})

    const { applyRecoveryDecision } = await import('@/lib/recap/recover-persist')

    // No restore actions; only step 8 deactivation. updateAwait returns error.
    supabaseMock.__mocks.updateAwait.mockResolvedValueOnce({
      data: null,
      error: { message: 'simulated deactivate fail' },
    })

    const results = await applyRecoveryDecision(buildInput(), buildDecision([]))

    // Flow returns normally — no error pushed (it's a warn, not a hard error)
    expect(results.errors).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[recover] erreur désactivation snapshot'),
      expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// loadRecoverySnapshot tests
// ---------------------------------------------------------------------------

describe('loadRecoverySnapshot — happy paths + error mapping', () => {
  it('happy: returns ProcessRecoverySnapshot with parsed payload', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: {
        id: 'snap-row-1',
        snapshot_data: {
          snapshot_version: 2,
          context: 'profile',
          created_at: '2026-05-16T12:00:00Z',
          profiles: [],
          estimated_incomes: [{ id: 'i-1' }],
          estimated_budgets: [{ id: 'b-1' }],
          real_income_entries: [],
          real_expenses: [],
          bank_balances: [],
          bank_balance: null,
          piggy_bank: [],
          remaining_to_live_snapshots: [],
          budget_transfers: [],
          monthly_recaps: [],
          _table_counts: {},
        },
        created_at: '2026-05-16T12:34:56Z',
      },
      error: null,
    })

    const { loadRecoverySnapshot } = await import('@/lib/recap/recover-persist')
    const snapshot = await loadRecoverySnapshot(buildInput())

    expect(snapshot.snapshotRowId).toBe('snap-row-1')
    expect(snapshot.snapshotCreatedAt).toBe('2026-05-16T12:34:56Z')
    expect(snapshot.payload.estimated_incomes).toHaveLength(1)
    expect(snapshot.payload.estimated_budgets).toHaveLength(1)
  })

  it('with snapshotId → builds .eq("id", snapshotId) query path', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: {
        id: 'snap-explicit',
        snapshot_data: {
          snapshot_version: 1,
          estimated_incomes: [{ id: 'i-1' }],
          estimated_budgets: [{ id: 'b-1' }],
          real_income_entries: [],
          real_expenses: [],
          bank_balance: 100,
        },
        created_at: '2026-05-16T10:00:00Z',
      },
      error: null,
    })

    const { loadRecoverySnapshot } = await import('@/lib/recap/recover-persist')
    await loadRecoverySnapshot(buildInput({ snapshotId: 'snap-explicit' }))

    // chain.eq() called for: profile_id, snapshot_month, snapshot_year, id (4×)
    expect(supabaseMock.__mocks.chainEq).toHaveBeenCalledTimes(4)
    expect(supabaseMock.__mocks.chainEq).toHaveBeenCalledWith('id', 'snap-explicit')
    // chain.order NOT called (snapshotId path skips order/limit)
    expect(supabaseMock.__mocks.chainOrder).not.toHaveBeenCalled()
    expect(supabaseMock.__mocks.chainLimit).not.toHaveBeenCalled()
  })

  it('without snapshotId → builds .order().limit(1) query path', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: {
        id: 'snap-most-recent',
        snapshot_data: {
          snapshot_version: 1,
          estimated_incomes: [{ id: 'i-1' }],
          estimated_budgets: [{ id: 'b-1' }],
          real_income_entries: [],
          real_expenses: [],
          bank_balance: 100,
        },
        created_at: '2026-05-16T10:00:00Z',
      },
      error: null,
    })

    const { loadRecoverySnapshot } = await import('@/lib/recap/recover-persist')
    await loadRecoverySnapshot(buildInput())

    // chain.eq() called for: profile_id, snapshot_month, snapshot_year (3×)
    expect(supabaseMock.__mocks.chainEq).toHaveBeenCalledTimes(3)
    // chain.order + chain.limit called
    expect(supabaseMock.__mocks.chainOrder).toHaveBeenCalledWith('created_at', {
      ascending: false,
    })
    expect(supabaseMock.__mocks.chainLimit).toHaveBeenCalledWith(1)
  })

  it('no snapshot found → throws RecoverSnapshotNotFoundError (404 path)', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'PGRST116: no rows' },
    })

    const { loadRecoverySnapshot } = await import('@/lib/recap/recover-persist')
    const { RecoverSnapshotNotFoundError } = await import('@/lib/recap/recover-types')

    await expect(loadRecoverySnapshot(buildInput())).rejects.toThrow(RecoverSnapshotNotFoundError)
  })

  it('snapshot_data missing estimated_incomes → throws RecoverSnapshotCorruptedError (500 path)', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: {
        id: 'snap-bad',
        snapshot_data: {
          snapshot_version: 1,
          // estimated_incomes intentionally missing
          estimated_budgets: [{ id: 'b-1' }],
          real_income_entries: [],
          real_expenses: [],
          bank_balance: 100,
        },
        created_at: '2026-05-16T10:00:00Z',
      },
      error: null,
    })

    const { loadRecoverySnapshot } = await import('@/lib/recap/recover-persist')
    const { RecoverSnapshotCorruptedError } = await import('@/lib/recap/recover-types')

    await expect(loadRecoverySnapshot(buildInput())).rejects.toThrow(RecoverSnapshotCorruptedError)
  })

  it('snapshot_data null → throws RecoverSnapshotCorruptedError', async () => {
    const supabaseMock = (await import('@/lib/supabase-server')) as unknown as SupabaseMockMod
    supabaseMock.__mocks.single.mockResolvedValueOnce({
      data: {
        id: 'snap-null',
        snapshot_data: null,
        created_at: '2026-05-16T10:00:00Z',
      },
      error: null,
    })

    const { loadRecoverySnapshot } = await import('@/lib/recap/recover-persist')
    const { RecoverSnapshotCorruptedError } = await import('@/lib/recap/recover-types')

    await expect(loadRecoverySnapshot(buildInput())).rejects.toThrow(RecoverSnapshotCorruptedError)
  })

  it('context=group + contextId missing → throws RecoverContextError (400 path)', async () => {
    const { loadRecoverySnapshot } = await import('@/lib/recap/recover-persist')
    const { RecoverContextError } = await import('@/lib/recap/recover-types')

    await expect(
      loadRecoverySnapshot(buildInput({ context: 'group', contextId: '', ownerField: 'group_id' })),
    ).rejects.toThrow(RecoverContextError)
  })
})
