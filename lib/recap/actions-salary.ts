/**
 * Monthly Recap V3 — salary update (écran 4) action. Sprint 08.
 *
 * One helper consumed by the matching POST route:
 *
 *  - `executeUpdateSalaries` : validates the salary list against the recap
 *    context (profile = exactly the caller's profileId ; group = every
 *    profileId belongs to the caller's group), UPDATEs `profiles.salary`
 *    per row, then — for group context — invokes the `calculate_group_contributions`
 *    RPC (fail-soft: salaries are already updated, the trigger on next budget
 *    change will eventually resync). Finally advances `monthly_recaps.current_step`
 *    from `'salary_update'` to `'final_recap'`.
 *
 * Group-target validation depends on the small helper `fetchGroupMemberIds`,
 * which is the server-side authority: never trust the client's `profileId`
 * list to be in-group.
 *
 * Business errors surface as `RecapActionError(code, status, extras)` so the
 * route can serialize them via the existing catch branch shared with the
 * positive/negative flows.
 */

import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import { RecapActionError } from './actions-negative'
import type { RecapContext } from './check-status'

export async function fetchGroupMemberIds(groupId: string): Promise<Set<string>> {
  const { data, error } = await supabaseServer.from('profiles').select('id').eq('group_id', groupId)
  if (error) {
    logger.error('[recap/salary] fetchGroupMemberIds failed', { groupId, error })
    throw error
  }
  return new Set((data ?? []).map((row) => row.id))
}

export interface ExecuteUpdateSalariesArgs {
  context: RecapContext
  userId: string
  profile: { id: string; group_id: string | null }
  recap: { id: string }
  salaries: ReadonlyArray<{ profileId: string; salary: number }>
}

export interface UpdateSalariesOutcome {
  updated: number
  nextStep: 'final_recap'
  contributionsRecalculated: boolean
}

export async function executeUpdateSalaries(
  args: ExecuteUpdateSalariesArgs,
): Promise<UpdateSalariesOutcome> {
  // 1. Validate target set (context-dependent)
  if (args.context === 'profile') {
    const [head] = args.salaries
    if (args.salaries.length !== 1 || !head || head.profileId !== args.userId) {
      throw new RecapActionError('invalid_target', 400)
    }
  } else {
    if (!args.profile.group_id) {
      throw new RecapActionError('invalid_target', 400)
    }
    const memberIds = await fetchGroupMemberIds(args.profile.group_id)
    const invalid = args.salaries.filter((s) => !memberIds.has(s.profileId))
    if (invalid.length > 0) {
      throw new RecapActionError('invalid_target', 400, {
        invalid: invalid.map((s) => s.profileId),
      })
    }
  }

  // 2. UPDATE each salary (sequential — N is small, per-row atomic)
  for (const { profileId, salary } of args.salaries) {
    const { error } = await supabaseServer.from('profiles').update({ salary }).eq('id', profileId)
    if (error) {
      logger.error('[recap/salary] update profile.salary failed', { profileId, error })
      throw error
    }
  }

  // 3. Recalculate contributions for any user with a group (profile context
  //    with a group OR group context). Sprint 14 follow-up 2026-05-25 —
  //    the previous gating on `context === 'group'` left profile-context
  //    callers with a group dependent on the `profiles_contribution_recalc`
  //    trigger ; we observed at least one case where the header stayed at
  //    "à définir" despite the trigger being installed (root cause inconnue —
  //    possibly TG_OP/RLS interaction with service_role). Explicit > implicit:
  //    we now always invoke the RPC when the user belongs to a group, and
  //    the trigger remains as a backstop for non-recap mutations to
  //    profiles.salary. Fail-soft: the salary is already updated, the trigger
  //    on next budget change will eventually resync if this errors.
  let contributionsRecalculated = false
  if (args.profile.group_id) {
    const { error } = await supabaseServer.rpc('calculate_group_contributions', {
      group_id_param: args.profile.group_id,
    })
    if (error) {
      logger.error('[recap/salary] calculate_group_contributions failed', {
        groupId: args.profile.group_id,
        error,
      })
    } else {
      contributionsRecalculated = true
    }
  }

  // 4. Advance state machine: salary_update → final_recap
  const { error: stepError } = await supabaseServer
    .from('monthly_recaps')
    .update({ current_step: 'final_recap' })
    .eq('id', args.recap.id)
  if (stepError) {
    logger.error('[recap/salary] advance step failed', {
      recapId: args.recap.id,
      error: stepError,
    })
    throw stepError
  }

  return {
    updated: args.salaries.length,
    nextStep: 'final_recap',
    contributionsRecalculated,
  }
}
