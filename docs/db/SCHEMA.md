# Popoth DB schema

State as of 2026-05-07 (post Sprint DB). Source of truth = the migration files
under [supabase/migrations/](../../supabase/migrations/), starting with the
hand-curated baseline `20260101000000_remote_schema.sql`. RLS policy snapshot
in [docs/audit/RLS-FINDINGS.md](../audit/RLS-FINDINGS.md) is the audit-time
view; this doc is the post-Sprint-DB state.

## Conventions

- All tables live in the `public` schema.
- Owner pattern: every domain row carries either `profile_id uuid` (personal
  data) or `group_id uuid` (shared data), never both. The
  `*_owner_exclusive_check` CHECK constraint enforces XOR on most tables.
- IDs: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` everywhere.
- Timestamps: `created_at`/`updated_at timestamptz DEFAULT now()` where
  relevant. Trigger `update_updated_at_column` keeps `updated_at` fresh.
- RLS: enabled on every table. Server-side code uses the service_role client
  ([lib/supabase-server.ts](../../lib/supabase-server.ts)) which bypasses RLS;
  the browser client ([lib/supabase-client.ts](../../lib/supabase-client.ts))
  is RLS-bound.

## Tables

### `bank_balances` — current cash + RAV cache (one row per profile or group)
- Cols: `balance numeric NOT NULL`, `current_remaining_to_live numeric`, `profile_id uuid?`, `group_id uuid?`
- FK: `profile_id → auth.users(id) ON DELETE CASCADE`, `group_id → groups(id) ON DELETE CASCADE`
- Constraints: balance ≥ 0, owner XOR
- Indexes: unique partials on (profile_id) WHERE NOT NULL, (group_id) WHERE NOT NULL; (profile_id, current_remaining_to_live), (group_id, current_remaining_to_live)
- RLS: own row only via `auth.uid() = profile_id`
- Writes: via RPC `update_bank_balance(p_delta, p_profile_id?, p_group_id?)`

### `piggy_bank` — common savings jar (one row per profile or group)
- Cols: `amount numeric NOT NULL DEFAULT 0`, `profile_id uuid?`, `group_id uuid?`
- FK: `profile_id → profiles(id)`, `group_id → groups(id)` (no cascade)
- Constraints (D8): amount ≥ 0, owner XOR
- Indexes (D7): unique partials on (profile_id) WHERE group_id IS NULL, (group_id) WHERE profile_id IS NULL
- RLS (D1, post Sprint DB): own row OR group member via profiles.group_id
- Writes: via RPC `update_piggy_bank_amount(p_delta, p_profile_id?, p_group_id?)` and `transfer_from_piggy_to_budget(p_amount, p_budget_id, p_profile_id?, p_group_id?)`

### `estimated_budgets` — monthly planned budgets
- Cols: `name text`, `estimated_amount numeric`, `monthly_surplus`, `monthly_deficit`, `cumulated_savings`, `carryover_*`, `last_savings_update`
- FK: profile_id → profiles, group_id → groups (cascade on delete)
- Constraints: amount/savings/surplus/deficit ≥ 0, name not empty, owner XOR
- Indexes: profile_id partial, group_id partial, (profile_id, group_id, estimated_amount)
- Writes: `cumulated_savings` exclusively via RPC `update_budget_cumulated_savings(p_budget_id, p_delta)`

### `estimated_incomes` — monthly planned revenue lines
- Cols: `name`, `estimated_amount`, `is_monthly_recurring`
- FK: profile_id → profiles, group_id → groups (cascade)
- Indexes: profile_id partial, group_id partial, (profile_id, group_id) WHERE is_monthly_recurring

### `real_expenses` — actual spending entries
- Cols: `amount`, `description`, `expense_date`, `is_exceptional`, `amount_from_piggy_bank`, `amount_from_budget_savings`, `amount_from_budget`
- FK: profile_id → profiles, group_id → groups, estimated_budget_id → estimated_budgets ON DELETE SET NULL
- Constraints: amount > 0, sub-amounts ≥ 0, owner XOR
- Indexes: profile/group dates, budget+date, exceptional partial — extensively covered

### `real_income_entries` — actual revenue entries
- Cols: `amount`, `description`, `entry_date`, `is_exceptional`
- FK: profile_id, group_id, estimated_income_id → estimated_incomes ON DELETE SET NULL
- Constraints: amount > 0, owner XOR
- Indexes: profile/group dates, estimated_id partial

### `monthly_recaps` — month-end reconciliation state machine
- Cols: `recap_year`, `recap_month`, `current_step (1-3)`, status fields
- FK: profile_id, group_id (cascade)
- Constraints: month 1-12, year ≥ 2020, step 1-3, owner XOR
- Indexes: (profile_id, year, month), (group_id, year, month)

### `budget_transfers` — inter-budget moves recorded during recap
- Cols: `from_budget_id`, `to_budget_id`, `transfer_amount`, `transfer_date`, `transfer_reason`, `monthly_recap_id`
- FK: from/to budgets → estimated_budgets (cascade), monthly_recap_id → monthly_recaps (cascade)
- Constraints: amount > 0, from ≠ to, owner XOR
- Indexes: from, to, recap_id, date — heavily covered (with some duplicates)

### `recap_snapshots` — frozen snapshots created during a recap
- Mirrors recap state for audit/recovery
- Indexes: profile_date, group_date, active

### `remaining_to_live_snapshots` — RAV history points
- Cols: `remaining_to_live`, snapshot timestamps
- FK: profile_id → profiles, group_id → groups (cascade)
- RLS (D3, post Sprint DB): INSERT restricted to `service_role` only (was incorrectly `roles={public}` pre-Sprint DB)
- Indexes: (profile_id, created_at DESC), (group_id, created_at DESC) partials

### `groups` — group definitions
- Cols: `name`, `description`, `creator_id`
- FK: creator_id → auth.users (cascade)
- RLS: SELECT `USING true` for authenticated (intentional: search module). INSERT/UPDATE/DELETE restricted to creator.

### `profiles` — user profile records
- Cols: `id uuid PRIMARY KEY` (= auth.users.id), `first_name`, `last_name`, `salary`, `group_id`
- FK: id → auth.users (cascade), group_id → groups ON DELETE SET NULL
- RLS (D10, post Sprint DB): SELECT for authenticated only (own row OR group member); no DELETE policy (deletion via auth.users cascade or service_role).

### `group_contributions` — per-member contribution split
- Cols: `salary`, `contribution_amount`, `contribution_percentage`, `calculated_at`
- FK: profile_id → profiles, group_id → groups (cascade)
- Constraints: salary/amount/percentage ≥ 0
- RLS (D2, post Sprint DB): ALL operations restricted to actual group members via `group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid())` (was incorrectly open to any authenticated user pre-Sprint DB)

## Atomic finance RPCs

Defined in
[supabase/migrations/20260506000000_create_finance_rpcs.sql](../../supabase/migrations/20260506000000_create_finance_rpcs.sql)
(Sprint 0 / C3). All four are `SECURITY DEFINER`,
`SET search_path = public`, `REVOKE ALL FROM PUBLIC`,
`GRANT EXECUTE TO service_role`. Wrapped at the TS layer in
[lib/finance/](../../lib/finance/).

| RPC | Args | Returns | Helper |
|---|---|---|---|
| `update_piggy_bank_amount` | `p_delta numeric, p_profile_id uuid?, p_group_id uuid?` | new amount | `updatePiggyBank` |
| `update_bank_balance` | `p_delta numeric, p_profile_id uuid?, p_group_id uuid?` | new balance | `updateBankBalance` |
| `update_budget_cumulated_savings` | `p_budget_id uuid, p_delta numeric` | new savings | `updateBudgetCumulatedSavings` |
| `transfer_from_piggy_to_budget` | `p_amount numeric, p_budget_id uuid, p_profile_id uuid?, p_group_id uuid?` | `{piggy_bank, cumulated_savings}` | `transferFromPiggyToBudget` |

Each helper accepts a `ContextFilter` (`{profile_id} | {group_id}` discriminated
union) to pick the right RPC variant. Concurrency is exercised by
[lib/finance/__tests__/rpc-concurrency.test.ts](../../lib/finance/__tests__/rpc-concurrency.test.ts)
(gated on `SUPABASE_RPC_CONCURRENCY_TESTS=1`).

## Hot-path query coverage

Top tables by query frequency in `app/api/` + `lib/`:

| Table | Frequency | Indexed by |
|---|---:|---|
| `estimated_budgets` | 78 | profile_id partial, group_id partial, (profile_id, group_id, estimated_amount) |
| `profiles` | 77 | PK, group_id |
| `real_expenses` | 74 | (estimated_budget_id, expense_date), (profile_id, expense_date), (group_id, expense_date), exceptional partial |
| `real_income_entries` | 40 | profile/group dates + estimated_income_id partial |
| `budget_transfers` | 29 | from/to budget, recap_id, date |
| `monthly_recaps` | 24 | (profile_id, year, month), (group_id, year, month) |
| `bank_balances` | 19 | unique partials by owner + (owner, current_remaining_to_live) |
| `piggy_bank` | 19 | unique partials by owner (added D7) |

All FK columns on hot tables have at least one supporting index.

## Triggers — what's tracked vs what isn't

[scripts/export-schema.mjs](../../scripts/export-schema.mjs) only exports
triggers in the `public` schema (filter `tgrelid::regclass::text LIKE 'public.%'`).
Triggers attached to tables in other schemas — or triggers managed by
Supabase extensions on `public.*` tables — are **not** captured by the
baseline and **not** detected by `pnpm db:check-drift`.

Known cross-schema / Supabase-managed triggers (manual list — keep in sync
when discovered):

- **group_contributions auto-create on profile.group_id update**: when a
  profile's `group_id` changes from `NULL` to a value, a row is created in
  `group_contributions` for `(profile_id, group_id)` with default
  `salary = 0`. Discovered during Sprint Refactor / R6 — the RLS isolation
  test had to switch from `insert()` to `upsert()` because the unique
  constraint `group_contributions_unique_profile_group` was already
  satisfied by a row the trigger had inserted. The trigger function lives
  in a non-`public` schema (likely Supabase-managed) and is therefore
  invisible to the baseline. Behavior is reliable — the test passes
  consistently — but the trigger is not versioned in this repo. If it
  needs to change, do so via a `CREATE OR REPLACE FUNCTION` migration
  and document it here.
- **`update_updated_at_column`**: standard Supabase pattern in `public`;
  fires `BEFORE UPDATE` on most tables. Captured by `export-schema.mjs`
  (lives in `public.update_updated_at_column`).

To audit cross-schema triggers ad-hoc, run
[scripts/list-triggers.sql](../../scripts/list-triggers.sql):

```sh
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
node scripts/apply-sql.mjs scripts/list-triggers.sql
```

The query returns `(schema, table_name, trigger_name, function_schema,
function_name, timing, events)` for every non-internal trigger across
all schemas. `apply-sql.mjs` works for SELECT just as well as for
mutations — the Management API `/database/query` endpoint accepts any
SQL.

Decision during Sprint Hardening / H6 (preserved): do **not** widen the
export filter to non-`public` schemas — that would pull in
Supabase-managed internals (auth, storage, realtime). Document them
here instead.

### Inventory (last refreshed 2026-05-07 via [scripts/list-triggers.sql](../../scripts/list-triggers.sql))

| Table | Trigger | Function | Timing | Events | Status |
|---|---|---|---|---|---|
| `public.bank_balances` | `update_bank_balances_updated_at` | `public.update_updated_at_column` | BEFORE | UPDATE | ✅ trigger in baseline (A1); function in [20260512000000_capture_trigger_functions.sql](../../supabase/migrations/20260512000000_capture_trigger_functions.sql) (A2). |
| `public.groups` | `groups_budget_contribution_recalc` | `public.trigger_group_budget_change` | AFTER | UPDATE | ✅ trigger in baseline (A1); function captured (A2). |
| `public.groups` | `groups_cleanup_contributions` | `public.cleanup_group_contributions` | BEFORE | DELETE | ✅ trigger in baseline (A1); function captured (A2). |
| `public.groups` | `update_groups_updated_at` | `public.update_updated_at_column` | BEFORE | UPDATE | ✅ same as `bank_balances`. |
| `public.profiles` | `profiles_contribution_recalc` | `public.trigger_recalculate_contributions` | AFTER | INSERT, DELETE, UPDATE | ✅ "auto-create group_contributions on profile.group_id change" — function captured (A2). RLS test R6 depends on it. |
| `public.profiles` | `update_profiles_updated_at` | `public.update_updated_at_column` | BEFORE | UPDATE | ✅ same as `bank_balances`. |
| `realtime.subscription` | `tr_check_filters` | `realtime.subscription_check_filters` | BEFORE | INSERT, UPDATE | ⚠️ Supabase-managed (realtime extension). Expected, intentionally out-of-scope (H6 decision). |
| `storage.buckets` | `enforce_bucket_name_length_trigger` | `storage.enforce_bucket_name_length` | BEFORE | INSERT, UPDATE | ⚠️ Supabase-managed (storage). Expected. |
| `storage.buckets` | `protect_buckets_delete` | `storage.protect_delete` | BEFORE | DELETE | ⚠️ Supabase-managed. Expected. |
| `storage.objects` | `protect_objects_delete` | `storage.protect_delete` | BEFORE | DELETE | ⚠️ Supabase-managed. Expected. |
| `storage.objects` | `update_objects_updated_at` | `public.update_updated_at_column` | BEFORE | UPDATE | ⚠️ Supabase-managed binding to a `public.*` function. Expected. |

**Hidden dependency found in-flight (A2):** `calculate_group_contributions` (~80 LOC, core métier du recalcul des contributions de groupe) was also non-versioned and is `PERFORM`-called by 2 of the 3 trigger functions above. Captured in the same A2 migration. Now pinned by `pnpm db:check-functions`.

**Status (post Sprint Audit-Triggers, 2026-05-07):**

1. **Export filter fixed (A1).** [scripts/export-schema.mjs](../../scripts/export-schema.mjs) now joins `pg_class` + `pg_namespace` explicitly (`n.nspname = 'public'`) instead of relying on `tgrelid::regclass::text LIKE 'public.%'`. The 6 `public.*` triggers are in the baseline and `pnpm db:check-drift` would flag a drop.

2. **Function bodies captured (A2).** All 4 custom PL/pgSQL functions + the canonical `update_updated_at_column` are now versioned in [20260512000000_capture_trigger_functions.sql](../../supabase/migrations/20260512000000_capture_trigger_functions.sql). The migration was applied via `apply-sql.mjs` (idempotent `CREATE OR REPLACE`) + `supabase migration repair --status applied 20260512000000`.

3. **Drift detection extended (A3).** `pnpm db:check-functions` ([scripts/check-trigger-functions.mjs](../../scripts/check-trigger-functions.mjs)) verifies the 4 custom functions are in `pg_proc` (excludes `update_updated_at_column` to avoid false positives on Supabase canonical evolution). The script mirrors `db:check-rpcs` (Sprint Hardening / H4).

4. **CI extended (A4).** `.github/workflows/db-drift-check.yml` runs `db:check-drift` + `db:check-rpcs` + `db:check-functions` weekly.

5. **Cross-schema triggers** (`storage.*`, `realtime.*`) remain intentionally out-of-scope for the baseline (H6 decision). The inventory above is the canonical snapshot; future audits should diff against it.

## Migration timeline

| Timestamp | File | What |
|---|---|---|
| 20260101000000 | `_remote_schema.sql` | Hand-curated baseline (pre-Sprint DB schema snapshot) |
| 20260506000000 | `_create_finance_rpcs.sql` | Sprint 0 / C3 — 4 atomic finance RPCs |
| 20260507000000 | `_enable_rls_piggy_bank.sql` | Sprint DB / D1 — enable RLS + owner policies on piggy_bank |
| 20260507000001 | `_fix_group_contributions_policy.sql` | Sprint DB / D2 — restrict to actual group members |
| 20260507000002 | `_fix_remaining_to_live_insert.sql` | Sprint DB / D3 — restrict INSERT to service_role |
| 20260508000000 | `_add_piggy_bank_indexes.sql` | Sprint DB / D7 — partial unique indexes |
| 20260508000001 | `_add_piggy_bank_constraints.sql` | Sprint DB / D8 — amount ≥ 0 + owner XOR |
| 20260509000000 | `_dedupe_profiles_policies.sql` | Sprint DB / D10 — drop redundant public SELECT policy |
| 20260510000000 | `_dedupe_indexes_constraints.sql` | Sprint Refactor / R3 — drop dup indexes/FKs/CHECKs + fix budget_transfers NULL hole |
| 20260510000001 | `_drop_recursive_profiles_policy.sql` | Sprint Refactor / R6 — drop self-referencing profiles SELECT policy (42P17 fix) |
| 20260511000000 | `_align_bank_balance_overdraft.sql` | Sprint Hardening / H3 — align update_bank_balance overdraft guard with piggy bank |

Re-running [scripts/export-schema.mjs](../../scripts/export-schema.mjs)
against the linked project regenerates the baseline. The hand-curated
baseline is marked `applied` in `supabase_migrations.schema_migrations`
via `supabase migration repair`; `supabase db push --dry-run` should always
say "Remote database is up to date" after that.
