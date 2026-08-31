import { supabaseServer } from '@/lib/supabase-server'
import { getRecapPeriod } from './period'
import type { RecapStep } from './state'

export type RecapContext = 'profile' | 'group'

/**
 * Discriminated union over the 4 status states a recap can be in for a
 * given (context, month, year):
 *
 * - `no_recap`         : no row for this period — the user must start.
 *                       Also returned when the row exists but
 *                       `started_by_profile_id IS NULL` (orphan row left by
 *                       a failed claim — `/start` will re-claim it).
 * - `in_progress`      : row exists, not completed, and the current user is
 *                       the initiator (profile mode: always; group mode:
 *                       only when `started_by_profile_id === userId`).
 * - `locked_by_other`  : group mode only — row exists, not completed,
 *                       initiator ≠ current user. UI shows a lock screen.
 * - `completed`        : row has `completed_at` set; the wizard is done.
 *
 * Discriminator is `kind` (not `type`) to avoid collisions with React's
 * intrinsic `type` prop downstream.
 */
export type RecapStatusKind =
  | { kind: 'no_recap' }
  | {
      kind: 'in_progress'
      recapId: string
      step: RecapStep
      startedAt: string | null
      startedByProfileId: string
    }
  | {
      kind: 'locked_by_other'
      recapId: string
      startedByProfileId: string
      startedByName: string | null
    }
  | { kind: 'completed'; recapId: string; completedAt: string }

export interface RecapStatusResult {
  context: RecapContext
  contextId: string
  status: RecapStatusKind
  /** Mois recapé 1-12 — le mois écoulé (précédent), pas le mois en cours. */
  recapMonth: number
  recapYear: number
}

export class RecapStatusError extends Error {
  constructor(
    public readonly code: 'PROFILE_NOT_FOUND' | 'NO_GROUP',
    message: string,
  ) {
    super(message)
    this.name = 'RecapStatusError'
  }
}

const VALID_STEPS: readonly RecapStep[] = [
  'welcome',
  'complete_month',
  'summary',
  'manage_bilan',
  'salary_update',
  'final_recap',
  'completed',
]

function coerceStep(raw: string): RecapStep {
  return (VALID_STEPS as readonly string[]).includes(raw) ? (raw as RecapStep) : 'welcome'
}

/**
 * Read the recap status for the given user in the given context, for the
 * recapped month/year — the previous calendar month relative to the
 * server-side now (UTC fallback per JS Date defaults), per `getRecapPeriod`.
 * The recap opened "now" always reviews the month that just ended, never the
 * one in progress (cf. `WelcomeStep.tsx` copy "récap mensuel du mois écoulé").
 *
 * Uses `.maybeSingle()` — the row legitimately may not exist (no_recap).
 * Never use `.single()` here: it would raise PGRST116 on any fresh account.
 *
 * Throws `RecapStatusError` on PROFILE_NOT_FOUND or, for group context,
 * NO_GROUP (the user is not bound to any group).
 */
export async function checkRecapStatus(
  userId: string,
  context: RecapContext,
): Promise<RecapStatusResult> {
  const { month: recapMonth, year: recapYear } = getRecapPeriod()

  const { data: profile, error: profileError } = await supabaseServer
    .from('profiles')
    .select('id, group_id')
    .eq('id', userId)
    .maybeSingle()

  if (profileError || !profile) {
    throw new RecapStatusError('PROFILE_NOT_FOUND', 'Profil utilisateur non trouvé')
  }

  if (context === 'profile') {
    const contextId = profile.id

    const { data: row } = await supabaseServer
      .from('monthly_recaps')
      .select('id, current_step, started_at, started_by_profile_id, completed_at')
      .eq('profile_id', profile.id)
      .eq('recap_month', recapMonth)
      .eq('recap_year', recapYear)
      .maybeSingle()

    if (!row) {
      return {
        context,
        contextId,
        status: { kind: 'no_recap' },
        recapMonth,
        recapYear,
      }
    }

    if (row.completed_at != null) {
      return {
        context,
        contextId,
        status: { kind: 'completed', recapId: row.id, completedAt: row.completed_at },
        recapMonth,
        recapYear,
      }
    }

    if (row.started_by_profile_id == null) {
      // Orphan row (creation succeeded but claim did not) — let /start re-claim.
      return {
        context,
        contextId,
        status: { kind: 'no_recap' },
        recapMonth,
        recapYear,
      }
    }

    return {
      context,
      contextId,
      status: {
        kind: 'in_progress',
        recapId: row.id,
        step: coerceStep(row.current_step),
        startedAt: row.started_at,
        startedByProfileId: row.started_by_profile_id,
      },
      recapMonth,
      recapYear,
    }
  }

  // context === 'group'
  if (!profile.group_id) {
    throw new RecapStatusError('NO_GROUP', "Utilisateur ne fait partie d'aucun groupe")
  }
  const contextId = profile.group_id

  const { data: row } = await supabaseServer
    .from('monthly_recaps')
    .select(
      `id, current_step, started_at, started_by_profile_id, completed_at,
       starter:profiles!monthly_recaps_started_by_profile_id_fkey(first_name, last_name)`,
    )
    .eq('group_id', profile.group_id)
    .eq('recap_month', recapMonth)
    .eq('recap_year', recapYear)
    .maybeSingle()

  if (!row) {
    return {
      context,
      contextId,
      status: { kind: 'no_recap' },
      recapMonth,
      recapYear,
    }
  }

  if (row.completed_at != null) {
    return {
      context,
      contextId,
      status: { kind: 'completed', recapId: row.id, completedAt: row.completed_at },
      recapMonth,
      recapYear,
    }
  }

  if (row.started_by_profile_id == null) {
    return {
      context,
      contextId,
      status: { kind: 'no_recap' },
      recapMonth,
      recapYear,
    }
  }

  if (row.started_by_profile_id === userId) {
    return {
      context,
      contextId,
      status: {
        kind: 'in_progress',
        recapId: row.id,
        step: coerceStep(row.current_step),
        startedAt: row.started_at,
        startedByProfileId: row.started_by_profile_id,
      },
      recapMonth,
      recapYear,
    }
  }

  const starter = row.starter as { first_name: string | null; last_name: string | null } | null
  const startedByName = `${starter?.first_name ?? ''} ${starter?.last_name ?? ''}`.trim() || null

  return {
    context,
    contextId,
    status: {
      kind: 'locked_by_other',
      recapId: row.id,
      startedByProfileId: row.started_by_profile_id,
      startedByName,
    },
    recapMonth,
    recapYear,
  }
}
