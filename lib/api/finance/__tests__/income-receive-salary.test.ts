/**
 * Sprint Salary-Reception (2026-10-02) — `POST /finance/income/real/receive-salary`.
 *
 * L'utilisateur choisit le mois que sa paie finance ; la route vérifie ce
 * choix, puis aiguille vers l'une des deux RPC. Supabase est simulé : on
 * épingle l'AIGUILLAGE et les arguments, pas le SQL (vérifié à part sur la
 * base de test).
 */

import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const USER_ID = '0679b0f9-830a-44e5-aecf-f8452c8dd101'

const { state, rpc, ensureBankBalanceRow, checkRecapStatus } = vi.hoisted(() => ({
  state: {
    profile: { salary: 2752.08 } as { salary: number | null } | null,
    /** Ligne salaire du mois demandé, s'il y en a une. */
    line: null as Record<string, unknown> | null,
    /** Dernier `salary_month` filtré, pour vérifier la requête. */
    queriedMonth: null as unknown,
  },
  rpc: vi.fn(),
  ensureBankBalanceRow: vi.fn(),
  checkRecapStatus: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          if (column === 'salary_month') state.queriedMonth = value
          return builder
        },
        maybeSingle: () =>
          Promise.resolve({
            data: table === 'profiles' ? state.profile : state.line,
            error: null,
          }),
      }
      return builder
    },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

vi.mock('@/lib/finance/bank-balance', () => ({
  ensureBankBalanceRow: (...args: unknown[]) => ensureBankBalanceRow(...args),
}))

vi.mock('@/lib/recap/check-status', () => ({
  checkRecapStatus: (...args: unknown[]) => checkRecapStatus(...args),
}))

// 3 octobre 2026 : le mois du jour est octobre.
vi.mock('@/lib/clock', () => ({
  now: () => new Date(2026, 9, 3, 12, 0, 0),
}))

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndGroup: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, { userId: USER_ID, groupId: 'group-1' }),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

function post(body: unknown): NextRequest {
  return new Request('http://x/api/finance/income/real/receive-salary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

async function call(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import('../income-receive-salary')
  const response = (await POST(post(body))) as Response
  return { status: response.status, json: (await response.json()) as Record<string, unknown> }
}

const rpcOk = (overrides: Record<string, unknown> = {}) => ({
  data: {
    income_id: 'income-1',
    amount: 2760.18,
    expected_salary: 2752.08,
    delta: 8.1,
    delta_applied: false,
    salary_month: '2026-11-01',
    balance: 3042.7,
    ...overrides,
  },
  error: null,
})

/** Récap de septembre terminé → dashboard ouvert, mois ouvert = octobre. */
const recapDone = () =>
  checkRecapStatus.mockResolvedValue({
    status: { kind: 'completed' },
    recapMonth: 9,
    recapYear: 2026,
  })

/** Récap de septembre à faire → mois ouvert = septembre (« Compléter le mois »). */
const recapPending = () =>
  checkRecapStatus.mockResolvedValue({
    status: { kind: 'no_recap' },
    recapMonth: 9,
    recapYear: 2026,
  })

beforeEach(() => {
  state.profile = { salary: 2752.08 }
  state.line = null
  state.queriedMonth = null
  ensureBankBalanceRow.mockResolvedValue(undefined)
  recapDone()
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('POST /finance/income/real/receive-salary', () => {
  it('payé le 3, mois en cours : ligne créée, écart appliqué tout de suite', async () => {
    rpc.mockResolvedValue(rpcOk({ delta_applied: true, salary_month: '2026-10-01' }))

    const { status, json } = await call({
      amount: 2760.18,
      salary_month: '2026-10',
      entry_date: '2026-10-03',
    })

    expect(status).toBe(200)
    expect(state.queriedMonth).toBe('2026-10-01')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('receive_salary', {
      p_profile_id: USER_ID,
      p_amount: 2760.18,
      p_salary_month: '2026-10-01',
      p_entry_date: '2026-10-03',
      p_apply_delta_now: true,
    })
    expect(json.data).toEqual({
      incomeId: 'income-1',
      salaryMonth: '2026-10-01',
      expected: 2752.08,
      received: 2760.18,
      delta: 8.1,
      deltaApplied: true,
      balance: 3042.7,
    })
    expect(ensureBankBalanceRow).toHaveBeenCalledWith({ profile_id: USER_ID })
  })

  it('payé le 28, mois suivant : ligne créée, écart différé à la fin du récap', async () => {
    rpc.mockResolvedValue(rpcOk())

    const { status, json } = await call({
      amount: 2760.18,
      salary_month: '2026-11',
      entry_date: '2026-10-28',
    })

    expect(status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(
      'receive_salary',
      expect.objectContaining({ p_salary_month: '2026-11-01', p_apply_delta_now: false }),
    )
    expect(json.data).toMatchObject({ salaryMonth: '2026-11-01', deltaApplied: false })
  })

  it('pendant le récap de septembre : le mois ouvert est septembre, octobre est « suivant »', async () => {
    recapPending()
    rpc.mockResolvedValue(rpcOk({ salary_month: '2026-10-01' }))

    const october = await call({ amount: 2760.18, salary_month: '2026-10' })
    expect(october.status).toBe(200)
    expect(rpc).toHaveBeenLastCalledWith(
      'receive_salary',
      expect.objectContaining({ p_salary_month: '2026-10-01', p_apply_delta_now: false }),
    )

    const september = await call({ amount: 2760.18, salary_month: '2026-09' })
    expect(september.status).toBe(200)
    expect(rpc).toHaveBeenLastCalledWith(
      'receive_salary',
      expect.objectContaining({ p_salary_month: '2026-09-01', p_apply_delta_now: true }),
    )

    // Novembre n'est ni le mois ouvert ni le suivant tant que le récap n'est pas fait.
    const november = await call({ amount: 2760.18, salary_month: '2026-11' })
    expect(november.status).toBe(400)
    expect(november.json.error).toBe('invalid-salary-month')
  })

  it.each(['2026-09', '2026-12', '2027-10'])(
    'mois %s hors du choix possible (dashboard d’octobre) : 400, aucune RPC',
    async (salary_month) => {
      const { status, json } = await call({ amount: 2760.18, salary_month })

      expect(status).toBe(400)
      expect(json.error).toBe('invalid-salary-month')
      expect(rpc).not.toHaveBeenCalled()
    },
  )

  it('ligne du récap à valider pour ce mois : c’est elle qui est validée', async () => {
    state.line = {
      id: 'salary-line',
      amount: 2752.08,
      recap_origin_id: 'recap-sept',
      applied_to_balance_at: null,
    }
    rpc.mockResolvedValue({ data: { delta: 8.1, balance: 3042.7 }, error: null })

    const { status, json } = await call({ amount: 2760.18, salary_month: '2026-10' })

    expect(status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('validate_salary_with_delta', {
      p_income_id: 'salary-line',
      p_real_amount: 2760.18,
      p_created_by_profile_id: USER_ID,
    })
    expect(json.data).toMatchObject({
      incomeId: 'salary-line',
      salaryMonth: '2026-10-01',
      expected: 2752.08,
      deltaApplied: true,
    })
  })

  it.each([
    ['ligne du récap déjà validée', { recap_origin_id: 'r', applied_to_balance_at: '2026-10-02' }],
    ['réception déjà enregistrée', { recap_origin_id: null, applied_to_balance_at: '2026-09-28' }],
    ['réception retirée du solde', { recap_origin_id: null, applied_to_balance_at: null }],
  ])('salaire déjà enregistré pour ce mois (%s) : 409, aucune RPC', async (_label, line) => {
    state.line = { id: 'line', amount: 2752.08, ...line }

    const { status, json } = await call({ amount: 2760.18, salary_month: '2026-10' })

    expect(status).toBe(409)
    expect(json.error).toBe('salary-already-received')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('pas de salaire déclaré : 409, aucune RPC', async () => {
    state.profile = { salary: 0 }

    const { status, json } = await call({ amount: 1500, salary_month: '2026-10' })

    expect(status).toBe(409)
    expect(json.error).toBe('no-salary-declared')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('deux réceptions simultanées pour le même mois : la seconde reçoit 409', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } })

    const { status, json } = await call({ amount: 2760.18, salary_month: '2026-10' })

    expect(status).toBe(409)
    expect(json.error).toBe('salary-already-received')
  })

  it('erreur RPC inattendue : 500', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } })

    const { status } = await call({ amount: 2760.18, salary_month: '2026-10' })

    expect(status).toBe(500)
  })

  it('date de réception absente : date du jour', async () => {
    rpc.mockResolvedValue(rpcOk())

    await call({ amount: 2760.18, salary_month: '2026-11' })

    expect(rpc).toHaveBeenCalledWith(
      'receive_salary',
      expect.objectContaining({ p_entry_date: '2026-10-03' }),
    )
  })

  it.each([
    { amount: 0, salary_month: '2026-10' },
    { amount: -10, salary_month: '2026-10' },
    { amount: 10.123, salary_month: '2026-10' },
    { amount: 100 },
    { amount: 100, salary_month: '2026-13' },
    { amount: 100, salary_month: 'octobre' },
    { amount: 100, salary_month: '2026-10', entry_date: '28/09' },
    {},
  ])('corps invalide %j : 400, aucune RPC', async (body) => {
    const { status } = await call(body)

    expect(status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
})
