/**
 * Sprint Projets-Épargne 10 — gated DB integration tests for the
 * `apply_recap_projects_snapshot` invocation wired into
 * `executeCompleteRecap`.
 *
 * Gated by `SUPABASE_RECAP_TESTS=1`. Hits the real `ddehmjucyfgyppfkbddr`
 * dev DB (or prod fallback). The orchestrator is invoked end-to-end : after
 * each call we read back `savings_projects` to assert the cumulative
 * semantics (`amount_saved += monthly - refund` ; deadline shifts iff the
 * accumulated `pending_delay_fraction + refund/monthly` crosses 1).
 *
 * Covered cases (5) :
 *  1. No projects                              → no-op (updated_count = 0)
 *  2. Finalize without any refund              → amount_saved += monthly,
 *                                                deadline unchanged
 *  3. Partial refund 30€ on 100€/month project → amount_saved += 70€,
 *                                                pending_delay_fraction → 0.3,
 *                                                deadline unchanged
 *  4. Full refund 100€ on 100€/month project   → amount_saved += 0€,
 *                                                pending_delay_fraction → 0,
 *                                                deadline += 1 month
 *  5. 4× monthly partial 30€ refund            → on the 4th finalize the
 *                                                accumulated fraction crosses
 *                                                1 (0.3 → 0.6 → 0.9 → 1.2) so
 *                                                deadline shifts +1 month and
 *                                                residual fraction = 0.2
 */

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/lib/database.types'

const ENABLED = process.env.SUPABASE_RECAP_TESTS === '1'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)(
  'executeCompleteRecap — apply_recap_projects_snapshot wiring (gated)',
  () => {
    let admin: SupabaseClient<Database>
    let executeCompleteRecap: typeof import('../actions-finalize').executeCompleteRecap

    let userAId: string
    const stamp = Date.now()
    const emailA = `recap-fin-proj-${stamp}@popoth.test`

    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()

    beforeAll(async () => {
      if (!SUPABASE_URL || !SERVICE_KEY) {
        throw new Error(
          'finalize-projects tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
        )
      }
      const mod = await import('../actions-finalize')
      executeCompleteRecap = mod.executeCompleteRecap

      admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })

      const { data, error } = await admin.auth.admin.createUser({
        email: emailA,
        password: randomUUID(),
        email_confirm: true,
      })
      if (error || !data.user) throw error ?? new Error('createUser returned no user')
      userAId = data.user.id

      const { error: profError } = await admin
        .from('profiles')
        .upsert([{ id: userAId, first_name: 'FinProj', last_name: 'Tester' }], { onConflict: 'id' })
      if (profError) throw profError

      // Suppress fail-soft error logs during expected paths
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(async () => {
      await resetState()
    })

    afterAll(async () => {
      if (admin && userAId) {
        await resetState()
        await admin.auth.admin.deleteUser(userAId)
      }
      vi.restoreAllMocks()
    })

    async function resetState() {
      if (!userAId) return
      await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
      await admin.from('savings_projects').delete().eq('profile_id', userAId)
    }

    async function seedRecap(projectSnapshotData: Record<string, number> = {}): Promise<string> {
      const payload: Database['public']['Tables']['monthly_recaps']['Insert'] = {
        profile_id: userAId,
        recap_month: currentMonth,
        recap_year: currentYear,
        current_step: 'final_recap',
        started_by_profile_id: userAId,
        started_at: new Date().toISOString(),
        completed_at: null,
        budget_snapshot_data: {} as unknown as Json,
        project_snapshot_data: projectSnapshotData as unknown as Json,
      }
      const { data, error } = await admin
        .from('monthly_recaps')
        .insert(payload)
        .select('id')
        .single()
      if (error || !data) throw error ?? new Error('recap insert returned no row')
      return data.id
    }

    async function seedProject(args: {
      monthlyAllocation: number
      amountSaved?: number
      pendingDelayFraction?: number
      deadlineDate?: string
    }): Promise<{ id: string; deadlineDate: string }> {
      const deadlineDate =
        args.deadlineDate ??
        new Date(currentYear + 1, currentMonth - 1, 15).toISOString().slice(0, 10)
      const payload: Database['public']['Tables']['savings_projects']['Insert'] = {
        profile_id: userAId,
        name: `proj-${randomUUID().slice(0, 8)}`,
        target_amount: Math.max(args.monthlyAllocation * 10, 100),
        monthly_allocation: args.monthlyAllocation,
        amount_saved: args.amountSaved ?? 0,
        pending_delay_fraction: args.pendingDelayFraction ?? 0,
        deadline_date: deadlineDate,
      }
      const { data, error } = await admin
        .from('savings_projects')
        .insert(payload)
        .select('id, deadline_date')
        .single()
      if (error || !data) throw error ?? new Error('project insert returned no row')
      return { id: data.id, deadlineDate: data.deadline_date }
    }

    async function readProject(id: string) {
      const { data, error } = await admin
        .from('savings_projects')
        .select('amount_saved, pending_delay_fraction, deadline_date')
        .eq('id', id)
        .single()
      if (error || !data) throw error ?? new Error('project read returned no row')
      return {
        amountSaved: Number(data.amount_saved),
        pendingDelayFraction: Number(data.pending_delay_fraction),
        deadlineDate: data.deadline_date,
      }
    }

    function addMonths(iso: string, months: number): string {
      const [yearStr, monthStr, dayStr] = iso.split('-')
      const year = Number(yearStr)
      const month = Number(monthStr) - 1 + months
      const day = Number(dayStr)
      const d = new Date(Date.UTC(year, month, day))
      return d.toISOString().slice(0, 10)
    }

    it('case 5 — no projects ⇒ RPC no-op (updated_count = 0)', async () => {
      const recapId = await seedRecap({})
      const outcome = await executeCompleteRecap({
        context: 'profile',
        profile: { id: userAId, group_id: null },
        recap: {
          id: recapId,
          budget_snapshot_data: {} as unknown as Json,
          project_snapshot_data: {} as unknown as Json,
        },
      })
      expect(outcome.projectsApplied?.updated_count).toBe(0)
      expect(outcome.projectsApplied?.total_refunded).toBe(0)
    })

    it('case 1 — finalize without refund ⇒ amount_saved += monthly, deadline unchanged', async () => {
      const proj = await seedProject({ monthlyAllocation: 100, amountSaved: 50 })
      const recapId = await seedRecap({})

      await executeCompleteRecap({
        context: 'profile',
        profile: { id: userAId, group_id: null },
        recap: {
          id: recapId,
          budget_snapshot_data: {} as unknown as Json,
          project_snapshot_data: {} as unknown as Json,
        },
      })

      const row = await readProject(proj.id)
      expect(row.amountSaved).toBe(150) // 50 + 100
      expect(row.pendingDelayFraction).toBe(0)
      expect(row.deadlineDate).toBe(proj.deadlineDate)
    })

    it('case 2 — partial refund 30€/100€ ⇒ amount_saved += 70€, pending = 0.3, deadline unchanged', async () => {
      const proj = await seedProject({ monthlyAllocation: 100, amountSaved: 200 })
      const recapId = await seedRecap({ [proj.id]: 30 })

      await executeCompleteRecap({
        context: 'profile',
        profile: { id: userAId, group_id: null },
        recap: {
          id: recapId,
          budget_snapshot_data: {} as unknown as Json,
          project_snapshot_data: { [proj.id]: 30 } as unknown as Json,
        },
      })

      const row = await readProject(proj.id)
      expect(row.amountSaved).toBe(270) // 200 + 70
      expect(row.pendingDelayFraction).toBeCloseTo(0.3, 4)
      expect(row.deadlineDate).toBe(proj.deadlineDate)
    })

    it('case 3 — full refund 100€/100€ ⇒ amount_saved += 0€, pending = 0, deadline += 1 month', async () => {
      const proj = await seedProject({ monthlyAllocation: 100, amountSaved: 200 })
      const recapId = await seedRecap({ [proj.id]: 100 })

      await executeCompleteRecap({
        context: 'profile',
        profile: { id: userAId, group_id: null },
        recap: {
          id: recapId,
          budget_snapshot_data: {} as unknown as Json,
          project_snapshot_data: { [proj.id]: 100 } as unknown as Json,
        },
      })

      const row = await readProject(proj.id)
      expect(row.amountSaved).toBe(200) // 200 + 0
      expect(row.pendingDelayFraction).toBe(0)
      expect(row.deadlineDate).toBe(addMonths(proj.deadlineDate, 1))
    })

    it('case 4 — accumulation 4× 30€ partial ⇒ shift +1 on the 4th finalize (cumul 1.2 > 1, residual 0.2)', async () => {
      // Seed at pending_delay_fraction = 0. After 3 finalizes with refund=30/100,
      // pending = 0.9. The 4th finalize crosses 1 (0.9 + 0.3 = 1.2) and shifts +1
      // month with residual 0.2.
      const proj = await seedProject({ monthlyAllocation: 100, amountSaved: 0 })
      const initialDeadline = proj.deadlineDate

      for (let i = 1; i <= 4; i++) {
        // Reset recap between iterations (single-recap test harness) — seed fresh
        await admin.from('monthly_recaps').delete().eq('profile_id', userAId)
        const recapId = await seedRecap({ [proj.id]: 30 })

        await executeCompleteRecap({
          context: 'profile',
          profile: { id: userAId, group_id: null },
          recap: {
            id: recapId,
            budget_snapshot_data: {} as unknown as Json,
            project_snapshot_data: { [proj.id]: 30 } as unknown as Json,
          },
        })

        const row = await readProject(proj.id)
        if (i < 4) {
          // amount_saved cumule (70 € chaque tour)
          expect(row.amountSaved).toBe(70 * i)
          expect(row.pendingDelayFraction).toBeCloseTo(0.3 * i, 4)
          expect(row.deadlineDate).toBe(initialDeadline)
        } else {
          // 4ème finalize : shift +1, residual 0.2
          expect(row.amountSaved).toBe(280) // 70 * 4
          expect(row.pendingDelayFraction).toBeCloseTo(0.2, 4)
          expect(row.deadlineDate).toBe(addMonths(initialDeadline, 1))
        }
      }
    })
  },
)
