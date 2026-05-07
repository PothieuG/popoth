# Post-mortem — C3 RPC drift

**Date discovered**: 2026-05-07 (during Sprint DB / D9, RPC concurrency tests)
**Severity at discovery**: latent — every code path that called the helpers in `lib/finance/*` would have failed at runtime as soon as it was exercised in prod.
**Time to recover**: ~10 minutes once detected.
**Durable safeguard shipped**: `pnpm db:check-drift` (see [scripts/check-drift.mjs](../../scripts/check-drift.mjs)).

## What happened

`supabase_migrations.schema_migrations` listed
[`20260506000000_create_finance_rpcs.sql`](../../supabase/migrations/20260506000000_create_finance_rpcs.sql)
as applied. The four atomic finance RPCs that this migration defines —
`update_piggy_bank_amount`, `update_bank_balance`,
`update_budget_cumulated_savings`, `transfer_from_piggy_to_budget` — were not
present in `pg_proc`. The migration's record had been created without the
SQL ever executing against the remote database.

The four helpers in `lib/finance/*` (`updatePiggyBank`, `updateBankBalance`,
`updateBudgetCumulatedSavings`, `transferFromPiggyToBudget`) call these RPCs
through the service-role client. Any production call site that hit these
helpers would have surfaced a PostgREST error
"Could not find the function …" and 500'd. The bug was hidden because the
RPCs only run on the service-role client and are exercised when an
authenticated user mutates piggy/bank/savings — the dev environment did not
re-trigger them after Sprint 0 / C3 was committed (`87d753b`,
`chore(db): version remote schema and generate Supabase types`).

The drift was caught by the new
[`lib/finance/__tests__/rpc-concurrency.test.ts`](../../lib/finance/__tests__/rpc-concurrency.test.ts)
suite (gated by `SUPABASE_RPC_CONCURRENCY_TESTS=1`), which calls the RPCs
directly against prod. The first run failed with the PostgREST cache miss
error.

## Timeline

| When | What |
|---|---|
| 2026-05-04 (commit `8be3fcc` — Sprint 0 / C3) | Migration `20260506000000_create_finance_rpcs.sql` authored alongside the `lib/finance/*` helpers. |
| Between C3 and D9 | `schema_migrations` records the migration as applied; the SQL never executes on prod. **No detector existed.** |
| 2026-05-07 morning (Sprint DB / D9) | `SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run` fails because the RPCs don't exist in `pg_proc`. |
| 2026-05-07 morning | Recovered by running `node scripts/apply-sql.mjs supabase/migrations/20260506000000_create_finance_rpcs.sql` followed by `NOTIFY pgrst, 'reload schema'`. The four RPCs are created; tests go 4/4 green. |
| 2026-05-07 (Sprint Refactor / R0) | This post-mortem. |
| 2026-05-07 (Sprint Refactor / R4) | `pnpm db:check-drift` shipped. |

## Hypotheses (none confirmed)

We do not have an audit trail that lets us pin down the cause. The plausible
candidates:

1. **`supabase migration repair --status applied` was run without a follow-up
   `db push`.** The repair command flips the migration row to "applied"
   regardless of whether the SQL ever executed. This is consistent with the
   observed state. Whoever (or whatever script) repaired the migrations table
   may have meant to mark the migration as known-good and then forgotten to
   actually push it.

2. **`db push` was interrupted between writing `schema_migrations` and
   executing the migration body.** Supabase CLI inserts the migration row
   inside the same transaction as the SQL body, so this is the least likely
   path; but a CLI crash or network drop at exactly the right moment could
   have left the row visible if the transaction isolation behaved
   unexpectedly.

3. **A restore from an older snapshot lost the `pg_proc` rows but kept the
   `supabase_migrations.schema_migrations` table updated.** Plausible if
   `pg_proc` and `supabase_migrations` were in different
   schemas-of-origin during a partial restore. We have no evidence of a
   restore.

The most likely candidate is (1): operational confusion between
`migration repair` and `db push` is a known foot-gun.

## Recovery

```powershell
# verify nothing claims to be applied that shouldn't be
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
node scripts/apply-sql.mjs supabase/migrations/20260506000000_create_finance_rpcs.sql

# re-trigger PostgREST cache so .rpc() finds the new functions
# (already in the migration body via NOTIFY pgrst, 'reload schema')
```

Verification: `SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run` → 4/4 green.

## Durable safeguard: `pnpm db:check-drift`

[`scripts/check-drift.mjs`](../../scripts/check-drift.mjs) re-builds the
prod schema baseline via the Management API and diffs it against the
committed [`supabase/migrations/20260101000000_remote_schema.sql`](../../supabase/migrations/20260101000000_remote_schema.sql).
Exit 0 if identical, exit 1 with a unified diff if drift is detected.

Worth noting: the C3 drift involved RPCs (functions in `pg_proc`), which the
baseline export deliberately excludes. The detector therefore would not have
caught this *specific* incident at the function level. It would, however,
catch:

- table / column / RLS-policy drift,
- index drift,
- CHECK / FK constraint drift,
- enum / extension drift.

For RPC-level drift specifically, the gating is the
`SUPABASE_RPC_CONCURRENCY_TESTS=1` integration tests in
[`lib/finance/__tests__/rpc-concurrency.test.ts`](../../lib/finance/__tests__/rpc-concurrency.test.ts) —
they fail loudly when the RPCs are missing.

## Operational rules going forward

- After every non-trivial migration commit: run `pnpm db:check-drift` to
  confirm baseline catches up. If it doesn't, re-export the baseline:
  `node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql`.
- Never run `supabase migration repair --status applied` without immediately
  following with `pnpm supabase db push --dry-run` and inspecting that
  exactly the expected migrations are applied.
- For new RPC migrations: ALWAYS end the SQL with
  `NOTIFY pgrst, 'reload schema';` so the PostgREST cache picks up the new
  function (CLAUDE.md §8 codifies this).
- Run `SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run` after any RPC change
  to validate the function exists and behaves under concurrency.

## What we did not do

- We did not pull the GitHub Actions / Supabase project audit log. The
  project does not retain operational logs that far back, and the team is
  small enough that a written post-mortem with the safeguard plus updated
  rules is the proportionate response.
- We did not add a GitHub Actions cron that runs `pnpm db:check-drift`
  weekly. That is a planned follow-up; the script is the durable
  contribution.
