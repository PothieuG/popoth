/**
 * Sprint Perf-Toggle-Targeted-Refresh (2026-09-10) — plan de requêtes des 2
 * routes groupe appelées par l'en-tête des dashboards (`useGroups`,
 * `useGroupContributions`) et relancées par chaque mutation via
 * `invalidateFinancialRefreshes`.
 *
 * Chacune enchaînait 2 lectures EN SÉRIE qui ne dépendent que de
 * `profile.group_id` (déjà en main via `withAuthAndProfile`) : groupe puis
 * COUNT des membres, groupe puis contributions. Elles partent désormais en
 * parallèle. La mesure : le nombre maximal de requêtes simultanément en vol —
 * 1 en série, 2 en parallèle. Déterministe, contrairement à un chrono.
 */

import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const STATE: { value: Record<string, Row[]> } = { value: {} }
const PROBE = { inFlight: 0, maxInFlight: 0, headCounts: 0, fromCalls: [] as string[] }

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndProfile: (handler: AnyHandler) => async (request: NextRequest, rc?: unknown) =>
      handler(
        request,
        {
          userId: 'user-1',
          profile: { id: 'user-1', group_id: 'group-1', first_name: 'T', last_name: 'U' },
        },
        rc,
      ),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

vi.mock('@/lib/session-server', () => ({ updateSessionGroup: async () => {} }))

vi.mock('@/lib/supabase-server', () => {
  function makeBuilder(table: string) {
    const filters: { key: string; value: unknown }[] = []
    let head = false
    const builder: Record<string, unknown> = {}

    const rows = () =>
      (STATE.value[table] ?? []).filter((row) => filters.every((f) => row[f.key] === f.value))

    // Chaque requête « vole » 5 ms : le compteur mesure le recouvrement.
    const resolveLater = <T>(value: T): Promise<T> =>
      new Promise((resolve) => {
        PROBE.inFlight += 1
        PROBE.maxInFlight = Math.max(PROBE.maxInFlight, PROBE.inFlight)
        setTimeout(() => {
          PROBE.inFlight -= 1
          resolve(value)
        }, 5)
      })

    builder.select = (_cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) {
        head = true
        PROBE.headCounts += 1
      }
      return builder
    }
    builder.eq = (key: string, value: unknown) => {
      filters.push({ key, value })
      return builder
    }
    builder.order = () => builder
    builder.single = () => resolveLater({ data: rows()[0] ?? null, error: null })
    // `then` reste une fonction simple, jamais un `vi.fn()` (CLAUDE.md §9).
    builder.then = (cb: (v: { data: Row[] | null; error: null; count: number }) => void) => {
      const r = rows()
      resolveLater({ data: head ? null : r, error: null, count: r.length }).then(cb)
    }
    return builder
  }

  return {
    supabaseServer: {
      from: (table: string) => {
        PROBE.fromCalls.push(table)
        return makeBuilder(table)
      },
    },
  }
})

function req(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest
}

beforeEach(() => {
  STATE.value = {
    groups: [
      {
        id: 'group-1',
        name: 'Famille',
        monthly_budget_estimate: 1200,
        creator_id: 'user-1',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ],
    profiles: [
      { id: 'user-1', group_id: 'group-1' },
      { id: 'user-2', group_id: 'group-1' },
    ],
    group_contributions: [
      {
        id: 'c1',
        profile_id: 'user-1',
        group_id: 'group-1',
        salary: 2000,
        contribution_amount: 800,
        contribution_percentage: 40,
        calculated_at: null,
        profiles: { first_name: 'T', last_name: 'U' },
      },
      {
        id: 'c2',
        profile_id: 'user-2',
        group_id: 'group-1',
        salary: 1000,
        contribution_amount: 400,
        contribution_percentage: 40,
        calculated_at: null,
        profiles: { first_name: 'V', last_name: 'W' },
      },
    ],
  }
  PROBE.inFlight = 0
  PROBE.maxInFlight = 0
  PROBE.headCounts = 0
  PROBE.fromCalls = []
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('routes groupe — plan de requêtes', () => {
  it('GET /api/groups : groupe + COUNT des membres en parallèle, COUNT sans lignes', async () => {
    const { GET } = await import('../route')

    const res = await GET(req('http://x/api/groups'))
    const body = (await (res as Response).json()) as { groups: { member_count: number }[] }

    expect(PROBE.fromCalls).toEqual(['groups', 'profiles'])
    // 2 requêtes en vol en même temps : elles ne s'attendent plus.
    expect(PROBE.maxInFlight).toBe(2)
    // Le COUNT ne rapatrie plus les profils (`head: true`).
    expect(PROBE.headCounts).toBe(1)
    expect(body.groups[0]?.member_count).toBe(2)
  })

  it('GET /api/groups/contributions : groupe + contributions en parallèle', async () => {
    const { GET } = await import('../contributions/route')

    const res = await GET(req('http://x/api/groups/contributions'))
    const body = (await (res as Response).json()) as {
      contributions: { profile_id: string }[]
      group_info: { total_contributions: number; total_salaries: number }
    }

    expect(PROBE.fromCalls).toEqual(['groups', 'group_contributions'])
    expect(PROBE.maxInFlight).toBe(2)
    expect(body.contributions).toHaveLength(2)
    expect(body.group_info.total_contributions).toBe(1200)
    expect(body.group_info.total_salaries).toBe(3000)
  })
})
