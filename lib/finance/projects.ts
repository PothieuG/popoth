import type { Database } from '@/lib/database.types'
import { supabaseServer } from '@/lib/supabase-server'
import { resolveContextIds, type ContextFilter } from './context'

export type SavingsProjectRow = Database['public']['Tables']['savings_projects']['Row']

/**
 * Atomic INSERT of a savings_projects row via the `create_savings_project`
 * RPC (sprint 01). Returns the full row including server-generated id,
 * timestamps and defaulted `amount_saved` / `pending_delay_fraction`. The
 * RPC enforces owner-exclusivity (exactly one of profile_id|group_id) at
 * the PG layer — mismatched filters surface as the RPC's RAISE.
 */
export async function createSavingsProject(
  filter: ContextFilter,
  args: {
    name: string
    targetAmount: number
    monthlyAllocation: number
    deadlineDate: string
  },
): Promise<SavingsProjectRow> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('create_savings_project', {
    p_name: args.name,
    p_target: args.targetAmount,
    p_monthly: args.monthlyAllocation,
    p_deadline: args.deadlineDate,
    p_profile_id: profile_id,
    p_group_id: group_id,
  })
  if (error) throw error
  return data as unknown as SavingsProjectRow
}

/**
 * Atomic UPDATE of the editable fields (name, target, monthly, deadline)
 * via the `update_savings_project` RPC. Does NOT touch `amount_saved` or
 * `pending_delay_fraction` — those are mutated exclusively by the recap
 * apply RPC (sprint 10) and the delete-to-piggy RPC. The RPC enforces
 * ownership via its WHERE clause and RAISEs "not found or not owned" on
 * mismatch.
 */
export async function updateSavingsProject(
  filter: ContextFilter,
  args: {
    id: string
    name: string
    targetAmount: number
    monthlyAllocation: number
    deadlineDate: string
  },
): Promise<SavingsProjectRow> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('update_savings_project', {
    p_id: args.id,
    p_name: args.name,
    p_target: args.targetAmount,
    p_monthly: args.monthlyAllocation,
    p_deadline: args.deadlineDate,
    p_profile_id: profile_id,
    p_group_id: group_id,
  })
  if (error) throw error
  return data as unknown as SavingsProjectRow
}

/**
 * Atomic DELETE + transfer of accumulated `amount_saved` to the owner's
 * piggy_bank via the `delete_savings_project_to_piggy` RPC. Mirror of
 * `delete_budget_with_savings_transfer` — the piggy row UPSERTs through
 * the partial unique indexes by owner. Returns the transferred amount
 * (0 if the project was never funded) and the resulting piggy balance
 * (null when no transfer occurred).
 */
export async function deleteSavingsProjectToPiggy(
  filter: ContextFilter,
  projectId: string,
): Promise<{ transferred_amount: number; piggy_amount: number | null }> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('delete_savings_project_to_piggy', {
    p_id: projectId,
    p_profile_id: profile_id,
    p_group_id: group_id,
  })
  if (error) throw error
  return data as unknown as { transferred_amount: number; piggy_amount: number | null }
}

/**
 * SELECT all savings projects of the given owner, newest first. No RPC
 * required — read-only SELECT goes through the service-role client which
 * bypasses RLS, but the WHERE clause restricts to the resolved owner.
 */
export async function listSavingsProjects(filter: ContextFilter): Promise<SavingsProjectRow[]> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const baseQuery = supabaseServer
    .from('savings_projects')
    .select('*')
    .order('created_at', { ascending: false })
  const scopedQuery =
    profile_id !== undefined
      ? baseQuery.eq('profile_id', profile_id)
      : baseQuery.eq('group_id', group_id!)
  const { data, error } = await scopedQuery
  if (error) throw error
  return data ?? []
}
