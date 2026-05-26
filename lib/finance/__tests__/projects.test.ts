import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/lib/database.types'

/**
 * Sprint Projets-Épargne 02 (Backend-Wiring) — gated DB tests for the 4
 * `lib/finance/projects.ts` helpers and the underlying RPCs from sprint 01.
 *
 * Gated by SUPABASE_FINANCE_TESTS=1 (matches sprint plan §7 and the
 * existing `financial-data.test.ts` env). Dynamic import in beforeAll so
 * the suite skips cleanly without env vars (lib/supabase-server.ts calls
 * createClient at module load).
 *
 * 4 cas requis par le plan : create→list, update, delete→piggy crédité,
 * ownership cross-user forbidden.
 */

type ProjectsMod = typeof import('@/lib/finance/projects')

const ENABLED = process.env.SUPABASE_FINANCE_TESTS === '1'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

describe.skipIf(!ENABLED)('lib/finance/projects — RPC helpers (Sprint 02)', () => {
  let admin: SupabaseClient<Database>
  let createSavingsProject: ProjectsMod['createSavingsProject']
  let updateSavingsProject: ProjectsMod['updateSavingsProject']
  let deleteSavingsProjectToPiggy: ProjectsMod['deleteSavingsProjectToPiggy']
  let listSavingsProjects: ProjectsMod['listSavingsProjects']

  const stamp = Date.now()
  const ownerEmail = `projects-owner-${stamp}@popoth.test`
  const ownerPassword = `projects-${randomUUID()}`
  const otherEmail = `projects-other-${stamp}@popoth.test`
  const otherPassword = `projects-${randomUUID()}`
  let ownerUserId: string
  let otherUserId: string

  async function ensurePiggy(profileId: string, amount: number) {
    const { data: existing } = await admin
      .from('piggy_bank')
      .select('id')
      .eq('profile_id', profileId)
      .maybeSingle()
    if (existing) {
      const { error } = await admin
        .from('piggy_bank')
        .update({ amount })
        .eq('profile_id', profileId)
      if (error) throw error
    } else {
      const { error } = await admin
        .from('piggy_bank')
        .insert({ profile_id: profileId, group_id: null, amount })
      if (error) throw error
    }
  }

  async function fetchPiggyAmount(profileId: string): Promise<number> {
    const { data, error } = await admin
      .from('piggy_bank')
      .select('amount')
      .eq('profile_id', profileId)
      .maybeSingle()
    if (error) throw error
    return Number(data?.amount ?? 0)
  }

  async function seedAmountSaved(projectId: string, amountSaved: number) {
    const { error } = await admin
      .from('savings_projects')
      .update({ amount_saved: amountSaved })
      .eq('id', projectId)
    if (error) throw error
  }

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error(
        'projects tests require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
      )
    }

    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const mod = await import('@/lib/finance/projects')
    createSavingsProject = mod.createSavingsProject
    updateSavingsProject = mod.updateSavingsProject
    deleteSavingsProjectToPiggy = mod.deleteSavingsProjectToPiggy
    listSavingsProjects = mod.listSavingsProjects

    const { data: ownerData, error: ownerErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
    })
    if (ownerErr || !ownerData.user) throw ownerErr ?? new Error('createUser owner failed')
    ownerUserId = ownerData.user.id

    const { error: ownerProfErr } = await admin.from('profiles').insert({
      id: ownerUserId,
      first_name: 'Projects',
      last_name: 'Owner',
    })
    if (ownerProfErr) throw ownerProfErr

    const { data: otherData, error: otherErr } = await admin.auth.admin.createUser({
      email: otherEmail,
      password: otherPassword,
      email_confirm: true,
    })
    if (otherErr || !otherData.user) throw otherErr ?? new Error('createUser other failed')
    otherUserId = otherData.user.id

    const { error: otherProfErr } = await admin.from('profiles').insert({
      id: otherUserId,
      first_name: 'Projects',
      last_name: 'Other',
    })
    if (otherProfErr) throw otherProfErr
  }, 30_000)

  afterAll(async () => {
    if (!admin) return
    if (ownerUserId) {
      await admin.from('savings_projects').delete().eq('profile_id', ownerUserId)
      await admin.from('piggy_bank').delete().eq('profile_id', ownerUserId)
      await admin.auth.admin.deleteUser(ownerUserId)
    }
    if (otherUserId) {
      await admin.from('savings_projects').delete().eq('profile_id', otherUserId)
      await admin.from('piggy_bank').delete().eq('profile_id', otherUserId)
      await admin.auth.admin.deleteUser(otherUserId)
    }
  }, 30_000)

  // ============================================================================
  // 1. create → list
  // ============================================================================
  it('create → list: createSavingsProject row is visible in listSavingsProjects', async () => {
    const project = await createSavingsProject(
      { profile_id: ownerUserId },
      {
        name: `Trip ${randomUUID().slice(0, 8)}`,
        targetAmount: 7000,
        monthlyAllocation: 195,
        deadlineDate: '2029-05-01',
      },
    )

    expect(project.id).toBeTruthy()
    expect(project.profile_id).toBe(ownerUserId)
    expect(project.group_id).toBeNull()
    expect(Number(project.target_amount)).toBe(7000)
    expect(Number(project.monthly_allocation)).toBe(195)
    expect(project.deadline_date).toBe('2029-05-01')
    expect(Number(project.amount_saved)).toBe(0)
    expect(Number(project.pending_delay_fraction)).toBe(0)

    const list = await listSavingsProjects({ profile_id: ownerUserId })
    const found = list.find((p) => p.id === project.id)
    expect(found).toBeDefined()
    expect(found?.name).toBe(project.name)

    // Cleanup so subsequent tests start clean
    await admin.from('savings_projects').delete().eq('id', project.id)
  }, 30_000)

  // ============================================================================
  // 2. update
  // ============================================================================
  it('update: editable fields change, amount_saved + pending_delay_fraction preserved', async () => {
    const project = await createSavingsProject(
      { profile_id: ownerUserId },
      {
        name: 'Original',
        targetAmount: 5000,
        monthlyAllocation: 100,
        deadlineDate: '2030-01-01',
      },
    )

    // Seed amount_saved + pending_delay_fraction via direct UPDATE
    // (these fields are never touched by the update RPC)
    const { error: seedErr } = await admin
      .from('savings_projects')
      .update({ amount_saved: 300, pending_delay_fraction: 0.5 })
      .eq('id', project.id)
    if (seedErr) throw seedErr

    const updated = await updateSavingsProject(
      { profile_id: ownerUserId },
      {
        id: project.id,
        name: 'Updated',
        targetAmount: 6000,
        monthlyAllocation: 150,
        deadlineDate: '2031-02-15',
      },
    )

    expect(updated.name).toBe('Updated')
    expect(Number(updated.target_amount)).toBe(6000)
    expect(Number(updated.monthly_allocation)).toBe(150)
    expect(updated.deadline_date).toBe('2031-02-15')
    // Preservation invariants — the update RPC must NOT touch these
    expect(Number(updated.amount_saved)).toBe(300)
    expect(Number(updated.pending_delay_fraction)).toBe(0.5)

    await admin.from('savings_projects').delete().eq('id', project.id)
  }, 30_000)

  // ============================================================================
  // 3. delete → piggy crédité
  // ============================================================================
  it('delete → piggy crédité: amount_saved transferred to piggy in one transaction', async () => {
    await ensurePiggy(ownerUserId, 10)
    const project = await createSavingsProject(
      { profile_id: ownerUserId },
      {
        name: 'To delete',
        targetAmount: 1000,
        monthlyAllocation: 50,
        deadlineDate: '2028-12-01',
      },
    )

    // Seed amount_saved to simulate accumulated contributions
    await seedAmountSaved(project.id, 50)

    const result = await deleteSavingsProjectToPiggy({ profile_id: ownerUserId }, project.id)

    expect(Number(result.transferred_amount)).toBe(50)
    expect(Number(result.piggy_amount)).toBe(60) // 10 + 50

    // Project gone
    const list = await listSavingsProjects({ profile_id: ownerUserId })
    expect(list.find((p) => p.id === project.id)).toBeUndefined()

    // Piggy actually credited (double-check via direct SELECT)
    expect(await fetchPiggyAmount(ownerUserId)).toBe(60)
  }, 30_000)

  // ============================================================================
  // 4. ownership cross-user → forbidden
  // ============================================================================
  it('ownership cross-user: user B cannot update or delete user A project', async () => {
    const aProject = await createSavingsProject(
      { profile_id: ownerUserId },
      {
        name: 'Owned by A',
        targetAmount: 4000,
        monthlyAllocation: 80,
        deadlineDate: '2029-03-01',
      },
    )

    // User B tries to update A's project with their own filter → RPC RAISEs
    await expect(
      updateSavingsProject(
        { profile_id: otherUserId },
        {
          id: aProject.id,
          name: 'Hijacked',
          targetAmount: 1,
          monthlyAllocation: 1,
          deadlineDate: '2099-12-31',
        },
      ),
    ).rejects.toThrow(/not found|not owned/i)

    // User B tries to delete A's project → RPC RAISEs
    await expect(
      deleteSavingsProjectToPiggy({ profile_id: otherUserId }, aProject.id),
    ).rejects.toThrow(/not found|not owned/i)

    // A's project is unchanged
    const list = await listSavingsProjects({ profile_id: ownerUserId })
    const still = list.find((p) => p.id === aProject.id)
    expect(still).toBeDefined()
    expect(still?.name).toBe('Owned by A')

    await admin.from('savings_projects').delete().eq('id', aProject.id)
  }, 30_000)
})
