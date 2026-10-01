/**
 * Sprint Salary-Reception (2026-10-02) — `POST /finance/income/real/receive-salary`.
 *
 * La route choisit entre deux RPC selon l'état des lignes salaire du compte.
 * Supabase est simulé : on épingle l'AIGUILLAGE et les arguments, pas le SQL
 * (vérifié à part sur la base de test).
 */

import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const USER_ID = '0679b0f9-830a-44e5-aecf-f8452c8dd101'

const { state, rpc, ensureBankBalanceRow } = vi.hoisted(() => ({
  state: {
    profile: { salary: 2752.08 } as { salary: number | null } | null,
    salaryRows: [] as Array<Record<string, unknown>>,
  },
  rpc: vi.fn(),
  ensureBankBalanceRow: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        order: () => Promise.resolve({ data: state.salaryRows, error: null }),
        maybeSingle: () =>
          Promise.resolve({ data: table === 'profiles' ? state.profile : null, error: null }),
      }
      return builder
    },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

vi.mock('@/lib/finance/bank-balance', () => ({
  ensureBankBalanceRow: (...args: unknown[]) => ensureBankBalanceRow(...args),
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

beforeEach(() => {
  state.profile = { salary: 2752.08 }
  state.salaryRows = []
  ensureBankBalanceRow.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('POST /finance/income/real/receive-salary', () => {
  it('aucune ligne salaire : la paie finance le mois suivant (receive_salary_in_advance)', async () => {
    rpc.mockResolvedValue({
      data: {
        income_id: 'income-1',
        amount: 2760.18,
        expected_salary: 2752.08,
        delta: 8.1,
        balance: 3042.7,
      },
      error: null,
    })

    const { status, json } = await call({ amount: 2760.18, entry_date: '2026-09-28' })

    expect(status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('receive_salary_in_advance', {
      p_profile_id: USER_ID,
      p_amount: 2760.18,
      p_entry_date: '2026-09-28',
    })
    expect(json.data).toEqual({
      mode: 'advance',
      incomeId: 'income-1',
      expected: 2752.08,
      received: 2760.18,
      delta: 8.1,
      balance: 3042.7,
    })
    expect(ensureBankBalanceRow).toHaveBeenCalledWith({ profile_id: USER_ID })
  })

  it('ligne salaire du mois à valider : c’est elle qui est validée (validate_salary_with_delta)', async () => {
    state.salaryRows = [
      {
        id: 'salary-line',
        amount: 2752.08,
        entry_date: '2026-10-01',
        recap_origin_id: 'recap-sept',
        applied_to_balance_at: null,
        salary_reception: null,
      },
    ]
    rpc.mockResolvedValue({ data: { delta: 8.1, balance: 3042.7 }, error: null })

    const { status, json } = await call({ amount: 2760.18 })

    expect(status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('validate_salary_with_delta', {
      p_income_id: 'salary-line',
      p_real_amount: 2760.18,
      p_created_by_profile_id: USER_ID,
    })
    expect(json.data).toMatchObject({ mode: 'current', incomeId: 'salary-line', expected: 2752.08 })
  })

  it('ligne salaire du mois déjà validée : retour au cas « mois suivant »', async () => {
    state.salaryRows = [
      {
        id: 'salary-line',
        amount: 2752.08,
        entry_date: '2026-09-01',
        recap_origin_id: 'recap-aout',
        applied_to_balance_at: '2026-09-02T08:00:00Z',
        salary_reception: null,
      },
    ]
    rpc.mockResolvedValue({
      data: { income_id: 'i', amount: 2752.08, expected_salary: 2752.08, delta: 0, balance: 1 },
      error: null,
    })

    await call({ amount: 2752.08 })

    expect(rpc).toHaveBeenCalledWith('receive_salary_in_advance', expect.anything())
  })

  it('réception déjà en attente : 409, aucune RPC', async () => {
    state.salaryRows = [
      {
        id: 'reception',
        amount: 2760.18,
        entry_date: '2026-09-28',
        recap_origin_id: null,
        applied_to_balance_at: '2026-09-28T07:57:00Z',
        salary_reception: true,
      },
    ]

    const { status, json } = await call({ amount: 2760.18 })

    expect(status).toBe(409)
    expect(json.error).toBe('salary-already-received')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('pas de salaire déclaré : 409, aucune RPC', async () => {
    state.profile = { salary: 0 }

    const { status, json } = await call({ amount: 1500 })

    expect(status).toBe(409)
    expect(json.error).toBe('no-salary-declared')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('deux réceptions simultanées : l’index unique fait répondre 409 à la seconde', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } })

    const { status, json } = await call({ amount: 2760.18 })

    expect(status).toBe(409)
    expect(json.error).toBe('salary-already-received')
  })

  it('erreur RPC inattendue : 500', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } })

    const { status } = await call({ amount: 2760.18 })

    expect(status).toBe(500)
  })

  it.each([
    { amount: 0 },
    { amount: -10 },
    { amount: 10.123 },
    {},
    { amount: 100, entry_date: '28/09' },
  ])('corps invalide %j : 400, aucune RPC', async (body) => {
    const { status } = await call(body)

    expect(status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
})
