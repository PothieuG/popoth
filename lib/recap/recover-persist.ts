/**
 * Persistence orchestrator for monthly recap recovery.
 *
 * Sprint Refactor-Recover (2026-05-16): extracted from
 * app/api/monthly-recap/recover/route.ts (was 385 LOC mixed orchestration
 * / I/O / logging with a 95-LOC closure-based restoreTable helper). This
 * module owns:
 *   - loadRecoverySnapshot(input)               — read recap_snapshots row
 *   - applyRecoveryDecision(input, decision)    — DELETE+INSERT per action
 *   - processRecovery(input)                    — full pipeline → output
 *
 * SIDE-EFFECT POLICY (mirror of the original route's invariants):
 *  - Per-table DELETE+INSERT is per-action FAIL-SOFT: errors push into
 *    `RecoveryResults.errors[]` and the flow continues (mirror route's
 *    restoreTable L206-211 absorb-and-continue).
 *  - V1 fallback scalar UPDATE is fail-soft same way (mirror route L246-249).
 *  - Snapshot deactivation (step 8) is fail-soft via `logger.warn` (mirror
 *    route L271-273 — NOT propagated, NOT pushed to errors[]).
 *
 * CLEANUP-ATTEMPT CRITIQUE (PRESERVED VERBATIM from route L286-288):
 *  If an UNEXPECTED exception escapes the per-action loop (e.g. Supabase
 *  client crash, network failure), `applyRecoveryDecision` catches it,
 *  fires `logger.error('Recovery rollback partiel impossible')` with the
 *  in-flight partialResults, and throws `RecoveryAppliedPartiallyError`
 *  so the HTTP handler can return 500 + recovery_results in the body
 *  (informational; snapshot may still be `is_active=true` and the DB
 *  partially restored — manual ops intervention may be needed).
 *
 * BOOLEAN SEMANTIC (PRESERVED from Sprint Lint-Followups Item 1, 2026-05-08):
 *  `RecoveryResults.bank_balance` / `.piggy_bank` are STRICT booleans.
 *  Both V1 and V2 paths assign `true` on successful restore (mirror route
 *  L212-216). Pre-fix code typed them as `boolean | number` and v2 path
 *  assigned `data.length` (numeric) — the fix normalised to strict boolean.
 *  Regression-guarded by api-regressions.test.ts Cas A/B/C +
 *  recover/__tests__/route.integration.test.ts CAS 1/2/3.
 *
 * STRICT TYPING (mirror Sprint Lint-Baseline-Cleanup Phase 4.2):
 *  Each table dispatch in `applyRestoreAction` uses
 *  `TablesInsert<'tableName'>[]` for the INSERT payload (no `as any`,
 *  no `as unknown as SupabaseClient`). The route's switch on `RestorableTable`
 *  literal union becomes a function dispatch here with the same shape.
 */

import type { TablesInsert } from '@/lib/database.types'
import { logger } from '@/lib/logger'
import type { SnapshotPayload } from '@/lib/recap-snapshot.types'
import { supabaseServer } from '@/lib/supabase-server'

import { decideRecoveryActions } from './recover-algorithm'
import {
  RecoverContextError,
  RecoverSnapshotCorruptedError,
  RecoverSnapshotNotFoundError,
  RecoveryAppliedPartiallyError,
  type ProcessRecoveryInput,
  type ProcessRecoveryOutput,
  type ProcessRecoverySnapshot,
  type RecoveryResults,
  type RestorableTable,
  type RestorationAction,
  type ResultKey,
} from './recover-types'

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Recover monthly recap state from a snapshot. Full pipeline:
 *   loadRecoverySnapshot → decideRecoveryActions (pure) → applyRecoveryDecision
 *
 * Errors:
 *  - RecoverContextError              → handler maps to 400
 *  - RecoverSnapshotNotFoundError     → handler maps to 404
 *  - RecoverSnapshotCorruptedError    → handler maps to 500
 *  - RecoveryAppliedPartiallyError    → handler maps to 500 + recovery_results
 *  - Other Error                      → handler maps to 500 generic
 */
export async function processRecovery(input: ProcessRecoveryInput): Promise<ProcessRecoveryOutput> {
  const snapshot = await loadRecoverySnapshot(input)
  const decision = decideRecoveryActions(snapshot)
  const results = await applyRecoveryDecision(input, decision)

  const currentMonth = input.currentDate.getMonth() + 1
  const currentYear = input.currentDate.getFullYear()

  return {
    success: true,
    message: 'Récupération effectuée avec succès',
    snapshot_id: snapshot.snapshotRowId,
    snapshot_date: snapshot.snapshotCreatedAt,
    recovery_results: results,
    context: input.context,
    month: currentMonth,
    year: currentYear,
    has_errors: results.errors.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Snapshot loading (I/O)
// ---------------------------------------------------------------------------

/**
 * Load the recovery snapshot from `recap_snapshots`. Exported as testing
 * surface (lib/recap/__tests__/recover-persist.test.ts) — production code
 * goes through `processRecovery()` and never calls this directly.
 *
 * Resolution order (mirror route L56-77):
 *  1. Filter by `ownerField === contextId` + current month/year
 *  2. If `input.snapshotId` provided → `.eq('id', snapshotId)` (exact pick)
 *  3. Otherwise → `.order('created_at', desc).limit(1)` (most recent active)
 *  4. `.single()` — throw RecoverSnapshotNotFoundError if no row
 *  5. Validate `snapshot_data` non-null + has `estimated_incomes` +
 *     `estimated_budgets` — throw RecoverSnapshotCorruptedError otherwise
 */
export async function loadRecoverySnapshot(
  input: ProcessRecoveryInput,
): Promise<ProcessRecoverySnapshot> {
  // 1. Validate context (mirror route L46-51 — context='group' requires group_id)
  if (input.context === 'group' && !input.contextId) {
    throw new RecoverContextError("Utilisateur ne fait partie d'aucun groupe")
  }

  const currentMonth = input.currentDate.getMonth() + 1
  const currentYear = input.currentDate.getFullYear()

  // 2. Build query
  let query = supabaseServer
    .from('recap_snapshots')
    .select('id, snapshot_data, created_at')
    .eq(input.ownerField, input.contextId)
    .eq('snapshot_month', currentMonth)
    .eq('snapshot_year', currentYear)

  if (input.snapshotId) {
    query = query.eq('id', input.snapshotId)
  } else {
    query = query.order('created_at', { ascending: false }).limit(1)
  }

  const { data: snapshotRow, error: snapshotError } = await query.single()

  if (snapshotError || !snapshotRow) {
    throw new RecoverSnapshotNotFoundError('Aucun snapshot de récupération trouvé pour ce mois')
  }

  const payload = snapshotRow.snapshot_data as unknown as SnapshotPayload | null

  if (!payload || !payload.estimated_incomes || !payload.estimated_budgets) {
    throw new RecoverSnapshotCorruptedError('Données du snapshot corrompues ou incomplètes')
  }

  return {
    snapshotRowId: snapshotRow.id,
    snapshotCreatedAt: snapshotRow.created_at,
    payload,
  }
}

// ---------------------------------------------------------------------------
// Decision application (I/O)
// ---------------------------------------------------------------------------

/**
 * Apply the pure algorithm's decision to the database. Exported as testing
 * surface (lib/recap/__tests__/recover-persist.test.ts) — production code
 * goes through `processRecovery()` and never calls this directly.
 *
 * For each action in `decision.actions`, dispatches DELETE+INSERT or
 * scalar UPDATE. Per-action errors are absorbed into `RecoveryResults.errors[]`
 * and the flow continues. UNEXPECTED exceptions trigger the CLEANUP-ATTEMPT
 * CRITIQUE preservation and throw `RecoveryAppliedPartiallyError`.
 *
 * Snapshot deactivation (step 8) happens after all restoration actions
 * succeed, with its own fail-soft `logger.warn` (mirror route L266-273).
 */
export async function applyRecoveryDecision(
  input: ProcessRecoveryInput,
  decision: { actions: RestorationAction[]; snapshotRowId: string },
): Promise<RecoveryResults> {
  const results: RecoveryResults = {
    estimated_incomes: 0,
    estimated_budgets: 0,
    real_incomes: 0,
    real_expenses: 0,
    bank_balance: false,
    piggy_bank: false,
    budget_transfers: 0,
    errors: [],
  }

  try {
    for (const action of decision.actions) {
      await applyRestoreAction(input, action, results)
    }

    // Step 8: deactivate snapshot — fail-soft, mirror route L266-273
    const { error: deactivateError } = await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('id', decision.snapshotRowId)
    if (deactivateError) {
      logger.warn('[recover] erreur désactivation snapshot (non bloquant)', deactivateError)
    }

    return results
  } catch (err) {
    // CLEANUP-ATTEMPT CRITIQUE: recovery rollback partiel — snapshot peut
    // rester actif, la DB peut être partiellement restaurée. Préservé
    // verbatim depuis route L286-288 (Sprint Lot 5b 2026-05-10 KEEP+migrate).
    logger.error('[recover] rollback partiel impossible (snapshot may stay active)', err)
    throw new RecoveryAppliedPartiallyError(results, err)
  }
}

// ---------------------------------------------------------------------------
// Internal — per-action dispatch
// ---------------------------------------------------------------------------

/**
 * Apply a single RestorationAction. Per-action errors are absorbed into
 * `results.errors[]`; unexpected exceptions propagate to the outer try/catch
 * in `applyRecoveryDecision`.
 */
async function applyRestoreAction(
  input: ProcessRecoveryInput,
  action: RestorationAction,
  results: RecoveryResults,
): Promise<void> {
  if (action.kind === 'update_bank_balance_v1') {
    // V1 fallback scalar UPDATE (mirror route L238-253)
    const { error: updateError } = await supabaseServer
      .from('bank_balances')
      .update({
        balance: action.amount,
        updated_at: new Date().toISOString(),
      })
      .eq(input.ownerField, input.contextId)
    if (updateError) {
      results.errors.push(`Erreur restauration solde bancaire: ${updateError.message}`)
    } else {
      // Strict boolean (Sprint Lint-Followups Item 1)
      results.bank_balance = true
    }
    return
  }

  // restore_table: DELETE all rows owned + INSERT new rows
  await restoreTable(input, action.table, action.rows, results, action.resultKey)
}

/**
 * DELETE all rows of `table` owned by `input.ownerField === input.contextId`,
 * then INSERT the provided `rows`. Per-table fail-soft (errors push into
 * results.errors, mirror route L206-211).
 *
 * The switch on `RestorableTable` literal union gives TypeScript the
 * `TablesInsert<...>[]` type for the INSERT payload (no `as any`).
 * Compile-time check by `assertNever` in the default branch ensures all
 * 7 tables are handled.
 */
async function restoreTable(
  input: ProcessRecoveryInput,
  table: RestorableTable,
  rows: ReadonlyArray<unknown>,
  results: RecoveryResults,
  resultKey: ResultKey,
): Promise<void> {
  if (rows.length === 0) return

  let deleteError: { message: string } | null = null
  let insertError: { message: string } | null = null

  switch (table) {
    case 'estimated_incomes': {
      ;({ error: deleteError } = await supabaseServer
        .from('estimated_incomes')
        .delete()
        .eq(input.ownerField, input.contextId))
      if (deleteError) break
      ;({ error: insertError } = await supabaseServer
        .from('estimated_incomes')
        .insert(rows as TablesInsert<'estimated_incomes'>[]))
      break
    }
    case 'estimated_budgets': {
      ;({ error: deleteError } = await supabaseServer
        .from('estimated_budgets')
        .delete()
        .eq(input.ownerField, input.contextId))
      if (deleteError) break
      ;({ error: insertError } = await supabaseServer
        .from('estimated_budgets')
        .insert(rows as TablesInsert<'estimated_budgets'>[]))
      break
    }
    case 'real_income_entries': {
      ;({ error: deleteError } = await supabaseServer
        .from('real_income_entries')
        .delete()
        .eq(input.ownerField, input.contextId))
      if (deleteError) break
      ;({ error: insertError } = await supabaseServer
        .from('real_income_entries')
        .insert(rows as TablesInsert<'real_income_entries'>[]))
      break
    }
    case 'real_expenses': {
      ;({ error: deleteError } = await supabaseServer
        .from('real_expenses')
        .delete()
        .eq(input.ownerField, input.contextId))
      if (deleteError) break
      ;({ error: insertError } = await supabaseServer
        .from('real_expenses')
        .insert(rows as TablesInsert<'real_expenses'>[]))
      break
    }
    case 'bank_balances': {
      ;({ error: deleteError } = await supabaseServer
        .from('bank_balances')
        .delete()
        .eq(input.ownerField, input.contextId))
      if (deleteError) break
      ;({ error: insertError } = await supabaseServer
        .from('bank_balances')
        .insert(rows as TablesInsert<'bank_balances'>[]))
      break
    }
    case 'piggy_bank': {
      ;({ error: deleteError } = await supabaseServer
        .from('piggy_bank')
        .delete()
        .eq(input.ownerField, input.contextId))
      if (deleteError) break
      ;({ error: insertError } = await supabaseServer
        .from('piggy_bank')
        .insert(rows as TablesInsert<'piggy_bank'>[]))
      break
    }
    case 'budget_transfers': {
      ;({ error: deleteError } = await supabaseServer
        .from('budget_transfers')
        .delete()
        .eq(input.ownerField, input.contextId))
      if (deleteError) break
      ;({ error: insertError } = await supabaseServer
        .from('budget_transfers')
        .insert(rows as TablesInsert<'budget_transfers'>[]))
      break
    }
    default: {
      // Exhaustive check — compile-time guard that all 7 tables handled
      const _exhaustive: never = table
      throw new Error(`Unhandled RestorableTable: ${String(_exhaustive)}`)
    }
  }

  if (deleteError) {
    results.errors.push(`Erreur suppression ${table}: ${deleteError.message}`)
    return
  }
  if (insertError) {
    results.errors.push(`Erreur restauration ${table}: ${insertError.message}`)
    return
  }

  // Success — assign result key. Strict boolean for bank/piggy (Sprint
  // Lint-Followups Item 1) vs count for everything else.
  if (resultKey === 'bank_balance' || resultKey === 'piggy_bank') {
    results[resultKey] = true
  } else {
    results[resultKey] = rows.length
  }
}

// PRESERVED: The 5 SnapshotPayloadV2 tables NOT restored by this module
// (profiles, groups, group_contributions, monthly_recaps,
// remaining_to_live_snapshots) are intentionally absent from the
// RestorableTable union — identity/membership/output/audit-trail tables.
// Documented in recover-types.ts JSDoc. Do NOT add them here without a
// dedicated Recover-V2-Complete-Restoration sprint with FK cascade tests.
