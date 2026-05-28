/**
 * Monthly Recap V3 — finalize (écran 5) action. Sprint 08.
 *
 * One helper consumed by the matching POST route:
 *
 *  - `executeCompleteRecap` : closes the recap in 4 steps.
 *
 *      1. (fail-soft) Apply the deferred budget snapshot — RPC
 *         `finalize_recap_apply_snapshot(p_recap_id, p_snapshot)` is invoked
 *         ALWAYS (even with empty snapshot) since Sprint Carryover-Self-Healing
 *         2026-05-26. The RPC now uses OVERWRITE semantics : it first resets
 *         `carryover_spent_amount = 0` for ALL owner budgets, then for each
 *         entry in the snapshot SETs `carryover_spent_amount = v_amount` (NOT
 *         `+= v_amount`). Returns `{ applied, reset_count }`. Calling it with
 *         an empty snapshot is required to reset stale carryovers from a
 *         previous month — skipping would leave them as permanent RAV
 *         penalties (the runaway bug fixed by this sprint).
 *
 *      2. (fail-soft) Apply the projects snapshot — RPC
 *         `apply_recap_projects_snapshot(p_recap_id, p_allocations)` (sprint
 *         Projets-Épargne 01, wired here at sprint 10). Walks ALL active
 *         savings_projects of the recap owner ; for each row :
 *           - `amount_saved += monthly_allocation - refund` (refund =
 *             COALESCE(p_allocations->>id, 0))
 *           - `pending_delay_fraction` accumulates `refund / monthly_allocation`
 *           - When the accumulated fraction crosses 1, `deadline_date` shifts
 *             by FLOOR(new_pending) months and the residual fraction persists.
 *         Always called when the owner could have active projects — passing
 *         `{}` (or null coerced to `{}`) makes each project credit its full
 *         monthly without refund. The RPC short-circuits to a no-op when the
 *         owner has zero projects (LOOP exits with `updated_count=0`).
 *
 *      3. (fail-soft) Process transactions — RPC `process_recap_transactions(
 *         p_recap_id, p_profile_id?, p_group_id?)`. For the given context:
 *           - DELETEs `real_expenses` + `real_income_entries` rows where
 *             `applied_to_balance_at IS NOT NULL AND is_carried_over = false`
 *             (the user "validated" them during the month → they're now
 *             integrated, no need to keep them around).
 *           - UPDATEs the un-validated rows (`applied_to_balance_at IS NULL`)
 *             setting `is_carried_over = true` and `carried_from_recap_id = p_recap_id`
 *             so next month's recap inherits them.
 *
 *      4. (NOT fail-soft) Mark the recap completed — sets `completed_at = now()`
 *         and `current_step = 'completed'`. This step must succeed because
 *         without it the recap stays "in progress" and `getActiveRecap` will
 *         keep returning the same row → re-finalize would double-process
 *         transactions (the `is_carried_over = false` filter in the RPC mitigates
 *         but does not eliminate the risk). If this UPDATE errors, surface to
 *         the client (HTTP 500) so they retry — the idempotency check at the
 *         top of the route's next call will short-circuit any duplicate work.
 *
 * Fail-soft strategy on steps 1+2+3 is deliberate (see plan): the recap should
 * close even if a snapshot apply or transaction batch errors at the RPC layer,
 * because re-opening the recap to retry is more disruptive than the partial
 * outcome. Errors are logged and the response carries zero counts so a human
 * can investigate. The projects snapshot fail-soft has an extra implication:
 * a partial failure would leave projects un-credited for the month — the user
 * sees stale `amount_saved` until the next finalize. Logged for triage.
 */

import { logger } from '@/lib/logger'
import { supabaseServer } from '@/lib/supabase-server'
import type { Database, Json } from '@/lib/database.types'

import type { RecapContext } from './check-status'

interface ApplySnapshotResult {
  applied: Array<{ budget_id: string; amount: number }>
  /** Sprint Carryover-Self-Healing 2026-05-26. Number of owner budgets whose
   *  `carryover_spent_amount` was reset to 0 at the start of the RPC. ≥ count
   *  of `applied` (every applied row was also part of the reset). Surfaced for
   *  observability — no downstream consumer reads it. */
  reset_count: number
}

interface ApplyProjectsSnapshotResult {
  updated_count: number
  total_refunded: number
}

interface ProcessTransactionsResult {
  deleted_expenses: number
  deleted_incomes: number
  carried_expenses: number
  carried_incomes: number
}

/** Sprint Salary-Auto-At-Recap-Complete 2026-06-05. Result of
 *  `create_salary_income_for_recap`. `created=true` quand une nouvelle ligne
 *  salaire a été INSERT ; `created=false` quand skip (no_salary | already_exists). */
interface CreateSalaryIncomeResult {
  created: boolean
  reason?: 'no_salary' | 'already_exists'
  income_id?: string
  amount?: number
}

export interface ExecuteCompleteRecapArgs {
  context: RecapContext
  profile: { id: string; group_id: string | null }
  recap: {
    id: string
    budget_snapshot_data: Json
    /** Sprint Projets-Épargne 10. JSONB `{ [projectId]: refund_amount }`
     *  capturé pendant la cascade négative via `refloat-from-projects`. Peut
     *  être `null` / `{}` quand l'user n'a pas activé la ligne (cas pos pur
     *  ou cascade qui s'arrête avant). Toujours forwarded à
     *  `apply_recap_projects_snapshot` — la RPC itère sur les projets actifs
     *  même quand le payload est vide, pour créditer leur `amount_saved` du
     *  mois normalement. */
    project_snapshot_data: Json
  }
}

export interface CompleteRecapOutcome {
  recapId: string
  completed: true
  snapshotApplied: ApplySnapshotResult | null
  /** Sprint Projets-Épargne 10. `null` quand la RPC a erroré (fail-soft) ou
   *  quand l'owner n'a aucun projet (RPC call sautée via la branche
   *  `(projectSnapshot && Object.keys(projectSnapshot).length === 0)` est
   *  faux car on appelle TOUJOURS la RPC quand l'owner peut avoir des
   *  projets — la valeur null vient uniquement du fail-soft). */
  projectsApplied: ApplyProjectsSnapshotResult | null
  transactions: ProcessTransactionsResult
  /** Sprint Salary-Auto-At-Recap-Complete 2026-06-05. `null` en mode groupe
   *  (no-op — la mécanique trigger Sprint 16 V3 étendu prend le relais).
   *  En mode solo : résultat de l'INSERT idempotent du salaire. */
  salaryIncome: CreateSalaryIncomeResult | null
}

const ZERO_TRANSACTIONS: ProcessTransactionsResult = {
  deleted_expenses: 0,
  deleted_incomes: 0,
  carried_expenses: 0,
  carried_incomes: 0,
}

export async function executeCompleteRecap(
  args: ExecuteCompleteRecapArgs,
): Promise<CompleteRecapOutcome> {
  // 1. Apply budget snapshot — ALWAYS invoked, even with an empty snapshot.
  //    Sprint Carryover-Self-Healing 2026-05-26 : the RPC owner-scope-resets
  //    every owner budget's carryover_spent_amount to 0 before applying the
  //    snapshot (OVERWRITE, not `+=`). Calling with `{}` is the legitimate way
  //    to clear stale carryovers from a previous month when this month has
  //    no deferred debt.
  let snapshotApplied: ApplySnapshotResult | null = null
  const snapshot = coerceSnapshot(args.recap.budget_snapshot_data) ?? {}
  const { data: snapData, error: snapError } = await supabaseServer.rpc(
    'finalize_recap_apply_snapshot',
    {
      p_recap_id: args.recap.id,
      p_snapshot: snapshot as unknown as Json,
    },
  )
  if (snapError) {
    logger.error('[recap/finalize] apply_snapshot failed', {
      recapId: args.recap.id,
      error: snapError,
    })
  } else {
    snapshotApplied = (snapData ?? null) as ApplySnapshotResult | null
  }

  // 2. Apply projects snapshot (sprint Projets-Épargne 10). Always invoke
  //    even when `project_snapshot_data` is null/empty — the RPC iterates on
  //    ALL active projects of the owner, crediting `amount_saved +=
  //    monthly_allocation` when refund=0. The LOOP exits to a no-op when the
  //    owner has zero projects (no harm). Fail-soft : a failure here leaves
  //    projects un-credited for the month, which the user notices on the
  //    dashboard the next time they open it.
  let projectsApplied: ApplyProjectsSnapshotResult | null = null
  const projectSnapshot = coerceSnapshot(args.recap.project_snapshot_data) ?? {}
  const { data: projData, error: projError } = await supabaseServer.rpc(
    'apply_recap_projects_snapshot',
    {
      p_recap_id: args.recap.id,
      p_allocations: projectSnapshot as unknown as Json,
    },
  )
  if (projError) {
    logger.error('[recap/finalize] apply_projects_snapshot failed', {
      recapId: args.recap.id,
      error: projError,
    })
  } else {
    projectsApplied = (projData ?? null) as ApplyProjectsSnapshotResult | null
  }

  // 3. Process transactions (delete validated, flag non-validated as carried).
  //    Pass exactly one of p_profile_id / p_group_id (the SQL function uses
  //    `(p IS NULL OR col = p)` filters mirroring the monthly_recaps XOR).
  const rpcArgs: { p_recap_id: string; p_profile_id?: string; p_group_id?: string } = {
    p_recap_id: args.recap.id,
  }
  if (args.context === 'profile') {
    rpcArgs.p_profile_id = args.profile.id
  } else {
    if (!args.profile.group_id) {
      // Defensive — the route should have already rejected this. Log + skip.
      logger.error('[recap/finalize] group context without group_id', { recapId: args.recap.id })
    } else {
      rpcArgs.p_group_id = args.profile.group_id
    }
  }

  let transactions: ProcessTransactionsResult = ZERO_TRANSACTIONS
  const { data: txData, error: txError } = await supabaseServer.rpc(
    'process_recap_transactions',
    rpcArgs,
  )
  if (txError) {
    logger.error('[recap/finalize] process_transactions failed', {
      recapId: args.recap.id,
      error: txError,
    })
  } else {
    transactions = (txData ?? ZERO_TRANSACTIONS) as ProcessTransactionsResult
  }

  // 3.5 Create salary income (solo only) — Sprint Salary-Auto-At-Recap-Complete
  //     2026-06-05. INSERT idempotent (partial unique index sur recap_origin_id)
  //     d'une ligne real_income_entries non-validée avec amount=profile.salary,
  //     description='Salaire', recap_origin_id=p_recap_id. Skip si salary=0.
  //     Le user validera via long-press → SalaryValidationModal (UX déléguée).
  //
  //     En groupe : no-op. Les revenus miroir côté groupe sont créés via le
  //     trigger sync_contribution_real_income (Sprint Contribution-Income-Mirror
  //     2026-06-05) dès qu'une `group_contributions` row existe — pas attaché
  //     à la finalisation du recap.
  //
  //     Fail-soft : si le RPC erreure, on log + continue (la finalisation
  //     n'est pas bloquée par cette étape ; l'user peut re-créer le salaire
  //     manuellement en attendant).
  let salaryIncome: CreateSalaryIncomeResult | null = null
  if (args.context === 'profile') {
    const { data: salaryData, error: salaryError } = await supabaseServer.rpc(
      'create_salary_income_for_recap',
      {
        p_recap_id: args.recap.id,
        p_profile_id: args.profile.id,
      },
    )
    if (salaryError) {
      logger.error('[recap/finalize] create_salary_income failed', {
        recapId: args.recap.id,
        error: salaryError,
      })
    } else {
      salaryIncome = (salaryData ?? null) as CreateSalaryIncomeResult | null
    }
  }

  // 4. Mark recap completed (NOT fail-soft — see file header).
  const completedAt = new Date().toISOString()
  const completionUpdate: Database['public']['Tables']['monthly_recaps']['Update'] = {
    completed_at: completedAt,
    current_step: 'completed',
  }
  const { error: completionError } = await supabaseServer
    .from('monthly_recaps')
    .update(completionUpdate)
    .eq('id', args.recap.id)
  if (completionError) {
    logger.error('[recap/finalize] mark completed failed', {
      recapId: args.recap.id,
      error: completionError,
    })
    throw completionError
  }

  return {
    recapId: args.recap.id,
    completed: true,
    snapshotApplied,
    projectsApplied,
    transactions,
    salaryIncome,
  }
}

function coerceSnapshot(raw: Json | null | undefined): Record<string, number> | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number') out[k] = v
  }
  return out
}
