/**
 * Monthly Recap V3 — fetch the active (non-completed) recap row for the
 * current calendar month + context. Sprint 06 (positive flow) and beyond.
 *
 * Returns `null` when:
 *   - no row exists for this period (the user must `/start` first),
 *   - the row is completed (`completed_at` not null) — endpoints should
 *     refuse further mutations,
 *   - the context is `'group'` but the profile has no `group_id`,
 *   - the SELECT errored (logged + null).
 *
 * Uses `.maybeSingle()` per CLAUDE.md operational-rules §5 "tables owner-row
 * hybrides" — a fresh account legitimately has no row, and `.single()` would
 * raise PGRST116 in that case.
 *
 * Will be reused by sprints 07 (refloats), 08 (final recap / complete),
 * 09 (snapshot save) — that is why it lives outside of the
 * sprint-06-specific `actions-positive.ts`.
 */

import type { Database } from '@/lib/database.types'
import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'

import type { RecapContext } from './check-status'

export type MonthlyRecapRow = Database['public']['Tables']['monthly_recaps']['Row']

export interface GetActiveRecapArgs {
  context: RecapContext
  userId: string
  profile: { id: string; group_id: string | null }
  /** Injectable for tests — defaults to `new Date()` at call time. */
  now?: Date
}

export async function getActiveRecap(args: GetActiveRecapArgs): Promise<MonthlyRecapRow | null> {
  const { context, userId, profile } = args
  const now = args.now ?? new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  if (context === 'group' && !profile.group_id) {
    return null
  }

  const ownerColumn: 'profile_id' | 'group_id' = context === 'profile' ? 'profile_id' : 'group_id'
  const ownerId = context === 'profile' ? userId : (profile.group_id as string)

  const { data, error } = await supabaseServer
    .from('monthly_recaps')
    .select('*')
    .eq(ownerColumn, ownerId)
    .eq('recap_month', month)
    .eq('recap_year', year)
    .is('completed_at', null)
    .maybeSingle()

  if (error) {
    logger.error('[recap/active] fetch failed', { error, context, userId })
    return null
  }
  return data
}
