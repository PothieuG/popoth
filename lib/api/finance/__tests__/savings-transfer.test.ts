/**
 * Part 50 — `POST /api/finance/savings-transfer`.
 *
 * Seul le solde disponible doit bouger : on épingle le delta passé à
 * `updateBankBalance` (−montant à l'envoi, +montant à la réception), le
 * plafond relu en base (économies des budgets + tirelire) et l'absence de
 * toute autre écriture. Supabase est simulé.
 */

import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const USER_ID = '0679b0f9-830a-44e5-aecf-f8452c8dd101'
const GROUP_ID = '5b1d2c3e-4f50-4a61-8b72-93a4b5c6d7e8'

const { state, ensureBankBalanceRow, updateBankBalance, auth } = vi.hoisted(() => ({
  state: {
    budgets: [] as Array<{ cumulated_savings: number | null }>,
    piggy: null as { amount: number } | null,
    readError: null as { message: string } | null,
    /** Filtres appliqués, par table : `[colonne, valeur]`. */
    filters: [] as Array<[string, string, unknown]>,
    /** Toute écriture hors `updateBankBalance` serait un bug. */
    writes: [] as string[],
  },
  ensureBankBalanceRow: vi.fn(),
  updateBankBalance: vi.fn(),
  auth: { groupId: null as string | null },
}))

vi.mock('@/lib/supabase-server', () => ({
  supabaseServer: {
    from: (table: string) => {
      const result = () => ({
        data: table === 'piggy_bank' ? state.piggy : state.budgets,
        error: state.readError,
      })
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          state.filters.push([table, column, value])
          return builder
        },
        maybeSingle: () => Promise.resolve(result()),
        then: (resolve: (value: unknown) => unknown) => resolve(result()),
        insert: () => {
          state.writes.push(`insert:${table}`)
          return builder
        },
        update: () => {
          state.writes.push(`update:${table}`)
          return builder
        },
      }
      return builder
    },
    rpc: (name: string) => {
      state.writes.push(`rpc:${name}`)
      return Promise.resolve({ data: null, error: null })
    },
  },
}))

vi.mock('@/lib/finance/bank-balance', () => ({
  ensureBankBalanceRow: (...args: unknown[]) => ensureBankBalanceRow(...args),
  updateBankBalance: (...args: unknown[]) => updateBankBalance(...args),
}))

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndGroup: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, { userId: USER_ID, groupId: auth.groupId }),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

function post(body: unknown): NextRequest {
  return new Request('http://x/api/finance/savings-transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

async function call(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import('../savings-transfer')
  const response = (await POST(post(body))) as Response
  return { status: response.status, json: (await response.json()) as Record<string, unknown> }
}

beforeEach(() => {
  // 120 + 80 d'économies de budgets + 50 de tirelire = 250 €.
  state.budgets = [
    { cumulated_savings: 120 },
    { cumulated_savings: 80 },
    { cumulated_savings: null },
  ]
  state.piggy = { amount: 50 }
  state.readError = null
  state.filters = []
  state.writes = []
  auth.groupId = null
  ensureBankBalanceRow.mockResolvedValue(undefined)
  updateBankBalance.mockImplementation(async (_filter: unknown, delta: number) => 1000 + delta)
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('POST /api/finance/savings-transfer — sens du mouvement', () => {
  it('envoi : retire le montant du solde perso et renvoie le nouveau solde', async () => {
    const { status, json } = await call({ context: 'profile', direction: 'send', amount: 100 })

    expect(status).toBe(200)
    expect(json).toEqual({ data: { balance: 900 } })
    expect(ensureBankBalanceRow).toHaveBeenCalledWith({ profile_id: USER_ID })
    expect(updateBankBalance).toHaveBeenCalledWith({ profile_id: USER_ID }, -100)
  })

  it('réception : ajoute le montant au solde perso', async () => {
    const { status, json } = await call({ context: 'profile', direction: 'receive', amount: 100 })

    expect(status).toBe(200)
    expect(json).toEqual({ data: { balance: 1100 } })
    expect(updateBankBalance).toHaveBeenCalledWith({ profile_id: USER_ID }, 100)
  })

  it('ne touche à rien d’autre que le solde (ni économies, ni tirelire, ni transaction)', async () => {
    await call({ context: 'profile', direction: 'send', amount: 100 })

    expect(state.writes).toEqual([])
    expect(updateBankBalance).toHaveBeenCalledTimes(1)
  })

  it('groupe : lit les économies et écrit le solde du groupe', async () => {
    auth.groupId = GROUP_ID
    const { status } = await call({ context: 'group', direction: 'receive', amount: 30 })

    expect(status).toBe(200)
    expect(state.filters).toEqual([
      ['estimated_budgets', 'group_id', GROUP_ID],
      ['piggy_bank', 'group_id', GROUP_ID],
    ])
    expect(ensureBankBalanceRow).toHaveBeenCalledWith({ group_id: GROUP_ID })
    expect(updateBankBalance).toHaveBeenCalledWith({ group_id: GROUP_ID }, 30)
  })

  it('groupe sans groupe : 400, aucune écriture', async () => {
    const { status } = await call({ context: 'group', direction: 'send', amount: 30 })

    expect(status).toBe(400)
    expect(updateBankBalance).not.toHaveBeenCalled()
  })
})

describe('POST /api/finance/savings-transfer — plafond au total des économies', () => {
  it('accepte exactement le total (budgets + tirelire)', async () => {
    const { status } = await call({ context: 'profile', direction: 'send', amount: 250 })

    expect(status).toBe(200)
    expect(state.filters).toEqual([
      ['estimated_budgets', 'profile_id', USER_ID],
      ['piggy_bank', 'profile_id', USER_ID],
    ])
  })

  it.each(['send', 'receive'] as const)(
    '%s : refuse un centime de trop (409)',
    async (direction) => {
      const { status, json } = await call({ context: 'profile', direction, amount: 250.01 })

      expect(status).toBe(409)
      expect(json).toEqual({ error: 'savings-transfer-exceeds-savings' })
      expect(ensureBankBalanceRow).not.toHaveBeenCalled()
      expect(updateBankBalance).not.toHaveBeenCalled()
    },
  )

  it('sans tirelire ni économies : tout montant est refusé', async () => {
    state.budgets = []
    state.piggy = null
    const { status } = await call({ context: 'profile', direction: 'receive', amount: 1 })

    expect(status).toBe(409)
  })
})

describe('POST /api/finance/savings-transfer — erreurs', () => {
  it('corps invalide : 400', async () => {
    const { status } = await call({ context: 'profile', direction: 'send', amount: -5 })

    expect(status).toBe(400)
    expect(updateBankBalance).not.toHaveBeenCalled()
  })

  it('lecture des économies en échec : 500, aucune écriture', async () => {
    state.readError = { message: 'boom' }
    const { status } = await call({ context: 'profile', direction: 'send', amount: 10 })

    expect(status).toBe(500)
    expect(updateBankBalance).not.toHaveBeenCalled()
  })

  it('préparation du solde en échec : 500, aucune écriture', async () => {
    ensureBankBalanceRow.mockRejectedValue(new Error('boom'))
    const { status } = await call({ context: 'profile', direction: 'send', amount: 10 })

    expect(status).toBe(500)
    expect(updateBankBalance).not.toHaveBeenCalled()
  })

  it('écriture du solde en échec : 500', async () => {
    updateBankBalance.mockRejectedValue(new Error('boom'))
    const { status } = await call({ context: 'profile', direction: 'send', amount: 10 })

    expect(status).toBe(500)
  })
})
