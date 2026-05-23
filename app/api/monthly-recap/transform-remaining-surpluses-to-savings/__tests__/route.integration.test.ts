/**
 * Integration tests for POST /api/monthly-recap/transform-remaining-surpluses-to-savings
 * (Sprint 06 Monthly Recap V3 — positive flow action 2). Gated by
 * `SUPABASE_RECAP_TESTS=1`. Mirrors the sibling test file for
 * transfer-surpluses-to-piggy, but verifies the cumulated_savings increment
 * pattern + the state machine advance to 'salary_update'.
 */

import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/database.types'

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

interface MockedAuth {
  userId: string
  groupId: string | null
}
const mockedAuth: MockedAuth = { userId: '', groupId: null }

vi.mock('@/lib/api/with-auth', () => {
  type AnyHandler = (...args: unknown[]) => Promise<unknown>
  return {
    withAuthAndProfile: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, {
        userId: mockedAuth.userId,
        profile: {
          id: mockedAuth.userId,
          group_id: mockedAuth.groupId,
          first_name: 'Test',
          last_name: 'User',
        },
      }),
    withAuth: (handler: AnyHandler) => async (request: NextRequest) =>
      handler(request, { userId: mockedAuth.userId }),
  }
})

describe.skipIf(!ENABLED)(
  'POST /api/monthly-recap/transform-remaining-surpluses-to-savings (gated)',
  () => {
    let admin: SupabaseClient<Database>
    let POST: (req: NextRequest) => Promise<Response>

    let userAId: string
    let userBId: string
    let groupAId: string

    const stamp = Date.now()
    const emailA = `recap-trts-a-${stamp}@popoth.test`
    const emailB = `recap-trts-b-${stamp}@popoth.test`

    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()

    beforeAll(async () => {
      if (!SUPABASE_URL || !SERVICE_KEY) {
        throw new Error(
          'Recap transform-remaining tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
        )
      }

      const mod =
        await import('@/app/api/monthly-recap/transform-remaining-surpluses-to-savings/route')
      POST = mod.POST as (req: NextRequest) => Promise<Response>

      admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })

      const [a, b] = await Promise.all([
        admin.auth.admin.createUser({
          email: emailA,
          password: randomUUID(),
          email_confirm: true,
        }),
        admin.auth.admin.createUser({
          email: emailB,
          password: randomUUID(),
          email_confirm: true,
        }),
      ])
      if (a.error || !a.data.user) throw a.error
      if (b.error || !b.data.user) throw b.error
      userAId = a.data.user.id
      userBId = b.data.user.id

      const { data: group, error: groupError } = await admin
        .from('groups')
        .insert({
          name: `recap-trts-group-${stamp}`,
          monthly_budget_estimate: 0,
          creator_id: userAId,
        })
        .select('id')
        .single()
      if (groupError || !group) throw groupError ?? new Error('group insert returned no row')
      groupAId = group.id

      const { error: profilesError } = await admin.from('profiles').upsert(
        [
          { id: userAId, first_name: 'Alice', last_name: 'Aaaa', group_id: groupAId },
          { id: userBId, first_name: 'Bob', last_name: 'Bbbb', group_id: groupAId },
        ],
        { onConflict: 'id' },
      )
      if (profilesError) throw profilesError
    })

    afterEach(async () => {
      await resetState()
    })

    afterAll(async () => {
      if (admin) {
        await resetState()
        if (groupAId) await admin.from('groups').delete().eq('id', groupAId)
        if (userAId) await admin.from('profiles').update({ group_id: null }).eq('id', userAId)
        if (userBId) await admin.from('profiles').update({ group_id: null }).eq('id', userBId)
        if (userAId) await admin.auth.admin.deleteUser(userAId)
        if (userBId) await admin.auth.admin.deleteUser(userBId)
      }
    })

    async function resetState() {
      if (userAId) {
        await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
        await admin.from('real_expenses').delete().eq('profile_id', userAId)
        await admin.from('estimated_budgets').delete().eq('profile_id', userAId)
        await admin.from('piggy_bank').delete().eq('profile_id', userAId)
      }
      if (groupAId) {
        await admin.from('monthly_recaps').delete().eq('group_id', groupAId)
        await admin.from('real_expenses').delete().eq('group_id', groupAId)
        await admin.from('estimated_budgets').delete().eq('group_id', groupAId)
        await admin.from('piggy_bank').delete().eq('group_id', groupAId)
      }
    }

    function buildRequest(body: unknown): NextRequest {
      return new Request(
        'http://localhost/api/monthly-recap/transform-remaining-surpluses-to-savings',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      ) as unknown as NextRequest
    }

    async function seedRecap(args: {
      ownerKind: 'profile' | 'group'
      currentStep?: string
      startedBy?: string
    }): Promise<{ id: string }> {
      const base = {
        recap_month: currentMonth,
        recap_year: currentYear,
        current_step: args.currentStep ?? 'summary',
        started_by_profile_id: args.startedBy ?? userAId,
        started_at: new Date().toISOString(),
      }
      const payload: Database['public']['Tables']['monthly_recaps']['Insert'] =
        args.ownerKind === 'profile'
          ? { profile_id: userAId, ...base }
          : { group_id: groupAId, ...base }
      const { data, error } = await admin
        .from('monthly_recaps')
        .insert(payload)
        .select('id')
        .single()
      if (error || !data) throw error ?? new Error('recap insert returned no row')
      return data
    }

    async function seedBudget(args: {
      estimated: number
      cumulatedSavings: number
      ownerKind?: 'profile' | 'group'
    }): Promise<string> {
      const ownerKind = args.ownerKind ?? 'profile'
      const base = {
        name: `budget-${randomUUID().slice(0, 8)}`,
        estimated_amount: args.estimated,
        cumulated_savings: args.cumulatedSavings,
        is_monthly_recurring: false,
      }
      const payload: Database['public']['Tables']['estimated_budgets']['Insert'] =
        ownerKind === 'profile' ? { profile_id: userAId, ...base } : { group_id: groupAId, ...base }
      const { data, error } = await admin
        .from('estimated_budgets')
        .insert(payload)
        .select('id')
        .single()
      if (error || !data) throw error ?? new Error('budget insert returned no row')
      return data.id
    }

    it('happy 3 surplus — cumulated_savings increments + advance to salary_update', async () => {
      mockedAuth.userId = userAId
      mockedAuth.groupId = groupAId
      const recap = await seedRecap({ ownerKind: 'profile' })
      const id1 = await seedBudget({ estimated: 100, cumulatedSavings: 200 })
      const id2 = await seedBudget({ estimated: 50, cumulatedSavings: 75 })
      const id3 = await seedBudget({ estimated: 150, cumulatedSavings: 0 })

      const response = await POST(buildRequest({ context: 'profile' }))
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        data: {
          transformed: Array<{ budgetId: string; amount: number }>
          failed: unknown[]
          nextStep: string | null
        }
      }
      expect(body.data.failed).toEqual([])
      expect(body.data.transformed).toHaveLength(3)
      expect(body.data.nextStep).toBe('salary_update')

      const { data: budgets } = await admin
        .from('estimated_budgets')
        .select('id, cumulated_savings')
        .eq('profile_id', userAId)
      const map = new Map(budgets?.map((b) => [b.id, Number(b.cumulated_savings ?? 0)]))
      // Each cumulated_savings += surplus (estimated − spent, with spent=0).
      expect(map.get(id1)).toBe(300) // 200 + 100
      expect(map.get(id2)).toBe(125) // 75 + 50
      expect(map.get(id3)).toBe(150) // 0 + 150

      const { data: row } = await admin
        .from('monthly_recaps')
        .select('current_step')
        .eq('id', recap.id)
        .single()
      expect(row?.current_step).toBe('salary_update')
    })

    it('no remaining surplus — no-op safe, current_step still advances', async () => {
      mockedAuth.userId = userAId
      mockedAuth.groupId = groupAId
      const recap = await seedRecap({ ownerKind: 'profile' })
      const idZero1 = await seedBudget({ estimated: 0, cumulatedSavings: 42 })
      const idZero2 = await seedBudget({ estimated: 0, cumulatedSavings: 7 })

      const response = await POST(buildRequest({ context: 'profile' }))
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        data: {
          transformed: Array<{ budgetId: string }>
          failed: unknown[]
          nextStep: string | null
        }
      }
      expect(body.data.transformed).toEqual([])
      expect(body.data.failed).toEqual([])
      expect(body.data.nextStep).toBe('salary_update')

      // cumulated_savings untouched
      const { data: budgets } = await admin
        .from('estimated_budgets')
        .select('id, cumulated_savings')
        .eq('profile_id', userAId)
      const map = new Map(budgets?.map((b) => [b.id, Number(b.cumulated_savings ?? 0)]))
      expect(map.get(idZero1)).toBe(42)
      expect(map.get(idZero2)).toBe(7)

      const { data: row } = await admin
        .from('monthly_recaps')
        .select('current_step')
        .eq('id', recap.id)
        .single()
      expect(row?.current_step).toBe('salary_update')
    })

    it("current_step already 'salary_update' — 409 invalid_step", async () => {
      mockedAuth.userId = userAId
      mockedAuth.groupId = groupAId
      await seedRecap({ ownerKind: 'profile', currentStep: 'salary_update' })
      await seedBudget({ estimated: 100, cumulatedSavings: 100 })

      const response = await POST(buildRequest({ context: 'profile' }))
      expect(response.status).toBe(409)
      const body = (await response.json()) as { error: string; currentStep: string }
      expect(body.error).toBe('invalid_step')
      expect(body.currentStep).toBe('salary_update')
    })

    it('no recap row — 404 no_active_recap', async () => {
      mockedAuth.userId = userAId
      mockedAuth.groupId = groupAId
      await seedBudget({ estimated: 100, cumulatedSavings: 100 })

      const response = await POST(buildRequest({ context: 'profile' }))
      expect(response.status).toBe(404)
      const body = (await response.json()) as { error: string }
      expect(body.error).toBe('no_active_recap')
    })

    it('recap started by another user (group context) — 403 not_initiator', async () => {
      mockedAuth.userId = userAId
      mockedAuth.groupId = groupAId
      await seedRecap({ ownerKind: 'group', startedBy: userBId })
      await seedBudget({ estimated: 50, cumulatedSavings: 50, ownerKind: 'group' })

      const response = await POST(buildRequest({ context: 'group' }))
      expect(response.status).toBe(403)
      const body = (await response.json()) as { error: string }
      expect(body.error).toBe('not_initiator')
    })

    it('empty body — 400 BadRequest from Zod', async () => {
      mockedAuth.userId = userAId
      mockedAuth.groupId = groupAId
      const response = await POST(buildRequest({}))
      expect(response.status).toBe(400)
    })
  },
)
